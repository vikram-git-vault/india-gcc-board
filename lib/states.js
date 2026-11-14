// The states of the board, named in one place. Each value below moves
// through states that the code before only implied: a role is open or
// closed, its description is fetched or due again, its RM score is new or
// stale, career-ops waits for it or gave up, the server runs a refresh or
// is idle. The functions here are pure: they read a row and the settings
// and give the state and its text. They change nothing. The writers stay
// where they are (lib/database.js, tailor.js, server.js); the readers (the
// publisher, the board, tools/find-role.js, tools/board-status.js) use
// these functions, so every reader names the same state. See
// docs/ARCHITECTURE.md §18.
import fs from 'fs';
import path from 'path';
import { descriptionHash, scoreState } from './scoring.js';
import { selectForTailoring, qualifies, incompleteDescription } from './tailoring.js';

// --- Tier and source (roles.tier, roles.source) -------------------------

// 'target' and 'exception' go to the board; 'excluded' stays in the
// database. A manual role (source 'manual') is always 'target'.
export const TIERS = ['target', 'exception', 'excluded'];
export const SHORTLISTED_TIERS = ['target', 'exception'];
// The same rule in SQL, for the queries in lib/database.js and the publisher.
export const SHORTLISTED_SQL = `tier IN (${SHORTLISTED_TIERS.map((t) => `'${t}'`).join(', ')})`;
export const MANUAL_SOURCE = 'manual';

export function isManual(row) {
  return Boolean(row) && row.source === MANUAL_SOURCE;
}

// --- Role lifecycle (roles.is_active) -----------------------------------

// A role is open (on the board) or closed. The refresh closes a role when
// its id or URL left the employer site, when its closing date passed, or
// when the detail page says it is closed (description_status 'gone'). A
// role becomes open again when the site lists it again, never after its
// closing date. The refresh never closes a manual role: the owner marks it
// Closed. The reason for a close is not stored; this reads it from the
// columns that can show it.
export const ROLE_STATES = ['open', 'closed'];

export function roleState(row, today = null) {
  const manual = isManual(row);
  if (row.is_active) return { state: 'open', why: manual ? 'added by the owner; the refresh never closes it' : null, manual };
  let why = 'not on the employer site in the last full list';
  if (row.description_status === 'gone') why = 'the detail page says the posting is closed';
  else if (row.deadline && (!today || row.deadline < today)) why = `the closing date ${row.deadline} passed`;
  return { state: 'closed', why, manual };
}

// --- Description fetch (roles.description_status) -----------------------

// What the board knows about the full job text, and whether the next
// refresh fetches it (again). The retry ages are settings.descriptions.
// The SQL in getRolesNeedingDescription applies the same rule; a test
// keeps the two equal.
export const DESCRIPTION_STATES = {
  owner: 'the text the owner gave (manual role); never fetched',
  listing: 'the listing gave the full text; no fetch needed',
  missing: 'no full text yet; the next refresh fetches it',
  fetched: 'fetched from the detail API; fetched again after refetch_ok_days',
  closed: 'the detail API said the posting is closed; fetched again only when a scrape reopens the role',
  error: 'the fetch failed; tried again after retry_error_hours',
  skipped: 'no fetcher, no config or robots.txt forbids it; tried again after retry_skipped_days',
};

// SQLite CURRENT_TIMESTAMP ("2026-10-16 02:42:33") is UTC without a zone.
function toDate(timestamp) {
  if (!timestamp) return null;
  const text = String(timestamp);
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(d.getTime()) ? null : d;
}

// row: is_active, tier, source, description, description_status,
// description_fetched_at. descriptions: settings.descriptions. minChars:
// MIN_FULL_DESCRIPTION_CHARS. Returns { state, due }: due is true when the
// next refresh fetches the text.
export function descriptionState(row, { now = new Date(), descriptions, minChars }) {
  const status = row.description_status || null;
  const olderThan = (hours) => {
    const at = toDate(row.description_fetched_at);
    return at ? now - at > hours * 3600 * 1000 : true;
  };
  let state;
  let due = false;
  if (isManual(row)) state = 'owner';
  else if (status === null) {
    const short = String(row.description || '').length < minChars;
    state = short ? 'missing' : 'listing';
    due = short;
  } else if (status === 'ok') { state = 'fetched'; due = olderThan(descriptions.refetch_ok_days * 24); }
  else if (status === 'gone') { state = 'closed'; due = true; }
  else if (status === 'error') { state = 'error'; due = olderThan(descriptions.retry_error_hours); }
  else { state = 'skipped'; due = olderThan(descriptions.retry_skipped_days * 24); }
  // Only an active, shortlisted, scraped role is fetched.
  if (!row.is_active || !SHORTLISTED_TIERS.includes(row.tier) || isManual(row)) due = false;
  return { state, due };
}

