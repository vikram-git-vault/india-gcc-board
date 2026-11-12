#!/usr/bin/env node
/**
 * tools/find-role.js — find board roles by role id, employer job id or job URL.
 * Read-only.
 *
 *   node tools/find-role.js 18054 R-2680072 https://walmart.wd5.myworkdayjobs.com/...
 *
 * For each match: the role id, employer, title, and the named state of
 * each machine (lib/states.js): open or closed, the job text, the RM
 * score, career-ops, the mark, and what `node tailor.js --role ID` will
 * do. The /tailor-role skill (.claude/skills) reads this output.
 */
import sqlite3 from 'sqlite3';
import { databasePath } from '../lib/database.js';
import { settings } from '../lib/settings.js';
import { rubricVersion } from '../lib/scoring.js';
import { MIN_FULL_DESCRIPTION_CHARS } from '../lib/descriptions.js';
import { roleState, descriptionState, rmState, tailorState, readScoreAttempts, RM_STATES } from '../lib/states.js';
import { ageCutoff, localDate, expandHome, readCvMinScore, trackerStatus } from '../lib/tailoring.js';

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('Usage: node tools/find-role.js <role id | job id | job URL> ...');
  process.exit(1);
}
const db = new sqlite3.Database(databasePath(), sqlite3.OPEN_READONLY);
const all = (sql, p = []) => new Promise((ok, no) => db.all(sql, p, (e, r) => (e ? no(e) : ok(r))));
// Same key as the board's job id search (frontend/public/js/board.js idKey).
const idKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const minFit = settings.tailoring.min_fit_score;
const today = localDate(settings.schedule.timezone);
const boardFrom = ageCutoff(today, settings.board.max_age_days);
const cvMinScore = readCvMinScore(expandHome(settings.tailoring.career_ops_dir));
const rmOpts = { rubric: rubricVersion(), rescoreMinFit: settings.scoring.rescore_min_fit, boardFrom, attempts: readScoreAttempts(), maxAttempts: settings.scoring.max_attempts };
const tailorOpts = { minFit, cvMinScore, maxAttempts: settings.tailoring.max_attempts, boardFrom };

const SELECT = `
  SELECT r.id, e.name AS employer, r.title, r.location, r.is_active, r.tier, r.source, r.deadline, r.external_job_id, r.job_url,
         COALESCE(r.full_description, r.description, '') AS description, r.description_status, r.description_fetched_at,
         COALESCE(r.posted_date, DATE(r.scraped_at)) AS age_date, r.changed_date,
         s.po_fit, s.em_fit, s.fit_score, s.description_hash AS scored_hash, s.rubric_version AS scored_rubric_version,
         t.status AS tailored_status, t.score AS tailored_score, t.description_hash AS tailored_hash, t.attempts, t.rerun,
         t.cv_file, t.folder, t.report_num,
         m.status AS mark, m.tracker_status
  FROM roles r JOIN employers e ON e.id = r.employer_id
  LEFT JOIN role_scores s ON s.role_id = r.id
  LEFT JOIN tailored_docs t ON t.role_id = r.id
  LEFT JOIN marks m ON m.role_id = r.id`;

for (const input of inputs) {
  let rows;
  if (/^\d+$/.test(input) && input.length <= 6) {
    rows = await all(`${SELECT} WHERE r.id = ?`, [Number(input)]);
  } else if (/^https?:\/\//.test(input)) {
    const url = input.split(/[?#]/)[0].replace(/\/$/, '');
    rows = await all(`${SELECT} WHERE r.job_url LIKE ?`, [`${url}%`]);
    // A URL that differs in its path still names the job id at its end.
    const tail = url.split('/').pop().match(/[A-Za-z]*[-_]?\d{4,}(?:[-_]\d+)?/);
    if (!rows.length && tail) rows = await byJobId(tail[0]);
  } else {
    rows = await byJobId(input);
  }
  console.log(`\n## ${input}`);
  if (!rows.length) { console.log('NOT FOUND: the board has not scraped this role.'); continue; }
  rows.forEach((r) => {
    const scored = r.fit_score != null;
    const bestFit = scored ? Math.max(r.po_fit || 0, r.em_fit || 0) : null;
    const life = roleState(r, today);
    const text = descriptionState(r, { descriptions: settings.descriptions, minChars: MIN_FULL_DESCRIPTION_CHARS });
    const rm = rmState({ ...r, scored_best_fit: bestFit }, rmOpts);
    const co = tailorState({ ...r, best_fit: bestFit, tailored_cv: r.cv_file }, tailorOpts);
    console.log(`role ${r.id}: ${r.employer}, ${r.title} (${r.location || 'no location'})`);
    console.log(`  job id ${r.external_job_id || 'none'}; ${life.state === 'open' ? 'active' : 'CLOSED'}${life.why ? ` (${life.why})` : ''}; tier ${r.tier || 'unclassified'}${life.manual ? '; manual' : ''}`);
    console.log(`  dates: posted or found ${r.age_date || 'unknown'}${r.changed_date ? `, changed ${r.changed_date}` : ''}; board window from ${boardFrom}`);
    console.log(`  job text: ${text.state}${text.due ? ' (fetched again in the next refresh)' : ''}`);
    console.log(`  RM best fit: ${scored ? `${bestFit} (${rm}${rm === 'scored' ? '' : `: ${RM_STATES[rm]}`})` : `NOT SCORED (${rm}: ${RM_STATES[rm]})`}`);
    console.log(`  career-ops: ${r.tailored_status ? `${r.tailored_status}${r.tailored_score != null ? `, ${r.tailored_score}/5` : ''}${r.cv_file ? ', Word CV made' : ''}` : 'not run'}`);
    console.log(`  career-ops state: ${co.state}: ${co.text}; the next automatic run sends it: ${co.next ? 'yes' : 'no'}`);
    if (r.folder) console.log(`  folder: ${r.folder}`);
    console.log(`  mark: ${r.mark || 'none'}${r.report_num ? ` (tracker status: ${r.tracker_status || 'Evaluated'}; the mark asks for ${trackerStatus(r.mark || null)})` : ''}`);
    if (!r.is_active) console.log('  tailor.js: the role is closed; tailor.js selects only active roles.');
    else if (!scored) console.log(`  tailor.js: not RM scored yet; ${rm === 'given_up' ? 'autoscore.js does not send it again until the description changes' : 'run node autoscore.js first (it scores all pending roles)'}.`);
    else if (bestFit >= minFit) console.log(`  tailor.js: node tailor.js --role ${r.id}  (RM ${bestFit} >= ${minFit}: a Word CV if career-ops >= ${cvMinScore == null ? 'the threshold' : cvMinScore})`);
    else console.log(`  tailor.js: node tailor.js --role ${r.id} --any-fit  (RM ${bestFit} < ${minFit}: score and gaps only, never a Word CV${life.manual ? '; --force-cv makes one anyway' : ''})`);
  });
}
db.close();

async function byJobId(jobId) {
  const key = idKey(jobId);
  if (key.length < 4) return [];
  const rows = await all(`${SELECT} WHERE r.external_job_id IS NOT NULL`);
  return rows.filter((r) => idKey(r.external_job_id) === key || idKey(r.external_job_id).startsWith(key));
}
