#!/usr/bin/env node
/**
 * server.js — self-hosted home for the job board. Replaces the earlier
 * Claude Artifact hosting model: this serves the frontend and the scraped
 * data directly, with no external publish step and no Claude dependency
 * in the runtime loop. See docs/ARCHITECTURE.md §5.
 *
 * Run locally: node server.js  (binds 127.0.0.1 by default; set server.host
 * in config/settings.json and ALLOWED_HOSTS in .env to open it from other
 * devices, docs/SETUP.md §7).
 */
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { spawn, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createLogger } from './lib/logger.js';
import { settings } from './lib/settings.js';
import {
  formatProgress, formatMinutes, formatScoringProgress, formatScoringSummary,
  formatTailoringProgress, formatTailoringResult, formatTailoringSummary,
} from './lib/progress.js';
import { validateSchedule, defaultSchedule, timeToCron, isRefreshMissed, lastScheduledTime } from './lib/schedule.js';
import { checkSleepRisk, PAUSED_EXIT_CODE } from './lib/power.js';
import { checkOnline, NETWORK_EXIT_CODE } from './lib/network.js';
import { requestGuard, parseAllowedHosts, securityHeaders } from './lib/security.js';
import {
  getTailored, getEmployerName, getMarks, getMark, setMark, roleExists, addGapAnswer, requestRetailor, getModelUsage,
  getManualRole, initDb,
} from './lib/database.js';
import { addManualJob } from './lib/manual-job.js';
import { summarizeUsage, STAGES } from './lib/models.js';
import {
  expandHome, MARKS, validateGapAnswer, appendConfirmedSkill, localDate,
} from './lib/tailoring.js';
import { syncTracker } from './lib/tracker-sync.js';
import { publish } from './lib/publisher.js';

const logger = createLogger('server');

const PORT = settings.server.port;
// Only this computer can open the board by default. Set server.host to
// 0.0.0.0 to let other devices on the network open it (docs/SETUP.md §7).
const HOST = settings.server.host;
const ROLES_PATH = path.join('data', 'roles.json');
const REFRESH_LOG_PATH = path.join('logs', 'refresh.log');
const REFRESH_TIMEZONE = settings.schedule.timezone;
// The board can change the schedule (daily at a time, or on demand only);
// the choice is saved here. schedule.refresh_cron is only the first default.
const SCHEDULE_PATH = path.join('data', 'schedule.json');

const refreshState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastExitCode: null,
  progress: null,
  scoring: false,
  scoringStartedAt: null,
  // Counts from autoscore.js: total, done (sent), scored, rejected.
  scoringProgress: null,
  // career-ops after the scoring (tailor.js): running, and its counts
  // (total, done, ready, failed).
  tailoring: false,
  tailoringStartedAt: null,
  tailoringProgress: null,
  // An unfinished run waits for the Mac to stay awake (lib/power.js) or
  // for the network (lib/network.js): the reason and when it continues,
  // or null.
  paused: null,
};
// After a successful refresh, score the new roles with Claude Code
// (autoscore.js). scoring.auto_score: false turns this off.
const AUTO_SCORE = settings.scoring.auto_score;

let scoringChild = null;
// After the scoring, send the best-matched roles to career-ops for a Word
// CV and cover letter (tailor.js). tailoring.auto_tailor: false turns this off.
const AUTO_TAILOR = settings.tailoring.auto_tailor;
const CAREER_OPS_DIR = expandHome(settings.tailoring.career_ops_dir);
let tailorChild = null;
// Work the owner asked for while the board was busy (lib/manual-job.js):
// scoring for a job added by hand, and "Make CV anyway" runs (tailor.js
// arguments). They start when tailoring ends; a refresh's own scoring and
// tailoring take a queued job with them.
let scoreQueued = false;
const cvQueue = [];

