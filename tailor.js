#!/usr/bin/env node
/**
 * tailor.js — send the best-matched roles to career-ops for a tailored Word
 * CV and cover letter.
 *
 *   node tailor.js [--max N] [--role ID]
 *
 * server.js runs this after the automatic scoring (tailoring.auto_tailor:
 * false in config/settings.json turns it off). For each active role whose
 * better RM score is at least tailoring.min_fit_score, and that career-ops
 * has not evaluated with the same description, it:
 *   1. writes the job description the board has to a file in career-ops,
 *   2. runs one career-ops worker (claude -p) with LIMITED permissions
 *      (lib/tailoring.js limitedSettings): no web tools, no network, file
 *      tools only in the career-ops folder, commands in the macOS sandbox,
 *   3. builds the Word CV and cover letter from the worker's JSON payloads
 *      (tools/build-cv-docx.py, tools/build-cover-docx.py) when the score
 *      passed career-ops' threshold, and runs career-ops' fact check on the
 *      text of each Word file,
 *   4. records the result (tailored_docs) and republishes the board.
 * The owner opens the posting and applies by hand: nothing is submitted.
 * Personal data (cv.md, profile, Word files) stays outside git.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createLogger } from './lib/logger.js';
import { settings } from './lib/settings.js';
import { reportProgress } from './lib/progress.js';
import { descriptionHash } from './lib/scoring.js';
import { initDb, closeDb, getRolesForTailoring, upsertTailored } from './lib/database.js';
import { publish } from './lib/publisher.js';
import {
  expandHome, safeName, docFolder, limitedSettings, workerPrompt, jobMessage, jdMarkdown, parseWorkerResult, extractGaps,
  extractDecision, localDate,
} from './lib/tailoring.js';

const logger = createLogger('tailor');
const T = settings.tailoring;
const CO = expandHome(T.career_ops_dir);
const OUTPUT_DIR = expandHome(T.output_dir);
const WORK_DIR = path.join('.cache', 'tailor');
const TEMPLATES = { cv: path.join('Resume', 'templates', 'resume.docx'), cover: path.join('Resume', 'templates', 'cover-letter.docx') };
// File names start with the owner's name from the career-ops profile, so
// no personal data is in this file: <Full_Name>_Resume.docx.
let CV_NAME = 'Resume.docx';
let COVER_NAME = 'Cover_Letter.docx';
function setFileNames() {
  const profile = fs.readFileSync(path.join(CO, 'config', 'profile.yml'), 'utf-8');
  const m = profile.match(/^\s*full_name:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (!m) return;
  const name = safeName(m[1]);
  CV_NAME = `${name}_Resume.docx`;
  COVER_NAME = `${name}_Cover_Letter.docx`;
}

let current = null;  // the running child, stopped with this process

function run(cmd, args, { cwd, timeoutMs, logFile } = {}) {
  return new Promise((resolve) => {
    const out = logFile ? fs.openSync(logFile, 'w') : null;
    const child = spawn(cmd, args, { cwd: cwd || process.cwd(), stdio: ['ignore', out ? out : 'pipe', out ? out : 'pipe'] });
    current = child;
    let stdout = '';
    let stderr = '';
    if (!out) {
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
    }
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs) : null;
    const finish = (code) => {
      if (timer) clearTimeout(timer);
      if (out) fs.closeSync(out);
      current = null;
      resolve({ code, stdout: out ? fs.readFileSync(logFile, 'utf-8') : stdout, stderr, timedOut });
    };
    child.on('error', (err) => { stderr += err.message; finish(-1); });
    child.on('close', (code) => finish(code === null ? -1 : code));
  });
}

function checkSetup() {
  const need = [CO, path.join(CO, 'cv.md'), path.join(CO, 'config', 'profile.yml'), path.join(CO, 'modes', '_profile.md'),
    path.join(CO, 'batch', 'batch-prompt.md'), TEMPLATES.cv, TEMPLATES.cover];
  const missing = need.filter((f) => !fs.existsSync(f));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
}

async function buildPromptFile() {
  const read = (f) => fs.readFileSync(path.join(CO, f), 'utf-8');
  const contextFiles = ['modes/_profile.md', 'config/profile.yml', 'modes/_custom.md']
    .filter((f) => fs.existsSync(path.join(CO, f))).map((f) => ({ name: f, text: read(f) }));
  const example = await run('textutil', ['-convert', 'txt', '-stdout', TEMPLATES.cover]);
  const text = workerPrompt({
    batchPrompt: read('batch/batch-prompt.md'),
    contextFiles,
    rules: fs.readFileSync(path.join('config', 'tailoring-rules.md'), 'utf-8'),
    exampleLetter: example.code === 0 ? example.stdout.trim() : '',
  });
  const file = path.join(WORK_DIR, 'worker-prompt.md');
  fs.writeFileSync(file, text);
  const settingsFile = path.join(WORK_DIR, 'limited-settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify(limitedSettings(CO), null, 2));
  return { promptFile: path.resolve(file), settingsFile: path.resolve(settingsFile) };
}

const newest = (dir, re) => {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
};

// Builds one Word file and runs career-ops' fact check on its text.
// Returns null when it passed, or the reason it failed (the file is removed).
async function buildDoc(kind, payload, outFile, reportNum) {
  const script = kind === 'cv' ? 'tools/build-cv-docx.py' : 'tools/build-cover-docx.py';
  const args = ['-I', script, payload, outFile, TEMPLATES[kind]];
  if (kind === 'cv') args.push(path.join(CO, 'cv.md'));
  const built = await run('python3', args);
  if (built.code !== 0) return `Word build failed: ${(built.stderr || built.stdout).slice(-300)}`;
  logger.info(built.stdout.trim());
  const html = await run('textutil', ['-convert', 'html', '-stdout', outFile]);
  const htmlFile = path.join(CO, 'output', `${kind}-docx-${reportNum}.html`);
  fs.writeFileSync(htmlFile, html.stdout);
  const check = await run('node', ['verify-cv-facts.mjs', htmlFile], { cwd: CO });
  if (check.code !== 0) {
    fs.rmSync(outFile, { force: true });
    return `fact check failed on the Word ${kind === 'cv' ? 'CV' : 'cover letter'}: ${(check.stdout + check.stderr).slice(-400)}`;
  }
  return null;
}

async function tailorRole(role, files) {
  const hash = descriptionHash(role.title, role.description);
  const date = localDate(settings.schedule.timezone);
  const jdFile = path.join(CO, 'jds', `board-${role.id}.md`);
  fs.mkdirSync(path.dirname(jdFile), { recursive: true });
  fs.writeFileSync(jdFile, jdMarkdown(role));

  const reserved = await run('node', ['reserve-report-num.mjs'], { cwd: CO });
  const reportNum = reserved.stdout.trim();
  if (reserved.code !== 0 || !/^\d{3,}$/.test(reportNum)) throw new Error(`reserve-report-num.mjs failed: ${reserved.stdout}${reserved.stderr}`);
  const logFile = path.join(CO, 'batch', 'logs', `${reportNum}-board-${role.id}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const started = Date.now();
  const worker = await run('claude', [
    '-p', '--model', T.model, '--strict-mcp-config', '--permission-mode', 'dontAsk', '--no-session-persistence',
    '--settings', files.settingsFile, '--append-system-prompt-file', files.promptFile,
    jobMessage({ url: role.job_url, jdFile, reportNum, date, roleId: role.id }),
  ], { cwd: CO, timeoutMs: T.worker_timeout_minutes * 60000, logFile });
  const seconds = Math.round((Date.now() - started) / 1000);
  const result = parseWorkerResult(worker.stdout);

  const base = { role_id: role.id, description_hash: hash, report_num: reportNum };
  const failed = (error) => ({ ...base, status: 'failed', error, attempts: (role.tailored_hash === hash ? role.attempts || 0 : 0) + 1 });
  if (!result || result.status === 'failed' || typeof result.score !== 'number') {
    await run('node', ['reserve-report-num.mjs', '--release', reportNum], { cwd: CO });
    const why = worker.timedOut ? `the worker took more than ${T.worker_timeout_minutes} minutes`
      : (result && result.error) || `no result from the worker (exit ${worker.code}); see ${logFile}`;
    return failed(why);
  }

  const report = newest(path.join(CO, 'reports'), new RegExp(`^${reportNum}-(?!RESERVED).*\\.md$`));
  const reportText = report ? fs.readFileSync(report, 'utf-8') : '';
  const gaps = extractGaps(reportText);
  const rec = { ...base, status: 'evaluated', score: result.score, decision: extractDecision(reportText), gaps };
  const cvPayload = newest(path.join(CO, 'output'), new RegExp(`^cv-payload-${reportNum}-.*\\.json$`));
  if (cvPayload) {
    const folder = docFolder(OUTPUT_DIR, role.employer, role.title, date);
    fs.mkdirSync(folder, { recursive: true });
    const cvError = await buildDoc('cv', cvPayload, path.join(folder, CV_NAME), reportNum);
    if (cvError) return { ...failed(cvError), score: result.score, gaps };
    const coverPayload = newest(path.join(CO, 'output'), new RegExp(`^cover-payload-${reportNum}-.*\\.json$`));
    let coverError = coverPayload ? await buildDoc('cover', coverPayload, path.join(folder, COVER_NAME), reportNum) : 'no cover letter payload';
    if (coverError) logger.warn(`Role ${role.id}: cover letter not made: ${coverError}`);
    fs.copyFileSync(jdFile, path.join(folder, 'job_description.md'));
    if (report) fs.copyFileSync(report, path.join(folder, 'evaluation.md'));
    Object.assign(rec, { status: 'ready', folder, cv_file: CV_NAME, cover_file: coverError ? null : COVER_NAME, error: coverError });
  }
  logger.info(`Role ${role.id} (${role.employer}, ${role.title}): career-ops ${result.score}/5, ${rec.status === 'ready' ? 'Word CV made' : 'below the CV threshold'}, ${gaps.length} gaps, ${seconds}s`);
  return rec;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
  const max = Number(opt('--max')) || T.max_roles_per_run;
  const onlyRole = opt('--role') ? Number(opt('--role')) : null;

  checkSetup();
  setFileNames();
  fs.mkdirSync(WORK_DIR, { recursive: true });
  await initDb();
  const rows = await getRolesForTailoring(T.min_fit_score);
  // Not yet sent, or sent with another description; failed fewer than max_attempts times.
  const todo = rows.filter((r) => (onlyRole ? r.id === onlyRole
    : (r.tailored_hash !== descriptionHash(r.title, r.description)
      || (r.tailored_status === 'failed' && (r.attempts || 0) < T.max_attempts))));
  const batch = todo.slice(0, max);
  logger.info(`${todo.length} roles need career-ops${todo.length > batch.length ? `; this run sends ${batch.length}` : ''}`);
  const counts = { done: 0, ready: 0, failed: 0 };
  reportProgress('tailor', { total: batch.length, ...counts });
  if (!batch.length) return;

  const files = await buildPromptFile();
  for (const role of batch) {
    reportProgress('tailor', { total: batch.length, item: `${role.employer}: ${role.title}`, ...counts });
    let rec;
    try {
      rec = await tailorRole(role, files);
    } catch (err) {
      rec = { role_id: role.id, description_hash: descriptionHash(role.title, role.description), status: 'failed', error: err.message, attempts: (role.attempts || 0) + 1 };
    }
    if (rec.status === 'failed') logger.warn(`Role ${role.id} (${role.employer}, ${role.title}): ${rec.error}`);
    await upsertTailored(rec);
    counts.done += 1;
    if (rec.status === 'ready') counts.ready += 1;
    if (rec.status === 'failed') counts.failed += 1;
    await publish();
    reportProgress('tailor', { total: batch.length, ...counts });
  }
  // Keep career-ops' own tracker (data/applications.md) up to date.
  await run('node', ['merge-tracker.mjs'], { cwd: CO });
  logger.info(`career-ops: ${counts.done} roles evaluated, ${counts.ready} Word CVs made, ${counts.failed} failed`);
}

const isMain = () => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (process.argv[1] && isMain()) {
  // server.js stops tailoring when a refresh starts: stop the worker too.
  process.on('SIGTERM', () => {
    if (current) current.kill('SIGTERM');
    logger.info('Tailoring stopped by the server (a refresh started)');
    process.exit(143);
  });
  main().catch((err) => {
    logger.error(`Tailoring stopped: ${err.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    await closeDb().catch(() => {});
    if (process.connected) process.disconnect();
  });
}
