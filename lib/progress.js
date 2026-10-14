// Refresh progress: refresh.js reports each step to server.js over the
// IPC channel; server.js logs a summary line every minute. Without an IPC
// channel (refresh.js run by hand) reportProgress does nothing.

export const STAGES = {
  scrape: 'scraping employer',
  descriptions: 'fetching description',
  classify: 'classifying roles',
  publish: 'publishing roles',
};

export function reportProgress(stage, { done = null, total = null, item = null } = {}) {
  if (typeof process.send !== 'function' || !process.connected) return;
  try {
    process.send({ type: 'progress', stage, done, total, item, at: new Date().toISOString() });
  } catch {
    // The server went away; the refresh itself goes on.
  }
}

// 0 -> "0 min", 75 -> "1 h 15 min".
export function formatMinutes(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// "Refresh running 1 h 49 min: scraping employer 14 of 56 (EY GDS), 3 min on this step"
export function formatProgress(progress, startedAt, now = new Date()) {
  const elapsed = startedAt ? `Refresh running ${formatMinutes(now - new Date(startedAt))}` : 'Refresh running';
  if (!progress) return `${elapsed}: starting`;
  const label = STAGES[progress.stage] || progress.stage;
  const count = progress.total ? ` ${progress.done} of ${progress.total}` : '';
  const item = progress.item ? ` (${progress.item})` : '';
  const step = progress.at ? `, ${formatMinutes(now - new Date(progress.at))} on this step` : '';
  return `${elapsed}: ${label}${count}${item}${step}`;
}
