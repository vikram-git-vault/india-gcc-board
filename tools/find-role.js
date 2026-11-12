#!/usr/bin/env node
/**
 * tools/find-role.js — find board roles by role id, employer job id or job URL.
 * Read-only.
 *
 *   node tools/find-role.js 18054 R-2680072 https://walmart.wd5.myworkdayjobs.com/...
 *
 * For each match: the role id, employer, title, active flag, tier, the
 * better RM score, the career-ops result and what `node tailor.js --role ID`
 * will do. The /tailor-role skill (.claude/skills) reads this output.
 */
import sqlite3 from 'sqlite3';
import { databasePath } from '../lib/database.js';
import { settings } from '../lib/settings.js';

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

const SELECT = `
  SELECT r.id, e.name AS employer, r.title, r.location, r.is_active, r.tier, r.external_job_id, r.job_url,
         MAX(COALESCE(s.po_fit, 0), COALESCE(s.em_fit, 0)) AS best_fit, s.fit_score,
         t.status AS t_status, t.score AS t_score, t.cv_file, t.folder
  FROM roles r JOIN employers e ON e.id = r.employer_id
  LEFT JOIN role_scores s ON s.role_id = r.id
  LEFT JOIN tailored_docs t ON t.role_id = r.id`;

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
    console.log(`role ${r.id}: ${r.employer}, ${r.title} (${r.location || 'no location'})`);
    console.log(`  job id ${r.external_job_id || 'none'}; ${r.is_active ? 'active' : 'CLOSED'}; tier ${r.tier || 'unclassified'}`);
    console.log(`  RM best fit: ${scored ? r.best_fit : 'NOT SCORED'}`);
    console.log(`  career-ops: ${r.t_status ? `${r.t_status}${r.t_score != null ? `, ${r.t_score}/5` : ''}${r.cv_file ? ', Word CV made' : ''}` : 'not run'}`);
    if (r.folder) console.log(`  folder: ${r.folder}`);
    if (!r.is_active) console.log('  tailor.js: the role is closed; tailor.js selects only active roles.');
    else if (!scored) console.log('  tailor.js: not RM scored yet; run node autoscore.js first (it scores all pending roles).');
    else if (r.best_fit >= minFit) console.log(`  tailor.js: node tailor.js --role ${r.id}  (RM ${r.best_fit} >= ${minFit}: a Word CV if career-ops >= the threshold)`);
    else console.log(`  tailor.js: node tailor.js --role ${r.id} --any-fit  (RM ${r.best_fit} < ${minFit}: score and gaps only, never a Word CV)`);
  });
}
db.close();

async function byJobId(jobId) {
  const key = idKey(jobId);
  if (key.length < 4) return [];
  const rows = await all(`${SELECT} WHERE r.external_job_id IS NOT NULL`);
  return rows.filter((r) => idKey(r.external_job_id) === key || idKey(r.external_job_id).startsWith(key));
}
