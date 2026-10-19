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

// The end-of-run summary lines (formatRefreshSummary) for server.js, which
// writes them to its own log (pm2 logs) after "Refresh finished".
export function reportSummary(lines) {
  if (typeof process.send !== 'function' || !process.connected) return;
  try {
    process.send({ type: 'summary', lines });
  } catch {
    // The server went away; the summary is still in logs/refresh.log.
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

// 75 -> "1 min 15 s", 42 -> "42 s".
function formatSeconds(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// The summary lines at the end of a refresh, from the checkpoint (so a
// resumed run counts the employers saved before the interruption too).
// names: employer id -> name. expired: roles closed by their closing date.
// descriptions and classified: the counts of those steps. rolesOnBoard:
// the roles in data/roles.json. incomplete: the reason the run does not
// count as complete, or null.
export function formatRefreshSummary({ cp, names = {}, finishedAt = new Date(), resumed = false, expired = 0, descriptions = null, classified = null, rolesOnBoard = null, incomplete = null }) {
  const entries = Object.entries(cp.employers);
  const name = (id) => names[id] || id;
  const ok = entries.filter(([, e]) => e.status === 'ok');
  const failed = entries.filter(([, e]) => e.status === 'error');
  const sum = (key) => ok.reduce((total, [, e]) => total + (e[key] || 0), 0);
  const took = formatMinutes(new Date(finishedAt) - new Date(cp.started_at));
  const head = incomplete ? `Refresh NOT complete (${incomplete}) after` : 'Refresh complete in';
  const lines = [`=== ${head} ${took}${resumed ? ' (resumed run)' : ''}: ${ok.length} of ${entries.length} employers succeeded, ${failed.length} failed ===`];
  if (failed.length) lines.push(`  Failed: ${failed.map(([id, e]) => `${name(id)} (${e.error || 'unknown error'})`).join('; ')}`);
  lines.push(`  Roles: ${sum('count')} matching roles read, ${sum('added')} new, ${sum('updated')} seen again, ${sum('closed')} closed (left the site), ${expired} closed (closing date passed)`);
  if (descriptions) lines.push(`  Descriptions: ${descriptions.ok} fetched, ${descriptions.gone} closed postings, ${descriptions.error} errors, ${descriptions.skipped} skipped`);
  if (classified) lines.push(`  Classified: ${classified.total} roles, ${classified.target} target, ${classified.exception} exception, ${classified.excluded} excluded`);
  if (rolesOnBoard != null) lines.push(`  Board: ${rolesOnBoard} roles in data/roles.json`);
  const slowest = entries.filter(([, e]) => e.seconds > 0).sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 3);
  if (slowest.length) lines.push(`  Slowest employers: ${slowest.map(([id, e]) => `${name(id)} ${formatSeconds(e.seconds)}`).join(', ')}`);
  return lines;
}
