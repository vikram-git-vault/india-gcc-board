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
import { validateSchedule, defaultSchedule, timeToCron, isRefreshMissed, lastScheduledTime } from './lib/schedule.js';

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
};

function runRefresh(trigger) {
  if (refreshState.running) {
    return { started: false, reason: 'already running' };
  }
  refreshState.running = true;
  refreshState.lastStartedAt = new Date().toISOString();
  refreshState.lastExitCode = null;
  logger.info(`Refresh started (trigger: ${trigger})`);

  fs.mkdirSync(path.dirname(REFRESH_LOG_PATH), { recursive: true });
  const out = fs.openSync(REFRESH_LOG_PATH, 'a');
  const child = spawn('node', ['refresh.js'], { cwd: process.cwd(), stdio: ['ignore', out, out] });

  child.on('exit', (code) => {
    fs.closeSync(out);
    refreshState.running = false;
    refreshState.lastFinishedAt = new Date().toISOString();
    refreshState.lastExitCode = code;
    logger.info(`Refresh finished (trigger: ${trigger}, exit code: ${code})`);
  });

  return { started: true };
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
    cronTask = cron.schedule(timeToCron(schedule.time), () => runRefresh('cron'), { timezone: REFRESH_TIMEZONE });
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

function catchUpIfMissed() {
  const now = new Date();
  if (refreshState.running || !isRefreshMissed(schedule, lastRefreshAt(), now, REFRESH_TIMEZONE)) return;
  const due = lastScheduledTime(now, schedule.time, REFRESH_TIMEZONE).toISOString();
  if (catchUpTriedFor === due) return;
  catchUpTriedFor = due;
  logger.info(`Missed the refresh due at ${due} (computer asleep or server off); starting it now`);
  runRefresh('catch-up');
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