// --- RM score (role_scores, score.js, autoscore.js) --------------------

// lib/scoring.js scoreState gives new, stale or scored from the stored
// score. Two more states come from outside the table: autoscore.js gives
// up on a role that score.js --import rejected scoring.max_attempts times
// with the same description (.cache/autoscore/attempts.json), and the
// board window (board.max_age_days) keeps an older role out of the
// scoring.
export const RM_STATES = {
  scored: 'the stored score is current',
  stale: 'the title, the text or the rubric changed; the next scoring run scores it again',
  waiting: 'no current score; the next scoring run scores it',
  given_up: 'score.js rejected the score scoring.max_attempts times; not sent again until the description changes',
  outside_window: 'older than board.max_age_days; the scoring does not send it',
};

export const SCORE_ATTEMPTS_FILE = path.join('.cache', 'autoscore', 'attempts.json');

// role id -> { hash, count }, or {} when there is no file.
export function readScoreAttempts(file = SCORE_ATTEMPTS_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) || {}; } catch { return {}; }
}

// row: id, title, description, scored_hash, scored_rubric_version,
// scored_best_fit (or po_fit and em_fit), age_date. attempts:
// readScoreAttempts(). boardFrom: the first date in the board window, or
// null for no window.
export function rmState(row, { rubric, rescoreMinFit = 0, boardFrom = null, attempts = {}, maxAttempts = Infinity, hash = descriptionHash }) {
  const current = hash(row.title, row.description);
  const bestFit = row.scored_best_fit != null ? row.scored_best_fit : Math.max(row.po_fit || 0, row.em_fit || 0);
  const base = scoreState({ scoredHash: row.scored_hash, hash: current, scoredRubric: row.scored_rubric_version, rubric, bestFit, rescoreMinFit });
  if (base === 'scored') return 'scored';
  const tried = attempts[String(row.id)];
  if (tried && tried.hash === current && tried.count >= maxAttempts) return 'given_up';
  if (boardFrom && !(row.age_date && row.age_date >= boardFrom)) return 'outside_window';
  return base === 'stale' ? 'stale' : 'waiting';
}

// --- career-ops and the Word CV (tailored_docs, tailor.js) --------------

// What career-ops did with a role, and what the next automatic run does.
// The stored row (tailored_docs) has evaluated, ready or failed; the
// state adds what the row cannot say alone: the gate, the window, the
// attempts and a changed description.
export const TAILOR_STATES = {
  unscored: 'no RM score yet; career-ops waits for it',
  not_eligible: 'RM below tailoring.min_fit_score; career-ops does not run (tailor.js --role ID --any-fit evaluates it; --force-cv also makes a CV)',
  outside_window: 'RM passes, but the role is older than board.max_age_days; the automatic run does not send it (tailor.js --role ID does)',
  incomplete: 'the employer site left the job text empty ("null" in place of the text); not sent',
  waiting: 'RM passes; the next career-ops run evaluates it',
  stale: 'the title or text changed after the evaluation; the next run evaluates it again (an earlier CV stays)',
  rerun: 'the owner added a skill; the next run evaluates it again',
  retry: 'the last run failed; the next run tries again',
  given_up: 'failed tailoring.max_attempts times with the same description; not sent again until the description changes',
  below_gate: 'evaluated; below the gate (RM min_fit_score and career-ops auto_pdf_score_threshold), so no CV',
  no_cv: 'evaluated and passed the gate, but older than tailoring.max_age_days when evaluated: no CV (tailor.js --role ID makes one)',
  evaluated: 'evaluated, no CV; the career-ops threshold is not known here, so the reason is not known',
  ready: 'a Word CV is made',
};

