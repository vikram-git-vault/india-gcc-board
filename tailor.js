#!/usr/bin/env node
/**
 * tailor.js — send the best-matched roles to career-ops for a tailored Word
 * CV and cover letter.
 *
 *   node tailor.js [--max N] [--role ID [--any-fit] [--force-cv]] [--since YYYY-MM-DD]
 *
 * career-ops evaluates roles of all ages, as the RM scoring does. A Word CV
 * is made only for a role posted, or changed by the employer, in the last
 * tailoring.max_age_days days (3); --role always makes one. A new CV goes
 * to a new folder; the earlier CVs stay. --since: only roles posted on or after
 * that date. --any-fit (with --role): evaluate the roles also when the RM
 * score is below min_fit_score; the CV gate does not change. --force-cv (with
 * --role): a Word CV also when the role fails the gate (the board's "Make CV
 * anyway" button for a job the owner added by hand). Roles posted last go first. A Claude usage limit stops the run; the roles not sent wait for
 * the next run and do not count as failed.
 *
 * server.js runs this after the automatic scoring (tailoring.auto_tailor:
 * false in config/settings.json turns it off). For each active role whose
 * better RM score is at least tailoring.min_fit_score, and that career-ops
 * has not evaluated with the same description, it:
 *   1. writes the job description the board has to a file in career-ops,
 *   2. runs one career-ops worker (claude -p) with LIMITED permissions
 *      (lib/tailoring.js limitedSettings): no web tools, no network, file
 *      tools only in the career-ops folder, commands in the macOS sandbox.
 *      First message: the evaluation, on the scoring model (stage
 *      careerops_score). When the RM score and the career-ops score pass
 *      the gate, a second message in the SAME session (--resume) asks for
 *      the CV and cover letter payloads on the documents model (stage
 *      application_package). The second model sees the whole evaluation:
 *      every file the worker read and everything it wrote,
 *   3. builds the Word CV and cover letter from the worker's JSON payloads
 *      (tools/build-cv-docx.py, tools/build-cover-docx.py) and runs
 *      career-ops' fact check on the text of each Word file,
 *   4. records the result (tailored_docs) and republishes the board.
 * --trial DIR (with --role ID[,ID]): the Word files go to DIR; the board
 * database, the board and the career-ops tracker do not change. For a
 * side-by-side check with the files made before.
 * The owner opens the posting and applies by hand: nothing is submitted.
 * Personal data (cv.md, profile, Word files) stays outside git.
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createLogger } from './lib/logger.js';
import { settings } from './lib/settings.js';
import { reportProgress } from './lib/progress.js';
import { descriptionHash } from './lib/scoring.js';
import { initDb, closeDb, getRolesForTailoring, upsertTailored, recordModelCall } from './lib/database.js';
import { claudeCall, modelFor, parseEnvelope, usageFromEnvelope, routeLine } from './lib/models.js';
import { publish } from './lib/publisher.js';
import { loadOwner, ownerRules } from './lib/owner.js';
import { ensureTracker, syncTracker } from './lib/tracker-sync.js';
import {
  expandHome, ageCutoff, selectForTailoring, cvAllowed, cvDate, safeName, docFolder, freeFolder, limitedSettings, workerPrompt, jobMessage, documentsMessage, roleLens, cvLocation, jdMarkdown, parseWorkerResult, reportScore,
  extractGaps, extractDecision, localDate, usageLimitMessage, documentThreshold, qualifies, checkDocLimits, markTrackerPdf,
} from './lib/tailoring.js';

const logger = createLogger('tailor');
const T = settings.tailoring;
const CO = expandHome(T.career_ops_dir);
let OUTPUT_DIR = expandHome(T.output_dir);
let TRIAL = false;
// Word CVs only for roles posted on or after this date; --role: always.
let CV_CUTOFF = null;
let FORCED = false;
// --force-cv: no RM or career-ops gate for the CV (the owner's choice).
let FORCE_CV = false;
// career-ops' CV threshold (config/profile.yml auto_pdf_score_threshold).
let MIN_CAREER_OPS = 3.0;
const WORK_DIR = path.join('.cache', 'tailor');
const TEMPLATES = { cv: path.join('Resume', 'templates', 'resume.docx'), cover: path.join('Resume', 'templates', 'cover-letter.docx') };
// File names start with the owner's name from the career-ops profile, so
// no personal data is in this file: <Full_Name>_Resume.docx.
let CV_NAME = 'Resume.docx';
let COVER_NAME = 'Cover_Letter.docx';
function setFileNames() {
  const profile = fs.readFileSync(path.join(CO, 'config', 'profile.yml'), 'utf-8');
  MIN_CAREER_OPS = documentThreshold(profile);
  const m = profile.match(/^\s*full_name:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (!m) return;
  const name = safeName(m[1]);
  CV_NAME = `${name}_Resume.docx`;
  COVER_NAME = `${name}_Cover_Letter.docx`;
}

let current = null;  // the running child, stopped with this process

class UsageLimitError extends Error {}

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
    rules: `${fs.readFileSync(path.join('config', 'tailoring-rules.md'), 'utf-8')}\n\n${ownerRules().text}`,
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
async function buildDoc(kind, payload, outFile, reportNum, role = null) {
  const script = kind === 'cv' ? 'tools/build-cv-docx.py' : 'tools/build-cover-docx.py';
  const args = ['-I', script, payload, outFile, TEMPLATES[kind]];
  if (kind === 'cv') args.push(path.join(CO, 'cv.md'));
  const city = kind === 'cv' && role ? cvLocation(role.location, loadOwner().home_city) : null;
  if (city) args.push('--location', city);
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

// The session file of a worker (Claude Code keeps it under
// ~/.claude/projects/<folder>/<id>.jsonl). Removed when the role is done:
// it holds the CV text and is not needed after the second message.
function removeSession(sessionId) {
  if (!/^[0-9a-f-]{36}$/.test(String(sessionId || ''))) return;
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return;
  for (const dir of fs.readdirSync(root)) {
    const file = path.join(root, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

// One message to the worker, through the model router. resume: the
// session of the first message (the second message continues it).
async function workerCall(stage, message, files, { roleId, logFile, resume = null }) {
  const model = modelFor(stage);
  const call = claudeCall(stage, [
    ...(resume ? ['--resume', resume, '--no-session-persistence'] : []),
    '--strict-mcp-config', '--permission-mode', 'dontAsk',
    '--settings', files.settingsFile, '--append-system-prompt-file', files.promptFile, message,
  ]);
  const worker = await run(call.cmd, call.args, { cwd: CO, timeoutMs: T.worker_timeout_minutes * 60000, logFile });
  const envelope = parseEnvelope(worker.stdout);
  const usage = envelope ? usageFromEnvelope(envelope) : null;
  const ok = worker.code === 0 && !!envelope && !envelope.is_error;
  logger.info(`Role ${roleId}: router ${routeLine(stage, model, usage)}`);
  if (usage && !usage.models.includes(model)) logger.warn(`Role ${roleId}: the router asked for ${model}, Claude Code used ${usage.models.join(', ')}`);
  await recordModelCall({ stage, model, usage, roleId, ok, error: ok ? null : `exit ${worker.code}${worker.timedOut ? ' (time limit)' : ''}`, shadow: TRIAL });
  const text = envelope ? String(envelope.result || '') : worker.stdout;
  return { worker, text, sessionId: envelope && envelope.session_id, limit: ok ? null : usageLimitMessage(`${text}\n${worker.stderr}`) };
}

// "posted 2026-11-06" or "posted 2026-10-20, changed 2026-11-06".
function dateText(role) {
  const posted = `posted ${role.age_date || 'on an unknown date'}`;
  return role.changed_date && role.changed_date > (role.age_date || '') ? `${posted}, changed ${role.changed_date}` : posted;
}

// onStep(step, model): tailorRole calls it when a message to the worker
// starts, for the progress lines in the server log.
async function tailorRole(role, files, onStep = () => {}) {
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
  onStep('career-ops evaluation', modelFor('careerops_score'));
  const evaluation = await workerCall('careerops_score', jobMessage({ url: role.job_url, jdFile, reportNum, date, roleId: role.id }), files,
    { roleId: role.id, logFile });
  let result = parseWorkerResult(evaluation.text);
  // The worker finished but left out its result block: use the score of
  // its report, when it wrote one.
  if (!result && !evaluation.limit && !evaluation.worker.timedOut) {
    const written = newest(path.join(CO, 'reports'), new RegExp(`^${reportNum}-(?!RESERVED).*\\.md$`));
    const score = written ? reportScore(fs.readFileSync(written, 'utf-8')) : null;
    if (score != null) {
      logger.warn(`Role ${role.id}: the worker gave no result block; the score ${score}/5 comes from its report`);
      result = { status: 'completed', score };
    }
  }

  const base = { role_id: role.id, description_hash: hash, report_num: reportNum };
  // outcome: for the progress lines only (upsertTailored does not store it).
  const failed = (error) => ({ ...base, status: 'failed', outcome: 'failed', error, attempts: (role.tailored_hash === hash ? role.attempts || 0 : 0) + 1 });
  try {
    if (!result || result.status === 'failed' || typeof result.score !== 'number') {
      await run('node', ['reserve-report-num.mjs', '--release', reportNum], { cwd: CO });
      if (!result && evaluation.limit) throw new UsageLimitError(evaluation.limit);
      const why = evaluation.worker.timedOut ? `the worker took more than ${T.worker_timeout_minutes} minutes`
        : (result && result.error) || `no result from the worker (exit ${evaluation.worker.code}); see ${logFile}`;
      return failed(why);
    }

    const report = newest(path.join(CO, 'reports'), new RegExp(`^${reportNum}-(?!RESERVED).*\\.md$`));
    const reportText = report ? fs.readFileSync(report, 'utf-8') : '';
    const gaps = extractGaps(reportText);
    const rec = { ...base, status: 'evaluated', outcome: 'below', score: result.score, decision: extractDecision(reportText), gaps };
    const passed = qualifies({ bestFit: role.best_fit, careerOpsScore: result.score }, { minFit: T.min_fit_score, minScore: MIN_CAREER_OPS });
    if (!passed && FORCE_CV) logger.info(`Role ${role.id}: below the gate (RM ${role.best_fit}, career-ops ${result.score}/5); the owner asked for a CV anyway`);
    if (!passed && !FORCE_CV) {
      logger.info(`Role ${role.id} (${role.employer}, ${role.title}): career-ops ${result.score}/5, below the CV threshold ${MIN_CAREER_OPS}, ${gaps.length} gaps, ${Math.round((Date.now() - started) / 1000)}s`);
      return rec;
    }
    if (!cvAllowed(role, CV_CUTOFF, FORCED)) {
      logger.info(`Role ${role.id} (${role.employer}, ${role.title}): career-ops ${result.score}/5, passes the gate, but ${dateText(role)}, before ${CV_CUTOFF}: no Word CV (tailoring.max_age_days)`);
      return { ...rec, outcome: 'too_old' };
    }
    if (!evaluation.sessionId) return { ...failed('the evaluation reply has no session id, so the CV cannot continue it'), score: result.score, gaps };

    // Second message, same session: the documents model sees the whole
    // evaluation.
    const docsLog = logFile.replace(/\.log$/, '-documents.log');
    onStep('CV and cover letter', modelFor('application_package'));
    const lens = roleLens(role);
    if (lens) logger.info(`Role ${role.id}: ${lens.lens} CV (${lens.why})`);
    const documents = await workerCall('application_package', documentsMessage({ reportNum, lens }), files,
      { roleId: role.id, logFile: docsLog, resume: evaluation.sessionId });
    const docsResult = parseWorkerResult(documents.text);
    if (!docsResult && documents.limit) {
      // Not counted as a failed attempt: the role is sent again next run.
      logger.warn(`Role ${role.id}: Claude usage limit during the CV; the role is sent again next run`);
      throw new UsageLimitError(documents.limit);
    }
    const cvPayload = newest(path.join(CO, 'output'), new RegExp(`^cv-payload-${reportNum}-.*\\.json$`));
    if (!cvPayload || (docsResult && docsResult.status === 'failed' && !docsResult.cv_payload)) {
      const why = documents.worker.timedOut ? `the CV worker took more than ${T.worker_timeout_minutes} minutes`
        : (docsResult && docsResult.error) || `no CV payload from the worker (exit ${documents.worker.code}); see ${docsLog}`;
      return { ...failed(why), score: result.score, decision: rec.decision, gaps };
    }

    const folder = freeFolder(docFolder(OUTPUT_DIR, role.employer, role.title, date, role.external_job_id || String(role.id)));
    fs.mkdirSync(folder, { recursive: true });
    const cvError = await buildDoc('cv', cvPayload, path.join(folder, CV_NAME), reportNum, role);
    if (cvError) return { ...failed(cvError), score: result.score, decision: rec.decision, gaps };
    const coverPayload = newest(path.join(CO, 'output'), new RegExp(`^cover-payload-${reportNum}-.*\\.json$`));
    const coverError = coverPayload ? await buildDoc('cover', coverPayload, path.join(folder, COVER_NAME), reportNum) : 'no cover letter payload';
    if (coverError) logger.warn(`Role ${role.id}: cover letter not made: ${coverError}`);
    const limits = checkDocLimits(JSON.parse(fs.readFileSync(cvPayload, 'utf-8')),
      coverPayload && !coverError ? JSON.parse(fs.readFileSync(coverPayload, 'utf-8')) : null);
    if (limits.length) logger.warn(`Role ${role.id}: length rules not met: ${limits.join('; ')}`);
    fs.copyFileSync(jdFile, path.join(folder, 'job_description.md'));
    if (report) fs.copyFileSync(report, path.join(folder, 'evaluation.md'));
    const tsv = path.join(CO, 'batch', 'tracker-additions', `board-${role.id}.tsv`);
    if (!TRIAL && fs.existsSync(tsv)) fs.writeFileSync(tsv, markTrackerPdf(fs.readFileSync(tsv, 'utf-8')));
    Object.assign(rec, { status: 'ready', outcome: 'ready', folder, cv_file: CV_NAME, cover_file: coverError ? null : COVER_NAME, error: coverError });
    logger.info(`Role ${role.id} (${role.employer}, ${role.title}): career-ops ${result.score}/5, Word CV made, ${gaps.length} gaps, ${Math.round((Date.now() - started) / 1000)}s`);
    return rec;
  } finally {
    removeSession(evaluation.sessionId);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
  const max = Number(opt('--max')) || T.max_roles_per_run;
  const onlyRoles = opt('--role') ? new Set(String(opt('--role')).split(',').map(Number)) : null;
  if (opt('--trial')) {
    if (!onlyRoles) throw new Error('--trial needs --role ID[,ID]');
    TRIAL = true;
    OUTPUT_DIR = path.resolve(expandHome(opt('--trial')));
  }
  FORCE_CV = args.includes('--force-cv');
  if (FORCE_CV && !onlyRoles) throw new Error('--force-cv needs --role ID[,ID]');
  const anyFit = args.includes('--any-fit') || FORCE_CV;
  if (anyFit && !onlyRoles) throw new Error('--any-fit needs --role ID[,ID]');
  const since = opt('--since');
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since needs a date: YYYY-MM-DD');

  checkSetup();
  setFileNames();
  if (loadOwner().example || ownerRules().example) logger.warn('config/private has no owner.json or cv-rules.md: the CV rules use the _example files');
  fs.mkdirSync(WORK_DIR, { recursive: true });
  await initDb();
  const rows = await getRolesForTailoring(anyFit ? 0 : T.min_fit_score);
  // The evaluation: all ages, newest first (the RM scoring rule). The
  // Word CV: only roles posted on or after CV_CUTOFF (max_age_days).
  CV_CUTOFF = ageCutoff(localDate(settings.schedule.timezone), T.max_age_days);
  FORCED = Boolean(onlyRoles);
  const boardFrom = ageCutoff(localDate(settings.schedule.timezone), settings.board.max_age_days);
  const todo = selectForTailoring(rows, { since, boardFrom, onlyRoles, maxAttempts: T.max_attempts, hash: descriptionHash });
  const batch = todo.slice(0, max);
  logger.info(`${todo.length} roles need career-ops (posted on or after ${since && since > boardFrom ? since : boardFrom})${todo.length > batch.length ? `; this run sends ${batch.length}` : ''}; Word CVs only for roles posted or changed on or after ${CV_CUTOFF}`);
  // The counts for the server log (lib/progress.js formatTailoringProgress).
  const counts = { done: 0, scored: 0, passed: 0, ready: 0, too_old: 0, failed: 0 };
  const report = (extra = {}) => reportProgress('tailor', { total: batch.length, cv_from: FORCED ? null : CV_CUTOFF, ...counts, ...extra });
  report();
  if (!batch.length) return;

  const files = await buildPromptFile();
  const sent = [];
  for (const role of batch) {
    const item = `${role.employer}: ${role.title}`;
    const roleStarted = new Date().toISOString();
    report({ item });
    let rec;
    try {
      rec = await tailorRole(role, files, (step, model) => report({ item, step, model, role_started: roleStarted }));
    } catch (err) {
      if (err instanceof UsageLimitError) {
        logger.warn(`Claude usage limit: ${err.message}. Tailoring stops; ${batch.length - counts.done} roles wait for the next run`);
        report({ stopped: `Claude usage limit: ${err.message}` });
        break;
      }
      rec = { role_id: role.id, description_hash: descriptionHash(role.title, role.description), status: 'failed', outcome: 'failed', error: err.message, attempts: (role.attempts || 0) + 1 };
    }
    if (rec.status === 'failed') logger.warn(`Role ${role.id} (${role.employer}, ${role.title}): ${rec.error}`);
    counts.done += 1;
    if (typeof rec.score === 'number') counts.scored += 1;
    if (qualifies({ bestFit: role.best_fit, careerOpsScore: rec.score }, { minFit: T.min_fit_score, minScore: MIN_CAREER_OPS })) counts.passed += 1;
    if (rec.outcome === 'ready') counts.ready += 1;
    if (rec.outcome === 'too_old') counts.too_old += 1;
    if (rec.outcome === 'failed') counts.failed += 1;
    const last = { role: item, score: rec.score ?? null, outcome: rec.outcome, error: rec.error || null,
      age_date: cvDate(role), seconds: Math.round((Date.now() - new Date(roleStarted)) / 1000) };
    if (TRIAL) {
      // The trial leaves the tracker as it was.
      fs.rmSync(path.join(CO, 'batch', 'tracker-additions', `board-${role.id}.tsv`), { force: true });
      logger.info(`Trial, role ${role.id}: ${rec.status}${rec.folder ? ` in ${rec.folder}` : ''}${rec.error ? ` (${rec.error})` : ''}`);
      report({ last });
      continue;
    }
    await upsertTailored(rec);
    sent.push(role);
    await publish();
    report({ last });
  }
  if (TRIAL) return;
  // Keep career-ops' own tracker (data/applications.md) up to date: the
  // new rows, then the status of each role that the owner marked already.
  if (ensureTracker(CO)) logger.info('Made the career-ops tracker data/applications.md');
  await run('node', ['merge-tracker.mjs'], { cwd: CO });
  for (const role of sent) {
    try {
      const done = await syncTracker(CO, role.id);
      if (done.startsWith('tracker')) logger.info(`Role ${role.id}: ${done}`);
    } catch (err) {
      logger.warn(`Role ${role.id}: career-ops tracker not updated: ${err.message}`);
    }
  }
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
