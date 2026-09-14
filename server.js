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

const logger = createLogger('server');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const ROLES_PATH = path.join('data', 'roles.json');
const REFRESH_LOG_PATH = path.join('logs', 'refresh.log');
const REFRESH_SCHEDULE = process.env.REFRESH_CRON || '0 6 * * *'; // 6 AM daily
const REFRESH_TIMEZONE = process.env.TZ || 'Asia/Kolkata';

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

cron.schedule(REFRESH_SCHEDULE, () => runRefresh('cron'), { timezone: REFRESH_TIMEZONE });

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

app.use(express.static(path.join('frontend', 'public')));

app.listen(PORT, HOST, () => {
  logger.info(`India GCC Board serving on http://${HOST}:${PORT} (open http://localhost:${PORT} locally)`);
  logger.info(`Daily refresh scheduled: '${REFRESH_SCHEDULE}' (${REFRESH_TIMEZONE})`);
});