// Keeps the Mac awake for the whole cycle: the refresh and then the
// scoring (-i idle sleep; -s system sleep on mains power). One caffeinate
// for the cycle: with one for each child, the refresh's caffeinate ended
// before the scoring's one held the Mac, and on battery the Mac slept in
// that gap during the Claude call (2026-10-25, 2026-10-28). -w on this
// server's pid: caffeinate also ends if the server stops. logIdle() ends
// it. A closed lid on battery can still sleep.
let cycleAwake = null;
function keepAwake() {
  if (process.platform !== 'darwin' || (cycleAwake && cycleAwake.exitCode === null && !cycleAwake.killed)) return;
  const awake = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
  awake.on('error', (err) => logger.warn(`caffeinate not started: ${err.message}`));
  awake.on('exit', () => { if (cycleAwake === awake) cycleAwake = null; });
  cycleAwake = awake;
}
function allowSleep() {
  if (cycleAwake && cycleAwake.exitCode === null) cycleAwake.kill();
  cycleAwake = null;
}

// The last line of a refresh cycle (refresh, then scoring): what ended,
// and that nothing runs until the next refresh.
function logIdle(what) {
  if (refreshState.running || refreshState.scoring || refreshState.tailoring) return;
  allowSleep();
  let next;
  if (retryTimer) next = `retry in ${RETRY_AFTER_MS / 60000} min`;
  else if (refreshState.paused) next = `paused: ${refreshState.paused}`;
  else if (schedule.mode === 'daily') next = `next refresh daily at ${schedule.time} ${REFRESH_TIMEZONE}`;
  else next = 'next refresh on demand';
  logger.info(`=== ${what}; server idle (${next}) ===`);
}

// Returns true when scoring started.
function runAutoScore() {
  if (!AUTO_SCORE || refreshState.scoring) return false;
  refreshState.scoring = true;
  refreshState.scoringStartedAt = new Date().toISOString();
  refreshState.scoringProgress = null;
  logger.info('Automatic scoring started (autoscore.js)');
  const out = fs.openSync(REFRESH_LOG_PATH, 'a');
  // The 'ipc' channel carries the counts (lib/progress.js).
  const child = spawn('node', ['autoscore.js'], { cwd: process.cwd(), stdio: ['ignore', out, out, 'ipc'] });
  scoringChild = child;
  // The refresh started the cycle caffeinate; this starts a new one only
  // if that one stopped (for example, it was killed).
  keepAwake();
  let lastLogged = null;
  child.on('message', (msg) => {
    if (!msg || msg.type !== 'progress') return;
    const { type, ...progress } = msg;
    refreshState.scoringProgress = progress;
    // Log when the count of roles to score is known and after each batch.
    const key = `${progress.total}:${progress.done}`;
    if (progress.total != null && key !== lastLogged) {
      lastLogged = key;
      logger.info(formatScoringProgress(progress, refreshState.scoringStartedAt));
    }
  });
  const progressTimer = setInterval(() => {
    logger.info(formatScoringProgress(refreshState.scoringProgress, refreshState.scoringStartedAt));
  }, PROGRESS_LOG_EVERY_MS);
  const done = (code) => {
    clearInterval(progressTimer);
    fs.closeSync(out);
    refreshState.scoring = false;
    scoringChild = null;
    const took = formatMinutes(Date.now() - new Date(refreshState.scoringStartedAt));
    logger.info(`Automatic scoring finished (exit code: ${code}, took ${took}): ${formatScoringSummary(refreshState.scoringProgress)}; details in logs/combined.log`);
    // A refresh that starts stops the scoring: then the cycle is not over.
    // Roles scored before a failure can still go to career-ops.
    if (refreshState.running) return;
    if (!runTailor()) logIdle(code === 0 ? 'Refresh and scoring complete' : `Refresh complete, scoring failed (exit code: ${code})`);
  };
  child.on('error', (err) => { logger.warn(`Automatic scoring not started: ${err.message}`); });
  child.on('close', done);
  return true;
}
// Returns true when tailoring started. args: for example ['--role', '463'].
function runTailor(args = []) {
  if (!AUTO_TAILOR || refreshState.tailoring || refreshState.running) return false;
  refreshState.tailoring = true;
  refreshState.tailoringStartedAt = new Date().toISOString();
  refreshState.tailoringProgress = null;
  logger.info('Tailoring started (tailor.js: career-ops, Word CV and cover letter)');
  const out = fs.openSync(REFRESH_LOG_PATH, 'a');
  const child = spawn('node', ['tailor.js', ...args], { cwd: process.cwd(), stdio: ['ignore', out, out, 'ipc'] });
  tailorChild = child;
  keepAwake();
  // Log when the step of a role changes, a line for each finished role,
  // and a progress line each minute (as for the scoring).
  let lastLogged = null;
  child.on('message', (msg) => {
    if (!msg || msg.type !== 'progress') return;
    const { type, ...progress } = msg;
    const prev = refreshState.tailoringProgress;
    refreshState.tailoringProgress = progress;
    if (progress.last && (!prev || prev.done !== progress.done)) logger.info(formatTailoringResult(progress));
    const key = `${progress.total}:${progress.done}:${progress.step || ''}`;
    if (progress.total != null && key !== lastLogged) {
      lastLogged = key;
      logger.info(formatTailoringProgress(progress, refreshState.tailoringStartedAt));
    }
  });
  const progressTimer = setInterval(() => {
    logger.info(formatTailoringProgress(refreshState.tailoringProgress, refreshState.tailoringStartedAt));
  }, PROGRESS_LOG_EVERY_MS);
  child.on('error', (err) => { logger.warn(`Tailoring not started: ${err.message}`); });
  child.on('close', (code) => {
    clearInterval(progressTimer);
    fs.closeSync(out);
    refreshState.tailoring = false;
    tailorChild = null;
    const took = formatMinutes(Date.now() - new Date(refreshState.tailoringStartedAt));
    logger.info(`Tailoring finished (exit code: ${code}, took ${took}): ${formatTailoringSummary(refreshState.tailoringProgress)}; details in logs/combined.log`);
    if (refreshState.running) return;
    if (scoreQueued) { scoreQueued = false; if (runAutoScore()) return; }
    while (cvQueue.length) { if (runTailor(cvQueue.shift())) return; }
    logIdle(code === 0 ? 'Refresh, scoring and tailoring complete' : `Tailoring failed (exit code: ${code})`);
  });
  return true;
}
const PROGRESS_LOG_EVERY_MS = settings.server.progress_log_minutes * 60 * 1000;
// A refresh that stops with an error is tried again once, after this
// delay; with --resume it continues from the last saved employer.
const RETRY_AFTER_MS = settings.schedule.retry_after_minutes * 60 * 1000;
let retryTimer = null;

