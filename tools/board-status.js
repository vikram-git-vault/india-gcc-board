#!/usr/bin/env node
/**
 * tools/board-status.js — what the last run did, in one report. Read-only.
 *
 *   node tools/board-status.js [--since YYYY-MM-DDTHH:MM]
 *
 * Without --since: from the start of the last refresh (the checkpoint).
 * Reports the refresh (employers ok and failed), the RM scoring, the
 * career-ops results, the warnings and errors in logs/refresh.log, and the
 * Claude cost. The /board-status skill (.claude/skills) reads this output.
 */
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { databasePath } from '../lib/database.js';
import { loadCheckpoint } from '../lib/checkpoint.js';

const args = process.argv.slice(2);
const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
const cp = loadCheckpoint();
const since = new Date(sinceArg || (cp && cp.started_at) || Date.now() - 24 * 3600e3);
// SQLite CURRENT_TIMESTAMP is UTC 'YYYY-MM-DD HH:MM:SS'.
const sqlSince = since.toISOString().slice(0, 19).replace('T', ' ');

const db = new sqlite3.Database(databasePath(), sqlite3.OPEN_READONLY);
const all = (sql, p = []) => new Promise((ok, no) => db.all(sql, p, (e, r) => (e ? no(e) : ok(r))));

const out = [];
const line = (s = '') => out.push(s);

line(`# Board status since ${since.toISOString()}`);

line('\n## Refresh');
if (!cp) line('No checkpoint (no refresh with checkpoints yet).');
else {
  const emps = Object.entries(cp.employers || {});
  const ok = emps.filter(([, e]) => e.status === 'ok');
  const failed = emps.filter(([, e]) => e.status === 'error');
  const sum = (k) => ok.reduce((n, [, e]) => n + (e[k] || 0), 0);
  line(`Run ${cp.run_id}: ${cp.completed_at ? `complete at ${cp.completed_at}` : 'NOT complete'}`);
  line(`Employers: ${ok.length} ok, ${failed.length} failed. Roles: ${sum('added')} added, ${sum('updated')} updated, ${sum('closed')} closed.`);
  failed.forEach(([id, e]) => line(`- FAILED ${id}: ${e.error}`));
}

line('\n## Log warnings and errors');
const log = fs.existsSync('logs/refresh.log') ? fs.readFileSync('logs/refresh.log', 'utf-8') : '';
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const recent = log.split('\n').map(clean).filter((l) => {
  const t = new Date(l.slice(0, 24));
  return !Number.isNaN(t.getTime()) && t >= since;
});
const problems = recent.filter((l) => /^\S+ (warn|error):/.test(l));
if (!problems.length) line('None.');
problems.slice(-40).forEach((l) => line(`- ${l.slice(0, 260)}`));
if (problems.length > 40) line(`(${problems.length - 40} earlier lines not shown)`);

line('\n## Run summaries');
recent.filter((l) => /\[autoscore\] Scored|\[tailor\] career-ops: \d+ roles|\[refresh\].*(Refreshed|complete)/i.test(l))
  .forEach((l) => line(`- ${l.slice(0, 260)}`));

// The named states of the roles on the board (lib/states.js), from the
// publisher's file: the RM score state and the career-ops state.
line('\n## Roles on the board by state');
try {
  const board = JSON.parse(fs.readFileSync('data/roles.json', 'utf-8'));
  const count = (key) => {
    const n = {};
    board.roles.forEach((r) => { const s = key(r); if (s) n[s] = (n[s] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${c} ${s}`).join(', ') || 'none';
  };
  line(`RM score: ${count((r) => r.score_state)}`);
  line(`career-ops: ${count((r) => r.tailor_state && r.tailor_state.state)}`);
  const attention = board.roles.filter((r) => r.tailor_state && ['retry', 'given_up', 'no_cv'].includes(r.tailor_state.state));
  attention.forEach((r) => line(`- ${r.id} ${r.employer}, ${r.title}: ${r.tailor_state.text}`));
  if (!board.roles.some((r) => r.tailor_state)) line('(The board file has no states yet: it is from before lib/states.js. The next refresh or scoring run writes them.)');
} catch (err) {
  line(`No board file (data/roles.json): ${err.message}`);
}

line('\n## career-ops results');
const tailored = await all(`
  SELECT t.role_id, e.name AS employer, r.title, t.status, t.score, t.cv_file, t.error, t.run_at
  FROM tailored_docs t JOIN roles r ON r.id = t.role_id JOIN employers e ON e.id = r.employer_id
  WHERE t.run_at >= ? ORDER BY t.run_at`, [sqlSince]);
if (!tailored.length) line('No roles evaluated.');
tailored.forEach((t) => line(`- ${t.role_id} ${t.employer}, ${t.title}: ${t.status}`
  + `${t.score != null ? `, ${t.score}/5` : ''}${t.cv_file ? ', Word CV' : ''}${t.error ? `, ERROR: ${t.error.slice(0, 160)}` : ''}`));

line('\n## Claude cost (list price)');
const calls = await all(`SELECT stage, COUNT(*) AS n, SUM(cost_usd) AS usd, SUM(ok = 0) AS failed
  FROM model_calls WHERE created_at >= ? AND shadow = 0 GROUP BY stage`, [sqlSince]);
if (!calls.length) line('No model calls.');
calls.forEach((c) => line(`- ${c.stage}: ${c.n} calls, $${c.usd.toFixed(2)}${c.failed ? `, ${c.failed} failed` : ''}`));
if (calls.length) line(`Total: $${calls.reduce((n, c) => n + c.usd, 0).toFixed(2)}`);

db.close();
console.log(out.join('\n'));
