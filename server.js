#!/usr/bin/env node
/**
 * server.js — self-hosted home for the job board. Replaces the earlier
 * Claude Artifact hosting model: this serves the frontend and the scraped
 * data directly, with no external publish step and no Claude dependency
 * in the runtime loop. See docs/ARCHITECTURE.md §5.
 *
 * Run locally: node server.js  (binds 0.0.0.0 — reachable from other
 * devices on the same network, or over Tailscale, with zero changes).
 */
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createLogger } from './lib/logger.js';
import { formatProgress, formatMinutes } from './lib/progress.js';
import { validateSchedule, defaultSchedule, timeToCron, isRefreshMissed, lastScheduledTime } from './lib/schedule.js';
import { checkSleepRisk, PAUSED_EXIT_CODE } from './lib/power.js';

const logger = createLogger('server');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const ROLES_PATH = path.join('data', 'roles.json');
const REFRESH_LOG_PATH = path.join('logs', 'refresh.log');
const REFRESH_TIMEZONE = process.env.TZ || 'Asia/Kolkata';
// The board can change the schedule (daily at a time, or on demand only);
// the choice is saved here. REFRESH_CRON in .env is only the first default.
const SCHEDULE_PATH = path.join('data', 'schedule.json');

const refreshState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastExitCode: null,
  progress: null,
  scoring: false,
  // An unfinished run waits for the Mac to stay awake (lib/power.js):
  // the reason, e.g. "on battery with the lid closed", or null.
  paused: null,
};
// After a successful refresh, score the new roles with Claude Code
// (autoscore.js). AUTO_SCORE=off turns this off.
const AUTO_SCORE = (process.env.AUTO_SCORE || 'on').toLowerCase() !== 'off';

let scoringChild = null;

function runAutoScore() {
  if (!AUTO_SCORE || refreshState.scoring) return;
  refreshState.scoring = true;
  logger.info('Automatic scoring started (autoscore.js)');
  const out = fs.openSync(REFRESH_LOG_PATH, 'a');
  const child = spawn('node', ['autoscore.js'], { cwd: process.cwd(), stdio: ['ignore', out, out] });
  scoringChild = child;
  const done = (code) => {
    fs.closeSync(out);
    refreshState.scoring = false;
    scoringChild = null;
    logger.info(`Automatic scoring finished (exit code: ${code}); details in logs/combined.log`);
  };
  child.on('error', (err) => { logger.warn(`Automatic scoring not started: ${err.message}`); });
  child.on('close', done);
}
const PROGRESS_LOG_EVERY_MS = 60 * 1000;
// A refresh that stops with an error is tried again once, after this
// delay; with --resume it continues from the last saved employer.
const RETRY_AFTER_MS = 10 * 60 * 1000;
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
  // Keep the Mac awake until the refresh ends (-i idle sleep; -s system
  // sleep on mains power). A closed lid on battery can still sleep, so
  // refresh.js pauses then (--pause-on-sleep, lib/power.js).
  let awake = null;
  if (process.platform === 'darwin') {
    awake = spawn('caffeinate', ['-i', '-s', '-w', String(child.pid)], { stdio: 'ignore' });
    awake.on('error', (err) => logger.warn(`caffeinate not started: ${err.message}`));
  }
  child.on('message', (msg) => {
    if (msg && msg.type === 'progress') {
      const { type, ...progress } = msg;
      refreshState.progress = progress;
    }
  });
  const progressTimer = setInterval(() => {
    logger.info(formatProgress(refreshState.progress, refreshState.lastStartedAt));
  }, PROGRESS_LOG_EVERY_MS);

  child.on('exit', (code, signal) => {
    clearInterval(progressTimer);
    if (awake && awake.exitCode === null) awake.kill();
    fs.closeSync(out);
    refreshState.running = false;
    refreshState.lastFinishedAt = new Date().toISOString();
    refreshState.lastExitCode = code;
    const took = formatMinutes(new Date(refreshState.lastFinishedAt) - new Date(refreshState.lastStartedAt));
    logger.info(`Refresh finished (trigger: ${trigger}, exit code: ${code}${signal ? `, signal: ${signal}` : ''}, took ${took})`);
    if (code === 0) runAutoScore();
    if (code === PAUSED_EXIT_CODE) {
      // catchUpIfMissed() continues the run when the Mac can stay awake.
      refreshState.paused = 'the Mac can sleep (on battery with the lid closed)';
      logger.info('Refresh paused; it continues when the Mac is on mains power or the lid is open');
      return;
    }
    if (code !== 0 && trigger !== 'retry') {
      logger.warn(`Refresh stopped before the end; trying again in ${RETRY_AFTER_MS / 60000} min from the last saved employer`);
      retryTimer = setTimeout(() => { retryTimer = null; startWhenAwake('retry'); }, RETRY_AFTER_MS);
    }
  });

  return { started: true };
}

// Scheduled, catch-up, retry and resume runs start only when the Mac can
// stay awake. A Refresh now click always starts. Resolves to true when the
// refresh started. A held-back cron run is started later by catch-up; a
// held-back retry or resume waits until catch-up sees the Mac can stay awake.
let lastWaitReason = null;

async function startWhenAwake(trigger) {
  if (refreshState.running) return false;
  const risk = await checkSleepRisk();
  if (risk) {
    if (trigger === 'retry') refreshState.paused = refreshState.paused || `the Mac can sleep (${risk})`;
    if (risk !== lastWaitReason) logger.info(`Refresh (${trigger}) not started: the Mac is ${risk} and can sleep; waiting`);
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
  return defaultSchedule(process.env.REFRESH_CRON);
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
const CATCH_UP_EVERY_MS = 5 * 60 * 1000;
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
    if (await startWhenAwake('resume')) logger.info('The Mac can stay awake again; continuing the paused refresh');
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

app.get('/api/roles', (_req, res) => {
  if (!fs.existsSync(ROLES_PATH)) {
    res.status(503).json({ error: 'No data yet — run a refresh first (POST /api/refresh or `node refresh.js`).' });
    return;
  }
  res.type('application/json').send(fs.readFileSync(ROLES_PATH, 'utf-8'));
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

app.listen(PORT, HOST, () => {
  logger.info(`India GCC Board serving on http://${HOST}:${PORT} (open http://localhost:${PORT} locally)`);
});