function runRefresh(trigger) {
  if (refreshState.running) {
    return { started: false, reason: 'already running' };
  }
  // The refresh and the scorer both write the database and roles.json:
  // stop the scorer. The next successful refresh starts it again.
  if (scoringChild) {
    logger.info('Stopping automatic scoring: a refresh starts');
    scoringChild.kill('SIGTERM');
  }
  if (tailorChild) {
    logger.info('Stopping tailoring: a refresh starts');
    tailorChild.kill('SIGTERM');
  }
  refreshState.running = true;
  refreshState.lastStartedAt = new Date().toISOString();
  refreshState.lastExitCode = null;
  refreshState.progress = null;
  logger.info(`Refresh started (trigger: ${trigger})`);

  fs.mkdirSync(path.dirname(REFRESH_LOG_PATH), { recursive: true });
  const out = fs.openSync(REFRESH_LOG_PATH, 'a');
  // The 'ipc' channel carries progress messages (lib/progress.js).
  // Refresh now always starts a full run; scheduled, catch-up and retry
  // runs continue an unfinished run (lib/checkpoint.js).
  const args = trigger === 'manual' ? ['refresh.js'] : ['refresh.js', '--resume'];
  args.push('--pause-on-sleep');
  refreshState.paused = null;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const child = spawn('node', args, { cwd: process.cwd(), stdio: ['ignore', out, out, 'ipc'] });
  // Keep the Mac awake until the cycle ends (refresh, then scoring). A
  // closed lid on battery can still sleep, so refresh.js pauses then
  // (--pause-on-sleep, lib/power.js).
  keepAwake();
  // The summary at the end of the run (lib/progress.js reportSummary):
  // written to this log after "Refresh finished", so pm2 logs show it too.
  let summary = null;
  child.on('message', (msg) => {
    if (msg && msg.type === 'progress') {
      const { type, ...progress } = msg;
      refreshState.progress = progress;
    } else if (msg && msg.type === 'summary' && Array.isArray(msg.lines)) {
      summary = msg.lines.map(String);
    }
  });
  const progressTimer = setInterval(() => {
    logger.info(formatProgress(refreshState.progress, refreshState.lastStartedAt));
  }, PROGRESS_LOG_EVERY_MS);

  child.on('exit', (code, signal) => {
    clearInterval(progressTimer);
    fs.closeSync(out);
    refreshState.running = false;
    refreshState.lastFinishedAt = new Date().toISOString();
    refreshState.lastExitCode = code;
    const took = formatMinutes(new Date(refreshState.lastFinishedAt) - new Date(refreshState.lastStartedAt));
    logger.info(`Refresh finished (trigger: ${trigger}, exit code: ${code}${signal ? `, signal: ${signal}` : ''}, took ${took})`);
    if (summary) summary.forEach((line) => (code === 0 ? logger.info(line) : logger.warn(line)));
    else if (code === 0) logger.info('No refresh summary received; see logs/refresh.log');
    if (code === 0) {
      if (!runAutoScore() && !runTailor()) logIdle(AUTO_SCORE ? 'Refresh complete' : 'Refresh complete (automatic scoring off)');
      return;
    }
    if (code === PAUSED_EXIT_CODE) {
      // catchUpIfMissed() continues the run when the Mac can stay awake.
      refreshState.paused = waitText('on battery with the lid closed');
      logger.info('Refresh paused; it continues when the Mac is on mains power or the lid is open');
      logIdle('Refresh paused');
      return;
    }
    if (code === NETWORK_EXIT_CODE) {
      // catchUpIfMissed() continues the run when the network is back.
      refreshState.paused = waitText('no network');
      logger.info('Refresh paused: no network; it continues when the network is back');
      logIdle('Refresh paused');
      return;
    }
    if (trigger !== 'retry') {
      logger.warn(`Refresh stopped before the end; trying again in ${RETRY_AFTER_MS / 60000} min from the last saved employer`);
      retryTimer = setTimeout(() => { retryTimer = null; startWhenAwake('retry'); }, RETRY_AFTER_MS);
      logIdle('Refresh stopped before the end');
      return;
    }
    logIdle('Refresh failed again after the retry');
  });

  return { started: true };
}