// row: id, title, description, age_date, source, best_fit (or po_fit and
// em_fit), tailored_status, tailored_score, tailored_cv (cv_file or a
// flag), tailored_hash, attempts, rerun. cvMinScore: the career-ops
// threshold, or null when it is not known (then an evaluated role with
// no CV gets 'evaluated' with no reason). Returns { state, next, text }:
// next is true when the next automatic tailor.js run sends the role.
export function tailorState(row, { minFit, cvMinScore = null, maxAttempts, boardFrom = null, hash = descriptionHash }) {
  const bestFit = row.best_fit != null ? row.best_fit : (row.po_fit == null && row.em_fit == null ? null : Math.max(row.po_fit || 0, row.em_fit || 0));
  const score = row.tailored_score != null ? Number(row.tailored_score) : null;
  const status = row.tailored_status || null;
  const result = (state, text) => ({ state, next: false, text });
  if (bestFit == null) return result('unscored', 'no RM score yet; career-ops waits for it');
  // The real selection rule, on this one row (lib/tailoring.js).
  const selected = Number(bestFit) >= minFit && selectForTailoring([row], { boardFrom, maxAttempts, hash }).length === 1;
  const rm = `RM ${bestFit}`;
  if (status === 'failed') {
    const same = row.tailored_hash === hash(row.title, row.description);
    if (same && (row.attempts || 0) >= maxAttempts) return result('given_up', `career-ops failed ${row.attempts} times; not sent again until the description changes`);
    if (!same) return { state: 'stale', next: selected, text: 'the last run failed, then the description changed; the next run evaluates it again' };
    return { state: 'retry', next: selected, text: `career-ops failed (${row.attempts || 0} of ${maxAttempts} tries); the next run tries again` };
  }
  if (!status) {
    if (Number(bestFit) < minFit) return result('not_eligible', `${rm} is below ${minFit}: career-ops does not run`);
    if (boardFrom && !(row.age_date && row.age_date >= boardFrom)) return result('outside_window', `${rm} passes, but the role is older than the board window (from ${boardFrom}): not sent`);
    if (incompleteDescription(row.description)) return result('incomplete', `${rm} passes, but the employer site left the job text empty: not sent`);
    return { state: 'waiting', next: selected, text: `${rm} passes; waiting for career-ops` };
  }
  const cv = Boolean(row.tailored_cv);
  const co = score != null ? `career-ops ${score}/5` : 'no career-ops score';
  if (row.tailored_hash !== hash(row.title, row.description)) {
    return { state: 'stale', next: selected, text: `${co}; the title or text changed after the evaluation: the next run evaluates it again${cv ? ' (the CV stays)' : ''}` };
  }
  if (row.rerun) return { state: 'rerun', next: selected, text: `${co}; a skill was added: the next run evaluates it again` };
  if (cv) return result('ready', `${co}; Word CV made`);
  if (cvMinScore == null) return result('evaluated', `${co}; no CV`);
  const passed = qualifies({ bestFit, careerOpsScore: score }, { minFit, minScore: cvMinScore });
  if (passed) return result('no_cv', `${co} and ${rm} pass the gate; no CV: the role was older than the CV window when evaluated`);
  const why = Number(bestFit) < minFit ? `${rm} is below ${minFit}` : `${co} is below ${cvMinScore}`;
  return result('below_gate', `${why}: no CV`);
}

// --- The server cycle (server.js refreshState) --------------------------

// One name for what the server does now. The refresh, the scoring and the
// tailoring run one after the other; a paused run or a retry wait comes
// after a refresh that stopped early.
export const CYCLE_PHASES = {
  refreshing: 'refresh.js runs',
  scoring: 'autoscore.js runs',
  tailoring: 'tailor.js runs',
  paused: 'the refresh stopped (sleep or network) and continues at a catch-up check',
  retry_wait: 'the refresh stopped with an error or a platform outage; the server tries again after schedule.retry_after_minutes (outage: schedule.outage_retry_minutes)',
  idle: 'nothing runs until the next refresh',
};

export function cyclePhase({ running = false, scoring = false, tailoring = false, paused = null, retryPending = false } = {}) {
  if (running) return 'refreshing';
  if (scoring) return 'scoring';
  if (tailoring) return 'tailoring';
  if (paused) return 'paused';
  if (retryPending) return 'retry_wait';
  return 'idle';
}
