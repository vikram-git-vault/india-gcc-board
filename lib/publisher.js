import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { loadTargets } from './targeting.js';
import { descriptionHash, rubricVersion, scoreState } from './scoring.js';
import { loadCheckpoint, summarizeCheckpoint } from './checkpoint.js';
import { databasePath } from './database.js';
import { settings } from './settings.js';
import { SHORTLISTED_SQL, rmState, tailorState, readScoreAttempts } from './states.js';
import { ageCutoff, localDate, expandHome, readCvMinScore } from './tailoring.js';

const EMPLOYERS_PATH = path.join('config', 'employers.json');
const OUTPUT_PATH = path.join('data', 'roles.json');

// This is the self-hosted server's data file — server.js serves it directly
// at GET /api/roles, no publish step required. (Earlier this wrote a
// Claude-Artifact-shaped sharded payload for manual db sync; that model is
// retired — see docs/ARCHITECTURE.md §5.)
// outputPath: tests write to a temporary file, never to the live board file.
export async function publish({ outputPath = OUTPUT_PATH } = {}) {
  const db = new sqlite3.Database(databasePath());
  db.configure('busyTimeout', 5000);

  // Only target and exception roles reach the board (config/targets.json);
  // excluded roles stay in the database so a rule change needs no re-scrape.
  const rows = await all(db, `
    SELECT r.id, e.slug AS employer_slug, e.name as employer, e.ats_type, r.title, r.location, r.department,
           r.experience_level, r.job_type, r.posted_date, r.job_url, r.external_job_id AS job_id,
           COALESCE(r.posted_date, DATE(r.scraped_at)) AS age_date,
           r.grade, r.family, r.tier, r.description_status, r.source,
           s.po_ats, s.po_fit, s.em_ats, s.em_fit, s.recommended, s.ats_score, s.fit_score,
           s.reason, s.matched_keywords, s.gaps, s.confidence, s.scored_at,
           s.description_hash, s.rubric_version,
           COALESCE(r.full_description, r.description, '') AS scored_text,
           t.status AS t_status, t.score AS t_score, t.decision AS t_decision, t.gaps AS t_gaps,
           t.cv_file AS t_cv, t.cover_file AS t_cover, t.description_hash AS t_hash, t.run_at AS t_run_at,
           t.attempts AS t_attempts, t.rerun AS t_rerun
    FROM roles r
    JOIN employers e ON e.id = r.employer_id
    LEFT JOIN role_scores s ON s.role_id = r.id
    LEFT JOIN tailored_docs t ON t.role_id = r.id
    WHERE r.is_active = 1 AND e.active = 1 AND r.${SHORTLISTED_SQL}
    ORDER BY r.posted_date DESC
  `);

  // Gaps that the owner confirmed on the board (added to the master CV).
  const confirmed = {};
  (await all(db, 'SELECT role_id, gap, answer, created_at FROM gap_answers ORDER BY id')).forEach((g) => {
    (confirmed[g.role_id] = confirmed[g.role_id] || []).push({ gap: g.gap, answer: g.answer, at: g.created_at });
  });

  // Exception grades (AVP, Senior Manager) stay only with a fit score at or
  // above the threshold; unscored ones stay until they are scored.
  // A stale score (description changed, or the rubric changed for a role
  // at or above scoring.rescore_min_fit) still shows,
  // marked stale, but cannot hide an exception role.
  const currentRubric = rubricVersion();
  // The named states of each role (lib/states.js): the RM score and
  // career-ops. The board shows their text; the hide rules below keep
  // their own stale flag.
  const boardFrom = ageCutoff(localDate(settings.schedule.timezone), settings.board.max_age_days);
  const attempts = readScoreAttempts();
  const cvMinScore = readCvMinScore(expandHome(settings.tailoring.career_ops_dir));
  const tailorOpts = { minFit: settings.tailoring.min_fit_score, cvMinScore, maxAttempts: settings.tailoring.max_attempts, boardFrom };
  rows.forEach((r) => {
    r.stale = r.fit_score != null && scoreState({
      scoredHash: r.description_hash, hash: descriptionHash(r.title, r.scored_text), scoredRubric: r.rubric_version,
      rubric: currentRubric, bestFit: Math.max(r.po_fit || 0, r.em_fit || 0), rescoreMinFit: settings.scoring.rescore_min_fit,
    }) === 'stale';
    r.score_state = rmState({
      id: r.id, title: r.title, description: r.scored_text, scored_hash: r.description_hash, scored_rubric_version: r.rubric_version,
      scored_best_fit: r.fit_score == null ? null : Math.max(r.po_fit || 0, r.em_fit || 0), age_date: r.age_date,
    }, { rubric: currentRubric, rescoreMinFit: settings.scoring.rescore_min_fit, boardFrom, attempts, maxAttempts: settings.scoring.max_attempts });
    r.tailor_state = tailorState({
      id: r.id, title: r.title, description: r.scored_text, age_date: r.age_date, source: r.source,
      best_fit: r.fit_score == null ? null : Math.max(r.po_fit || 0, r.em_fit || 0),
      tailored_status: r.t_status, tailored_score: r.t_score, tailored_cv: r.t_cv, tailored_hash: r.t_hash,
      attempts: r.t_attempts, rerun: r.t_rerun,
    }, tailorOpts);
  });
  const { exceptionMinFitScore: minFit, employerMinFit } = loadTargets();
  // A role the owner added by hand always shows.
  const hiddenExceptions = rows.filter((r) => r.source !== 'manual' && r.tier === 'exception' && r.fit_score != null && !r.stale && r.fit_score < minFit);
  // Same rule for every role of an employer with its own minimum (Amazon).
  const employerFloor = (r) => employerMinFit[r.employer_slug];
  const hiddenByEmployer = rows.filter((r) => r.source !== 'manual' && !hiddenExceptions.includes(r) && employerFloor(r) != null
    && r.fit_score != null && !r.stale && r.fit_score < employerFloor(r));
  const toPublic = ({ employer_slug, po_ats, po_fit, em_ats, em_fit, recommended, ats_score, fit_score, reason,
      matched_keywords, gaps, confidence, scored_at, description_hash, rubric_version, scored_text,
      stale, t_status, t_score, t_decision, t_gaps, t_cv, t_cover, t_hash, t_run_at, t_attempts, t_rerun, source, ...role }) => ({
      ...role,
      // Added by the owner (lib/manual-job.js): the refresh never closes it.
      manual: source === 'manual',
      // The named states (lib/states.js RM_STATES, TAILOR_STATES): what
      // the next scoring and career-ops runs do with the role, in words.
      // score_state and tailor_state are set above; the spread keeps them.
      // career-ops (tailor.js): its score (1 to 5) and the Word files. A
      // failed run shows nothing; the next run tries it again.
      tailor: !t_status || t_status === 'failed' ? null : {
        score: t_score,
        decision: t_decision,
        cv: !!t_cv,
        cover: !!t_cover,
        gaps: JSON.parse(t_gaps || '[]'),
        confirmed: confirmed[role.id] || [],
        run_at: t_run_at,
        stale: t_hash !== descriptionHash(role.title, scored_text),
      },
      score: fit_score == null ? null : {
        ats: ats_score,
        fit: fit_score,
        recommended,
        variants: { PO: { ats: po_ats, fit: po_fit }, EM: { ats: em_ats, fit: em_fit } },
        reason,
        matched_keywords: JSON.parse(matched_keywords),
        gaps: JSON.parse(gaps),
        confidence,
        scored_at,
        stale,
      },
    });
  const roles = rows.filter((r) => !hiddenExceptions.includes(r) && !hiddenByEmployer.includes(r)).map(toPublic);
  // The hidden roles, for a job id search only (frontend/public/js/board.js).
  const hiddenRoles = [
    ...hiddenExceptions.map((r) => ({ ...toPublic(r), hidden: `exception below RM ${minFit}` })),
    ...hiddenByEmployer.map((r) => ({ ...toPublic(r), hidden: `below the employer minimum RM ${employerFloor(r)}` })),
  ];
  // Same city, two spellings across employers' ATSs — one facet chip each.
  const CITY_ALIASES = { Bangalore: 'Bengaluru', Gurgaon: 'Gurugram' };
  [...roles, ...hiddenRoles].forEach((r) => { if (CITY_ALIASES[r.location]) r.location = CITY_ALIASES[r.location]; });

  const employerRow = await get(db, `
    SELECT COUNT(DISTINCT employer_id) AS n FROM roles WHERE is_active = 1
  `);
  const tierRows = await all(db, `
    SELECT COALESCE(r.tier, 'unclassified') AS tier, COUNT(*) AS n
    FROM roles r JOIN employers e ON e.id = r.employer_id
    WHERE r.is_active = 1 AND e.active = 1 GROUP BY 1
  `);
  const metaRow = await get(db, "SELECT value FROM meta WHERE key = 'last_refresh'");
  db.close();

  const updatedAt = (metaRow && metaRow.value) || new Date().toISOString();

  const employersConfig = JSON.parse(fs.readFileSync(EMPLOYERS_PATH, 'utf-8'));
  const totalTracked = employersConfig.employers.length + employersConfig.excluded.length;
  const fetchedCount = employersConfig.employers.filter((e) => e.active).length;
  const coverage = {
    totalTracked, fetchedCount, manualCount: totalTracked - fetchedCount, withRoles: employerRow.n,
  };

  const targeting = { target: 0, exception: 0, excluded: 0, unclassified: 0 };
  tierRows.forEach((row) => { targeting[row.tier] = row.n; });
  targeting.scanned = tierRows.reduce((sum, row) => sum + row.n, 0);
  targeting.exception_min_fit = minFit;
  targeting.exceptions_hidden = hiddenExceptions.length;
  targeting.employer_min_fit = employerMinFit;
  targeting.employer_floor_hidden = hiddenByEmployer.length;
  targeting.exception_shown = roles.filter((r) => r.tier === 'exception').length;
  targeting.scored = roles.filter((r) => r.score).length;
  targeting.unscored = roles.length - targeting.scored;
  targeting.tailored = roles.filter((r) => r.tailor).length;
  targeting.tailored_cv = roles.filter((r) => r.tailor && r.tailor.cv).length;
  // The board shows a waiting career-ops box from this RM score (tailor.js).
  // The board hides roles older than this, except the owner's marked roles
  // and roles with a tailored CV (frontend/public/js/board.js).
  targeting.max_age_days = settings.board.max_age_days;
  targeting.tailor_min_fit = settings.tailoring.auto_tailor ? settings.tailoring.min_fit_score : null;
  // The career-ops score a role needs for a CV (the career-ops profile);
  // null when the profile is not on this computer.
  targeting.cv_min_score = cvMinScore;
  // Roles in each career-ops state, for the status panel and the tools.
  targeting.tailor_states = {};
  roles.forEach((r) => { targeting.tailor_states[r.tailor_state.state] = (targeting.tailor_states[r.tailor_state.state] || 0) + 1; });

  // Complete or partial: the latest run's checkpoint (null before the first
  // run with checkpoints). last_refresh stays the end of the last complete run.
  const refresh = summarizeCheckpoint(loadCheckpoint(), employersConfig.employers);
  const payload = { roles, hidden_roles: hiddenRoles, meta: { last_refresh: updatedAt, refresh }, coverage, targeting };

  // The board reads this file during a refresh; rename so it never sees half a file.
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // The pid in the name: two processes (refresh, scoring) never share a temporary file.
  const tmp = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, outputPath);

  return { rolesWritten: roles.length, outputPath };
}

function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