// The pause text on the board: "Refresh paused: <this>."
function waitText(reason) {
  return reason === 'no network'
    ? 'no network. It continues when the network is back'
    : `the Mac can sleep (${reason}). It continues when the Mac is on mains power or the lid is open`;
}

// Scheduled, catch-up, retry and resume runs start only when the Mac can
// stay awake and has a network (after a wake, Wi-Fi can take some time).
// A Refresh now click always starts. Resolves to true when the refresh
// started. A held-back cron run is started later by catch-up; a held-back
// retry or resume waits until catch-up sees the Mac can run it.
let lastWaitReason = null;

async function startWhenAwake(trigger) {
  if (refreshState.running) return false;
  const risk = (await checkSleepRisk()) || (await checkOnline() ? null : 'no network');
  if (risk) {
    if (trigger === 'retry') refreshState.paused = refreshState.paused || waitText(risk);
    if (risk !== lastWaitReason) {
      logger.info(risk === 'no network'
        ? `Refresh (${trigger}) not started: no network; waiting`
        : `Refresh (${trigger}) not started: the Mac is ${risk} and can sleep; waiting`);
    }
    lastWaitReason = risk;
    return false;
  }
  lastWaitReason = null;
  return runRefresh(trigger).started;
}

function loadSchedule() {
  try {
    const result = validateSchedule(JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8')));
    if (result.ok) return result.value;
    logger.warn(`Ignoring ${SCHEDULE_PATH}: ${result.error}`);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`Ignoring ${SCHEDULE_PATH}: ${err.message}`);
  }
  return defaultSchedule(settings.schedule.refresh_cron);
}

let schedule = loadSchedule();
let cronTask = null;

function applySchedule() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
  if (schedule.mode === 'daily') {
    cronTask = cron.schedule(timeToCron(schedule.time), () => startWhenAwake('cron'), { timezone: REFRESH_TIMEZONE });
    logger.info(`Refresh schedule: daily at ${schedule.time} (${REFRESH_TIMEZONE})`);
  } else {
    logger.info('Refresh schedule: on demand only (Refresh now button)');
  }
}

applySchedule();

