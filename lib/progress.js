// Refresh and scoring progress: refresh.js and autoscore.js report each
// step to server.js over the IPC channel; server.js logs a summary line
// every minute. Without an IPC channel (a script run by hand)
// reportProgress does nothing.

export const STAGES = {
  scrape: 'scraping employer',
  descriptions: 'fetching description',
  classify: 'classifying roles',
  publish: 'publishing roles',
};

export function reportProgress(stage, { done = null, total = null, item = null, ...extra } = {}) {
  if (typeof process.send !== 'function' || !process.connected) return;
  try {
    process.send({ type: 'progress', ...extra, stage, done, total, item, at: new Date().toISOString() });
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
// Scrape stage (employers run in parallel): done = employers finished,
// item = the employers in progress.
// "Refresh running 12 min: 14 of 56 employers done (now: Nomura, Intuit)"
export function formatProgress(progress, startedAt, now = new Date()) {
  const elapsed = startedAt ? `Refresh running ${formatMinutes(now - new Date(startedAt))}` : 'Refresh running';
  if (!progress) return `${elapsed}: starting`;
  if (progress.stage === 'scrape') {
    const nowItems = progress.item ? ` (now: ${progress.item})` : '';
    return `${elapsed}: ${progress.done} of ${progress.total} employers done${nowItems}`;
  }
  const label = STAGES[progress.stage] || progress.stage;
  const count = progress.total ? ` ${progress.done} of ${progress.total}` : '';
  const item = progress.item ? ` (${progress.item})` : '';
  const step = progress.at ? `, ${formatMinutes(now - new Date(progress.at))} on this step` : '';
  return `${elapsed}: ${label}${count}${item}${step}`;
}

// Scoring progress from autoscore.js: total = roles to score in this run,
// done = roles in finished batches, scored and rejected = import results,
// model = the model that scored them (known after the first batch).
// "Scoring running 4 min: 10 of 15 roles done (batch 2 running), 9 scored, 1 rejected, 5 left; model: claude-opus-5-5"
export function formatScoringProgress(progress, startedAt, now = new Date()) {
  const elapsed = startedAt ? `Scoring running ${formatMinutes(now - new Date(startedAt))}` : 'Scoring running';
  if (!progress || progress.total == null) return `${elapsed}: finding the roles that need a score`;
  if (progress.total === 0) return `${elapsed}: no roles need a score`;
  const batch = progress.item ? ` (${progress.item} running)` : '';
  const left = Math.max(0, progress.total - (progress.done || 0));
  return `${elapsed}: ${progress.done || 0} of ${progress.total} roles done${batch}, `
    + `${progress.scored || 0} scored, ${progress.rejected || 0} rejected, ${left} left`
    + (progress.model ? `; model: ${progress.model}` : '');
}

// The last line when scoring ends.
// "13 scored, 2 rejected (tried again next run), 0 left; model: claude-opus-5-5"
export function formatScoringSummary(progress) {
  if (!progress || progress.total == null) return 'no counts reported';
  if (progress.total === 0) return 'no roles needed a score';
  const left = Math.max(0, progress.total - (progress.done || 0));
  const rejected = progress.rejected || 0;
  return `${progress.scored || 0} scored, ${rejected} rejected${rejected ? ' (tried again next run)' : ''}, ${left} left`
    + (progress.more ? `; ${progress.more} more need a score (over the --max limit)` : '')
    + (progress.model ? `; model: ${progress.model}` : '');
}
