// Refresh checkpoint: which employers the current run has finished. With
// --resume, refresh.js skips the employers that finished with 'ok' in an
// unfinished run less than MAX_AGE_HOURS old; an employer that failed or
// was in progress starts again from its first role. The publisher reads
// the same file to tell the board if the data is complete or partial.
import fs from 'fs';
import path from 'path';

export const CHECKPOINT_PATH = path.join('data', 'refresh-checkpoint.json');
export const MAX_AGE_HOURS = 12;

export function newCheckpoint(runId, startedAt) {
  return { run_id: runId, started_at: startedAt, completed_at: null, employers: {} };
}

export function loadCheckpoint(file = CHECKPOINT_PATH) {
  try {
    const cp = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return cp && typeof cp === 'object' && cp.employers && typeof cp.employers === 'object' ? cp : null;
  } catch {
    return null;
  }
}

// Write to a temporary file, then rename: a crash never leaves half a file.
export function saveCheckpoint(cp, file = CHECKPOINT_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, file);
}

// The checkpoint to continue, or null when a fresh run must start.
export function resumableCheckpoint(cp, now = new Date(), maxAgeHours = MAX_AGE_HOURS) {
  if (!cp || cp.completed_at || !cp.started_at) return null;
  const age = now - new Date(cp.started_at);
  if (Number.isNaN(age) || age < 0 || age > maxAgeHours * 3600 * 1000) return null;
  return cp;
}

export function recordEmployer(cp, employerId, result, at = new Date()) {
  cp.employers[employerId] = { ...result, finished_at: at.toISOString() };
  return cp;
}

// Active employers this run must still scrape: not finished with 'ok'.
export function pendingEmployers(cp, employers) {
  return employers.filter((e) => e.active && !(cp.employers[e.id] && cp.employers[e.id].status === 'ok'));
}

// What the board shows: complete or partial, and how many employers.
export function summarizeCheckpoint(cp, employers) {
  if (!cp) return null;
  const active = employers.filter((e) => e.active);
  const done = active.filter((e) => cp.employers[e.id] && cp.employers[e.id].status === 'ok');
  const failed = active.filter((e) => cp.employers[e.id] && cp.employers[e.id].status === 'error');
  return {
    complete: Boolean(cp.completed_at),
    started_at: cp.started_at,
    completed_at: cp.completed_at || null,
    total: active.length,
    refreshed: done.length,
    failed: failed.map((e) => e.name),
  };
}