// Catch-up: a Mac asleep at the scheduled time misses the cron tick, and
// node-cron does not replay it. Every few minutes (and soon after start),
// run the refresh if one was due and none has run since. One attempt for
// each due time, so a failing refresh does not repeat every check.
const CATCH_UP_EVERY_MS = settings.schedule.catch_up_check_minutes * 60 * 1000;
let catchUpTriedFor = null;

function lastRefreshAt() {
  const times = [refreshState.lastStartedAt];
  try {
    const meta = JSON.parse(fs.readFileSync(ROLES_PATH, 'utf-8')).meta || {};
    times.push(meta.last_refresh);
  } catch (err) { /* no data yet */ }
  const valid = times.filter(Boolean).map((t) => new Date(t)).filter((d) => !Number.isNaN(d.getTime()));
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}

async function catchUpIfMissed() {
  if (refreshState.running) return;
  // A paused run (or a held-back retry) continues first.
  if (refreshState.paused) {
    if (await startWhenAwake('resume')) logger.info('The Mac can run the refresh again; continuing the paused refresh');
    return;
  }
  const now = new Date();
  if (!isRefreshMissed(schedule, lastRefreshAt(), now, REFRESH_TIMEZONE)) return;
  const due = lastScheduledTime(now, schedule.time, REFRESH_TIMEZONE).toISOString();
  if (catchUpTriedFor === due) return;
  // Count the attempt only when the refresh starts: while the Mac can
  // sleep, the next check tries again.
  if (await startWhenAwake('catch-up')) {
    catchUpTriedFor = due;
    logger.info(`Missed the refresh due at ${due} (computer asleep or server off); started it now`);
  }
}

setTimeout(catchUpIfMissed, 30 * 1000);
setInterval(catchUpIfMissed, CATCH_UP_EVERY_MS);

const app = express();
// Host and Origin checks (lib/security.js) run before every route.
app.use(requestGuard({ allowedHosts: parseAllowedHosts(process.env.ALLOWED_HOSTS), logger }));
// Security headers and the Content-Security-Policy (lib/security.js).
app.use(securityHeaders());

app.get('/api/roles', (_req, res) => {
  if (!fs.existsSync(ROLES_PATH)) {
    res.status(503).json({ error: 'No data yet — run a refresh first (POST /api/refresh or `node refresh.js`).' });
    return;
  }
  res.type('application/json').send(fs.readFileSync(ROLES_PATH, 'utf-8'));
});

// The tailored Word files of a role (tailor.js). Only a file that
// tailored_docs names, inside tailoring.output_dir, is used.
const TAILOR_FILES = { cv: 'cv_file', cover: 'cover_file', report: null, folder: null };
async function tailoredPath(idParam, kind) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || !Object.prototype.hasOwnProperty.call(TAILOR_FILES, kind)) return null;
  const row = await getTailored(id);
  if (!row || !row.folder) return null;
  const root = path.resolve(expandHome(settings.tailoring.output_dir));
  const name = kind === 'folder' ? '.' : TAILOR_FILES[kind] ? row[TAILOR_FILES[kind]] : 'evaluation.md';
  if (!name) return null;
  const file = path.resolve(row.folder, name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return null;
  return file;
}

// A download, for a board opened on another device.
app.get('/api/roles/:id/tailored/:kind', async (req, res) => {
  try {
    const file = req.params.kind === 'folder' ? null : await tailoredPath(req.params.id, req.params.kind);
    if (!file) { res.status(404).json({ error: 'No tailored file for this role' }); return; }
    res.download(file, path.basename(file));
  } catch (err) {
    logger.warn(`Tailored file for role ${req.params.id}: ${err.message}`);
    res.status(500).end();
  }
});

