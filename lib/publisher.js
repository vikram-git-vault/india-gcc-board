import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { loadTargets } from './targeting.js';
import { descriptionHash, rubricVersion } from './scoring.js';
import { loadCheckpoint, summarizeCheckpoint } from './checkpoint.js';

const DB_PATH = process.env.DB_PATH || './data/jobs.db';
const EMPLOYERS_PATH = path.join('config', 'employers.json');
const OUTPUT_PATH = path.join('data', 'roles.json');

// This is the self-hosted server's data file — server.js serves it directly
// at GET /api/roles, no publish step required. (Earlier this wrote a
// Claude-Artifact-shaped sharded payload for manual db sync; that model is
// retired — see docs/ARCHITECTURE.md §5.)
export async function publish() {
  const db = new sqlite3.Database(DB_PATH);

  // Only target and exception roles reach the board (config/targets.json);
  // excluded roles stay in the database so a rule change needs no re-scrape.
  const rows = await all(db, `
    SELECT r.id, e.slug AS employer_slug, e.name as employer, e.ats_type, r.title, r.location, r.department,
           r.experience_level, r.job_type, r.posted_date, r.job_url,
           r.grade, r.family, r.tier, r.description_status,
           s.po_ats, s.po_fit, s.em_ats, s.em_fit, s.recommended, s.ats_score, s.fit_score,
           s.reason, s.matched_keywords, s.gaps, s.confidence, s.scored_at,
           s.description_hash, s.rubric_version,
           COALESCE(r.full_description, r.description, '') AS scored_text
    FROM roles r
    JOIN employers e ON e.id = r.employer_id
    LEFT JOIN role_scores s ON s.role_id = r.id
    WHERE r.is_active = 1 AND e.active = 1 AND r.tier IN ('target', 'exception')
    ORDER BY r.posted_date DESC
  `);

  // Exception grades (AVP, Senior Manager) stay only with a fit score at or
  // above the threshold; unscored ones stay until they are scored.
  // A stale score (description or rubric changed since scoring) still shows,
  // marked stale, but cannot hide an exception role.
  const currentRubric = rubricVersion();
  rows.forEach((r) => {
    r.stale = r.fit_score != null
      && (r.description_hash !== descriptionHash(r.title, r.scored_text) || r.rubric_version !== currentRubric);
  });
  const { exceptionMinFitScore: minFit, employerMinFit } = loadTargets();
  const hiddenExceptions = rows.filter((r) => r.tier === 'exception' && r.fit_score != null && !r.stale && r.fit_score < minFit);
  // Same rule for every role of an employer with its own minimum (Amazon).
  const employerFloor = (r) => employerMinFit[r.employer_slug];
  const hiddenByEmployer = rows.filter((r) => !hiddenExceptions.includes(r) && employerFloor(r) != null
    && r.fit_score != null && !r.stale && r.fit_score < employerFloor(r));
  const roles = rows
    .filter((r) => !hiddenExceptions.includes(r) && !hiddenByEmployer.includes(r))
    .map(({ employer_slug, po_ats, po_fit, em_ats, em_fit, recommended, ats_score, fit_score, reason,
      matched_keywords, gaps, confidence, scored_at, description_hash, rubric_version, scored_text,
      stale, ...role }) => ({
      ...role,
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
    }));
  // Same city, two spellings across employers' ATSs — one facet chip each.
  const CITY_ALIASES = { Bangalore: 'Bengaluru', Gurgaon: 'Gurugram' };
  roles.forEach((r) => { if (CITY_ALIASES[r.location]) r.location = CITY_ALIASES[r.location]; });

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

  // Complete or partial: the latest run's checkpoint (null before the first
  // run with checkpoints). last_refresh stays the end of the last complete run.
  const refresh = summarizeCheckpoint(loadCheckpoint(), employersConfig.employers);
  const payload = { roles, meta: { last_refresh: updatedAt, refresh }, coverage, targeting };

  // The board reads this file during a refresh; rename so it never sees half a file.
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  // The pid in the name: two processes (refresh, scoring) never share a temporary file.
  const tmp = `${OUTPUT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, OUTPUT_PATH);

  return { rolesWritten: roles.length, outputPath: OUTPUT_PATH };
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
