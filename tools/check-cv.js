#!/usr/bin/env node
/**
 * tools/check-cv.js — check tailored CVs against the CV rules. Read-only.
 *
 *   node tools/check-cv.js ROLE_ID [ROLE_ID ...]
 *
 * For each role: the length and style rules (checkDocLimits in
 * lib/tailoring.js) on the worker's payloads, the career-ops fact check
 * (verify-cv-facts.mjs) on the text of the Word files as tailor.js built
 * them (output/<kind>-docx-<report>.html), and the owner's checks that need
 * a person to decide (cv_checks.review in config/private/owner.json,
 * marked REVIEW). It changes no file.
 * The /check-cv skill (.claude/skills) reads this output.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import sqlite3 from 'sqlite3';
import { databasePath } from '../lib/database.js';
import { settings } from '../lib/settings.js';
import { expandHome, checkDocLimits } from '../lib/tailoring.js';
import { loadOwner } from '../lib/owner.js';

const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
if (!ids.length) {
  console.error('Usage: node tools/check-cv.js ROLE_ID [ROLE_ID ...]');
  process.exit(1);
}
const CO = expandHome(settings.tailoring.career_ops_dir);
const OUT = path.join(CO, 'output');
const db = new sqlite3.Database(databasePath(), sqlite3.OPEN_READONLY);
const get = (sql, p) => new Promise((ok, no) => db.get(sql, p, (e, r) => (e ? no(e) : ok(r))));

const payload = (kind, num) => {
  const re = new RegExp(`^${kind}-payload-${num}-.*\\.json$`);
  const f = fs.readdirSync(OUT).filter((n) => re.test(n))
    .map((n) => path.join(OUT, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return f ? { file: f, data: JSON.parse(fs.readFileSync(f, 'utf-8')) } : null;
};
// All the text of a payload, one string per field.
const texts = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(texts) : []);
const sentences = (s) => s.replace(/\*\*/g, '').split(/(?<=[.;])\s+/);

let failed = 0;
for (const id of ids) {
  const t = await get(`SELECT t.*, e.name AS employer, r.title FROM tailored_docs t
    JOIN roles r ON r.id = t.role_id JOIN employers e ON e.id = r.employer_id WHERE t.role_id = ?`, [Number(id)]);
  console.log(`\n## Role ${id}${t ? `: ${t.employer}, ${t.title}` : ''}`);
  if (!t) { console.log('career-ops has not run on this role.'); continue; }
  if (!t.cv_file) { console.log(`No Word CV (status ${t.status}${t.score != null ? `, ${t.score}/5` : ''}). Nothing to check.`); continue; }
  console.log(`report ${t.report_num}; folder ${t.folder}`);

  const cv = payload('cv', t.report_num);
  const cover = payload('cover', t.report_num);
  if (!cv) { console.log(`FAIL: no cv-payload-${t.report_num}-*.json in ${OUT}`); failed += 1; continue; }

  const warn = checkDocLimits(cv.data, cover && cover.data);
  console.log(`\nRules (${warn.length ? `${warn.length} warnings` : 'all met'}):`);
  warn.forEach((w) => console.log(`- WARN ${w}`));

  // Sentences that mix facts which must stay apart (the owner CV rules).
  const all = texts(cv.data).flatMap(sentences);
  for (const r of loadOwner().review) {
    all.filter((s) => r.all.every((re) => re.test(s))).forEach((s) => console.log(`- REVIEW ${r.name}: "${s}"`));
  }

  console.log('\nFact check (career-ops, on the Word text as built):');
  for (const kind of ['cv', 'cover']) {
    const html = path.join(OUT, `${kind}-docx-${t.report_num}.html`);
    if (!fs.existsSync(html)) { console.log(`- ${kind}: no ${path.basename(html)}`); continue; }
    const text = fs.readFileSync(html, 'utf-8');
    if (/[–—]/.test(text.replace(/<[^>]+>/g, ''))) console.log(`- WARN ${kind}: the Word text has em or en dashes`);
    const r = spawnSync('node', ['verify-cv-facts.mjs', html], { cwd: CO, encoding: 'utf-8' });
    const tail = `${r.stdout}${r.stderr}`.trim().split('\n').slice(-12).join('\n  ');
    console.log(`- ${kind}: ${r.status === 0 ? 'PASS' : 'FAIL'}\n  ${tail}`);
    if (r.status !== 0) failed += 1;
  }
}
db.close();
process.exitCode = failed ? 1 : 0;