// Opens the file where it is (in OneDrive), on this Mac: a Word file opens
// in Word, so changes stay in that folder; "folder" opens it in Finder.
// Only a request from this computer: on another device the board downloads
// the file instead.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
app.post('/api/roles/:id/tailored/:kind/open', async (req, res) => {
  if (process.platform !== 'darwin' || !LOOPBACK.has(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Files open only on the computer that runs the board' });
    return;
  }
  try {
    const file = await tailoredPath(req.params.id, req.params.kind);
    if (!file) { res.status(404).json({ error: 'No tailored file for this role' }); return; }
    execFile('open', [file], (err) => {
      if (err) { logger.warn(`open ${file}: ${err.message}`); res.status(500).json({ error: 'The file did not open' }); return; }
      res.status(204).end();
    });
  } catch (err) {
    logger.warn(`Tailored file for role ${req.params.id}: ${err.message}`);
    res.status(500).end();
  }
});

// The owner's marks, stored on the server: every browser and device shows
// the same marks. A change also updates the career-ops tracker.
app.get('/api/marks', async (_req, res) => {
  try {
    const marks = {};
    (await getMarks()).forEach((m) => { marks[m.role_id] = m.status; });
    res.json({ marks });
  } catch (err) {
    logger.warn(`Marks: ${err.message}`);
    res.status(500).json({ error: 'Marks not read' });
  }
});

app.put('/api/roles/:id/mark', express.json(), async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body ? req.body.status : undefined;
  if (!Number.isInteger(id) || !(status === null || MARKS.includes(status))) {
    res.status(400).json({ error: `status must be one of ${MARKS.join(', ')}, or null` });
    return;
  }
  try {
    if (!(await roleExists(id))) { res.status(404).json({ error: 'No such role' }); return; }
    const before = await getMark(id);
    await setMark(id, status);
    res.json({ role_id: id, status });
    syncTracker(CAREER_OPS_DIR, id, { previous: before && before.tracker_status })
      .then((done) => { if (done.startsWith('tracker')) logger.info(`Mark of role ${id}: ${done}`); })
      .catch((err) => logger.warn(`Mark of role ${id}: career-ops tracker not updated: ${err.message}`));
  } catch (err) {
    logger.warn(`Mark of role ${id}: ${err.message}`);
    res.status(500).json({ error: 'Mark not saved' });
  }
});

// The owner confirms a gap in their own words: the answer goes into the
// career-ops master CV (cv.md), and career-ops makes the role's resume
// again (now if nothing runs, otherwise in the next run).
app.post('/api/roles/:id/gaps', express.json(), async (req, res) => {
  const id = Number(req.params.id);
  const checked = validateGapAnswer(req.body && req.body.gap, req.body && req.body.answer);
  if (!Number.isInteger(id) || !checked.ok) { res.status(400).json({ error: checked.error || 'Bad role' }); return; }
  try {
    const tailored = await getTailored(id);
    if (!tailored) { res.status(404).json({ error: 'career-ops has not evaluated this role' }); return; }
    const cvFile = path.join(CAREER_OPS_DIR, 'cv.md');
    const employer = (await getEmployerName(id)) || `role ${id}`;
    const cv = fs.readFileSync(cvFile, 'utf-8');
    const tmp = `${cvFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, appendConfirmedSkill(cv, { ...checked, employer, date: localDate(REFRESH_TIMEZONE) }));
    fs.renameSync(tmp, cvFile);
    await addGapAnswer(id, checked.gap, checked.answer);
    await requestRetailor(id);
    await publish();
    logger.info(`Role ${id}: the owner confirmed the gap "${checked.gap}"; added to the master CV`);
    const now = !refreshState.running && !refreshState.scoring && runTailor(['--role', String(id)]);
    res.json({ added: true, retailoring: now ? 'now' : 'next run' });
  } catch (err) {
    logger.warn(`Gap answer for role ${id}: ${err.message}`);
    res.status(500).json({ error: 'The answer was not saved' });
  }
});

// A job the owner adds by hand: a link, the job text, or both (the
// board's "Add a job" form). The RM scoring starts now when nothing runs;
// a role that passes the gate then goes to career-ops (runAutoScore starts
// tailor.js). 422 with needText: the board could not read the link.
app.post('/api/manual-jobs', express.json({ limit: '256kb' }), async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const pick = (k) => (typeof body[k] === 'string' ? body[k] : '');
  try {
    const added = await addManualJob({
      url: pick('url'), text: pick('text'), company: pick('company'), title: pick('title'), location: pick('location'),
    });
    if (added.error) {
      res.status(422).json({ error: added.error, needText: !!added.needText, needFields: added.needFields || [], found: added.job || null });
      return;
    }
    if (!added.created) {
      res.json({ roleId: added.roleId, created: false, next: 'The board already has this job' });
      return;
    }
    await publish();
    logger.info(`Role ${added.roleId}: added by the owner (${added.job.company}, ${added.job.title}; ${added.via})`);
    let next;
    let started = false;
    if (!AUTO_SCORE) next = 'Automatic scoring is off (scoring.auto_score): run node autoscore.js';
    else if (refreshState.running) next = 'The refresh that runs now scores it';
    else if (refreshState.scoring) next = 'The scoring that runs now scores it, or the next one';
    else if (refreshState.tailoring) { scoreQueued = true; next = 'Scoring starts when the career-ops run ends'; }
    else {
      started = runAutoScore();
      next = started ? 'Scoring started' : 'Scoring did not start; see the server log';
    }
    res.json({ roleId: added.roleId, created: true, via: added.via, started, next });
  } catch (err) {
    logger.warn(`Add a job: ${err.message}`);
    res.status(500).json({ error: 'The job was not added' });
  }
});

// "Make CV anyway": a Word CV for a job the owner added by hand, also when
// it fails the gate (tailor.js --force-cv). The role needs its RM score.
app.post('/api/roles/:id/make-cv', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Bad role' }); return; }
  try {
    const role = await getManualRole(id);
    if (!role) { res.status(404).json({ error: 'Only a job added by hand can get a CV anyway' }); return; }
    if (!role.is_active) { res.status(409).json({ error: 'The job is closed' }); return; }
    if (role.best_fit == null) { res.status(409).json({ error: 'The job has no RM score yet' }); return; }
    const args = ['--role', String(id), '--force-cv'];
    if (refreshState.running || refreshState.scoring || refreshState.tailoring) {
      if (!cvQueue.some((a) => a[1] === String(id))) cvQueue.push(args);
      res.json({ started: false, next: 'The CV starts when the board finishes the work that runs now' });
      return;
    }
    const started = runTailor(args);
    logger.info(`Role ${id}: the owner asked for a CV anyway${started ? '' : ' (not started)'}`);
    res.json({ started, next: started ? 'career-ops started: the CV takes about 5 to 10 minutes' : 'Tailoring is off (tailoring.auto_tailor)' });
  } catch (err) {
    logger.warn(`Make CV for role ${id}: ${err.message}`);
    res.status(500).json({ error: 'The CV did not start' });
  }
});

app.get('/api/refresh/status', (_req, res) => {
  res.json(refreshState);
});

app.post('/api/refresh', express.json(), (_req, res) => {
  const result = runRefresh('manual');
  res.status(result.started ? 202 : 409).json({ ...result, ...refreshState });
});

// Employer directory for the board (config/employers.json holds no personal
// data). The GitHub copy of docs/EMPLOYERS.md is not reachable when the
// repository is private.
app.get('/api/employers', (_req, res) => {
  const cfg = JSON.parse(fs.readFileSync(path.join('config', 'employers.json'), 'utf-8'));
  const pick = (e) => ({
    id: e.id, name: e.name, careers_url: e.careers_url, ats_type: e.ats_type,
    active: !!e.active, sector: /Non-BFSI/.test(e.note || '') ? 'Other industry' : 'BFSI', note: e.note || '',
  });
  res.json({
    employers: cfg.employers.map(pick),
    excluded: cfg.excluded.map((e) => ({ name: e.name || e.id, reason: e.reason || '' })),
  });
});

// Claude use of each stage and model (model_calls, lib/models.js) for the
// last ?days= days (default 30).
app.get('/api/usage', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const { byStage, byDay } = await getModelUsage(since);
    res.json({ days, since, models: settings.models, stages: STAGES, ...summarizeUsage(byStage), byDay });
  } catch (err) {
    logger.error(`Usage: ${err.message}`);
    res.status(500).json({ error: 'Cannot read the usage' });
  }
});

app.get('/api/schedule', (_req, res) => {
  res.json({ ...schedule, timezone: REFRESH_TIMEZONE });
});

app.put('/api/schedule', express.json(), (req, res) => {
  const result = validateSchedule(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  schedule = result.value;
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2));
  applySchedule();
  res.json({ ...schedule, timezone: REFRESH_TIMEZONE });
});

app.use(express.static(path.join('frontend', 'public')));

// The schema and its new columns (lib/database.js migrations) before the
// first request: a column added since the last refresh is there at once.
await initDb();

app.listen(PORT, HOST, () => {
  logger.info(`India GCC Board serving on http://${HOST}:${PORT} (open http://localhost:${PORT} locally)`);
});
