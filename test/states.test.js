import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import {
  SHORTLISTED_SQL, SHORTLISTED_TIERS, roleState, descriptionState, DESCRIPTION_STATES, rmState, RM_STATES, readScoreAttempts,
  tailorState, TAILOR_STATES, cyclePhase, CYCLE_PHASES,
} from '../lib/states.js';
import { descriptionHash } from '../lib/scoring.js';
import { settings } from '../lib/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'states-'));
const db = await import('../lib/database.js');
db.useDatabasePath(path.join(dir, 'jobs.db'));
await db.initDb();
afterAll(() => db.closeDb());

const SLUG = 'nomura'; // any employer in config/employers.json

describe('tier constants', () => {
  test('the shortlist SQL names target and exception', () => {
    expect(SHORTLISTED_TIERS).toEqual(['target', 'exception']);
    expect(SHORTLISTED_SQL).toBe("tier IN ('target', 'exception')");
  });
});

describe('roleState', () => {
  test('open, and the manual note', () => {
    expect(roleState({ is_active: 1 })).toEqual({ state: 'open', why: null, manual: false });
    expect(roleState({ is_active: 1, source: 'manual' }).manual).toBe(true);
  });
  test('closed, with the reason the columns show', () => {
    expect(roleState({ is_active: 0, description_status: 'gone' })).toMatchObject({ state: 'closed', why: /detail page/ });
    expect(roleState({ is_active: 0, deadline: '2026-01-31' }, '2026-02-01')).toMatchObject({ why: /closing date 2026-01-31/ });
    expect(roleState({ is_active: 0, deadline: '2999-01-31' }, '2026-02-01')).toMatchObject({ why: /not on the employer site/ });
    expect(roleState({ is_active: 0 })).toMatchObject({ why: /not on the employer site/ });
  });
});

describe('descriptionState', () => {
  const d = settings.descriptions;
  const opts = { descriptions: d, minChars: d.min_full_chars, now: new Date('2026-11-12T12:00:00Z') };
  const hoursAgo = (h) => new Date(opts.now - h * 3600 * 1000).toISOString();
  const base = { is_active: 1, tier: 'target', source: null, description: '' };

  test('every state has a text', () => {
    ['owner', 'listing', 'missing', 'fetched', 'closed', 'error', 'skipped'].forEach((s) => expect(DESCRIPTION_STATES[s]).toBeTruthy());
  });
  test('no status: short text is missing and due, long text came from the listing', () => {
    expect(descriptionState({ ...base }, opts)).toEqual({ state: 'missing', due: true });
    expect(descriptionState({ ...base, description: 'x'.repeat(d.min_full_chars) }, opts)).toEqual({ state: 'listing', due: false });
  });
  test('fetched: due again after refetch_ok_days', () => {
    expect(descriptionState({ ...base, description_status: 'ok', description_fetched_at: hoursAgo(1) }, opts)).toEqual({ state: 'fetched', due: false });
    expect(descriptionState({ ...base, description_status: 'ok', description_fetched_at: hoursAgo(d.refetch_ok_days * 24 + 1) }, opts)).toEqual({ state: 'fetched', due: true });
  });
  test('error and skipped: their own retry ages; SQLite timestamps are UTC', () => {
    expect(descriptionState({ ...base, description_status: 'error', description_fetched_at: hoursAgo(d.retry_error_hours - 1) }, opts).due).toBe(false);
    expect(descriptionState({ ...base, description_status: 'error', description_fetched_at: hoursAgo(d.retry_error_hours + 1) }, opts).due).toBe(true);
    expect(descriptionState({ ...base, description_status: 'skipped', description_fetched_at: hoursAgo(d.retry_skipped_days * 24 - 1) }, opts).due).toBe(false);
    expect(descriptionState({ ...base, description_status: 'skipped', description_fetched_at: '2026-01-01 00:00:00' }, opts)).toEqual({ state: 'skipped', due: true });
  });
  test('closed: due only while the role is active again', () => {
    expect(descriptionState({ ...base, description_status: 'gone' }, opts)).toEqual({ state: 'closed', due: true });
    expect(descriptionState({ ...base, is_active: 0, description_status: 'gone' }, opts)).toEqual({ state: 'closed', due: false });
  });
  test('never due: a manual role, an excluded role, a closed role', () => {
    expect(descriptionState({ ...base, source: 'manual', description_status: 'ok' }, opts)).toEqual({ state: 'owner', due: false });
    expect(descriptionState({ ...base, tier: 'excluded' }, opts).due).toBe(false);
    expect(descriptionState({ ...base, is_active: 0 }, opts).due).toBe(false);
  });

  test('agrees with getRolesNeedingDescription on every state', async () => {
    const role = (id, extra = {}) => ({
      external_job_id: id, title: `Role ${id}`, description: '', location: 'Mumbai', country: 'India', department: null,
      experience_level: 'entry', job_type: null, salary_range: null, posted_date: null, deadline: null,
      job_url: `https://x.example.com/job/${id}`, source_updated: null, grade: null, family: null, tier: 'target', tier_reason: null, ...extra,
    });
    await db.syncRoles(SLUG, [
      role('d-missing'), role('d-listing', { description: 'x'.repeat(d.min_full_chars) }), role('d-ok-new'), role('d-ok-old'),
      role('d-error-new'), role('d-error-old'), role('d-skipped-old'), role('d-gone'), role('d-excluded', { tier: 'excluded' }),
    ]);
    const conn = new sqlite3.Database(db.databasePath());
    const run = (sql, p = []) => new Promise((ok, no) => conn.run(sql, p, (e) => (e ? no(e) : ok())));
    const all = (sql, p = []) => new Promise((ok, no) => conn.all(sql, p, (e, r) => (e ? no(e) : ok(r))));
    const set = (id, status, hoursOld) => run(
      `UPDATE roles SET description_status = ?, description_fetched_at = datetime('now', ?) WHERE external_job_id = ?`,
      [status, `-${hoursOld} hours`, id]);
    await set('d-ok-new', 'ok', 1);
    await set('d-ok-old', 'ok', d.refetch_ok_days * 24 + 1);
    await set('d-error-new', 'error', 1);
    await set('d-error-old', 'error', d.retry_error_hours + 1);
    await set('d-skipped-old', 'skipped', d.retry_skipped_days * 24 + 1);
    await set('d-gone', 'gone', 1);
    await db.addManualRole({ company: 'Example Manual Co', title: 'Head of Platform', url: 'https://m.example.com/j/1', jobId: 'd-manual', text: 'x'.repeat(600) });
    const rows = await all(`SELECT r.id, r.external_job_id, r.is_active, r.tier, r.source, r.description, r.description_status, r.description_fetched_at
      FROM roles r WHERE r.external_job_id LIKE 'd-%'`);
    conn.close();
    const predicted = rows.filter((r) => descriptionState(r, { descriptions: d, minChars: d.min_full_chars }).due).map((r) => r.id).sort();
    const fromSql = (await db.getRolesNeedingDescription(d.min_full_chars)).map((r) => r.id).filter((id) => rows.some((r) => r.id === id)).sort();
    expect(fromSql).toEqual(predicted);
    // The expected set, by name, so a wrong SQL and a wrong prediction cannot agree by accident.
    const names = rows.filter((r) => predicted.includes(r.id)).map((r) => r.external_job_id).sort();
    expect(names).toEqual(['d-error-old', 'd-gone', 'd-missing', 'd-ok-old', 'd-skipped-old']);
  });
});

describe('rmState', () => {
  const row = (extra = {}) => ({ id: 1, title: 't', description: 'd', scored_hash: descriptionHash('t', 'd'), scored_rubric_version: 2, scored_best_fit: 80, age_date: '2026-11-10', ...extra });
  const opts = { rubric: 2, rescoreMinFit: 65, boardFrom: '2026-10-13', maxAttempts: 2 };
  test('every state has a text', () => {
    ['scored', 'stale', 'waiting', 'given_up', 'outside_window'].forEach((s) => expect(RM_STATES[s]).toBeTruthy());
  });
  test('scored, stale (text or rubric), waiting', () => {
    expect(rmState(row(), opts)).toBe('scored');
    expect(rmState(row({ description: 'other' }), opts)).toBe('stale');
    expect(rmState(row({ scored_rubric_version: 1 }), opts)).toBe('stale');
    expect(rmState(row({ scored_rubric_version: 1, scored_best_fit: 50 }), opts)).toBe('scored');
    expect(rmState(row({ scored_hash: null }), opts)).toBe('waiting');
  });
  test('given up: rejected max_attempts times with the same description; a new description starts again', () => {
    const attempts = { 1: { hash: descriptionHash('t', 'd'), count: 2 } };
    expect(rmState(row({ scored_hash: null }), { ...opts, attempts })).toBe('given_up');
    expect(rmState(row({ scored_hash: null }), { ...opts, attempts: { 1: { hash: 'old', count: 2 } } })).toBe('waiting');
    expect(rmState(row({ scored_hash: null }), { ...opts, attempts: { 1: { hash: descriptionHash('t', 'd'), count: 1 } } })).toBe('waiting');
  });
  test('outside the board window: not scored again', () => {
    expect(rmState(row({ scored_hash: null, age_date: '2026-09-01' }), opts)).toBe('outside_window');
    expect(rmState(row({ description: 'other', age_date: null }), opts)).toBe('outside_window');
    expect(rmState(row({ scored_hash: null, age_date: '2026-09-01' }), { ...opts, boardFrom: null })).toBe('waiting');
  });
  test('readScoreAttempts: {} without a file', () => {
    expect(readScoreAttempts(path.join(dir, 'none.json'))).toEqual({});
    const file = path.join(dir, 'attempts.json');
    fs.writeFileSync(file, JSON.stringify({ 7: { hash: 'h', count: 2 } }));
    expect(readScoreAttempts(file)).toEqual({ 7: { hash: 'h', count: 2 } });
  });
});

describe('tailorState', () => {
  const hash = descriptionHash;
  const h = hash('t', 'd');
  const row = (extra = {}) => ({ id: 1, title: 't', description: 'd', age_date: '2026-11-10', source: null, best_fit: 80, ...extra });
  const opts = { minFit: 75, cvMinScore: 4.0, maxAttempts: 2, boardFrom: '2026-10-13', hash };

  test('every state has a text', () => {
    ['unscored', 'not_eligible', 'outside_window', 'incomplete', 'waiting', 'stale', 'rerun', 'retry', 'given_up', 'below_gate', 'no_cv', 'evaluated', 'ready']
      .forEach((s) => expect(TAILOR_STATES[s]).toBeTruthy());
  });
  test('before career-ops: unscored, not eligible, outside the window, incomplete, waiting', () => {
    expect(tailorState(row({ best_fit: null }), opts)).toMatchObject({ state: 'unscored', next: false });
    expect(tailorState(row({ best_fit: null, po_fit: 70, em_fit: 76 }), opts).state).toBe('waiting');
    expect(tailorState(row({ best_fit: 74 }), opts)).toMatchObject({ state: 'not_eligible', next: false, text: /RM 74 is below 75/ });
    expect(tailorState(row({ age_date: '2026-09-01' }), opts)).toMatchObject({ state: 'outside_window', next: false });
    expect(tailorState(row({ description: 'Your opportunitynullWhat is in it' }), opts)).toMatchObject({ state: 'incomplete', next: false });
    expect(tailorState(row(), opts)).toMatchObject({ state: 'waiting', next: true });
  });
  test('failed: retry, then given up; a new description is sent again', () => {
    expect(tailorState(row({ tailored_status: 'failed', tailored_hash: h, attempts: 1 }), opts)).toMatchObject({ state: 'retry', next: true });
    expect(tailorState(row({ tailored_status: 'failed', tailored_hash: h, attempts: 2 }), opts)).toMatchObject({ state: 'given_up', next: false });
    expect(tailorState(row({ tailored_status: 'failed', tailored_hash: 'old', attempts: 2 }), opts)).toMatchObject({ state: 'stale', next: true });
    expect(tailorState(row({ tailored_status: 'failed', tailored_hash: h, attempts: 1, age_date: '2026-09-01' }), opts)).toMatchObject({ state: 'retry', next: false });
  });
  test('evaluated: stale, rerun, ready, below the gate, passed with no CV', () => {
    const ev = (extra) => row({ tailored_status: 'evaluated', tailored_hash: h, tailored_score: 4.2, ...extra });
    expect(tailorState(ev({ tailored_hash: 'old' }), opts)).toMatchObject({ state: 'stale', next: true });
    expect(tailorState(ev({ rerun: 1 }), opts)).toMatchObject({ state: 'rerun', next: true });
    expect(tailorState(ev({ tailored_status: 'ready', tailored_cv: 'cv.docx' }), opts)).toMatchObject({ state: 'ready', next: false, text: /Word CV made/ });
    // An evaluation with no CV keeps the earlier CV: still ready.
    expect(tailorState(ev({ tailored_cv: 'cv.docx' }), opts).state).toBe('ready');
    expect(tailorState(ev({ tailored_score: 3.6 }), opts)).toMatchObject({ state: 'below_gate', text: /career-ops 3.6\/5 is below 4/ });
    expect(tailorState(ev({ best_fit: 70 }), opts)).toMatchObject({ state: 'below_gate', text: /RM 70 is below 75/ });
    expect(tailorState(ev(), opts)).toMatchObject({ state: 'no_cv', next: false, text: /pass the gate; no CV/ });
    expect(tailorState(ev(), { ...opts, cvMinScore: null })).toMatchObject({ state: 'evaluated' });
  });
  test('stale with a CV: the CV stays', () => {
    expect(tailorState(row({ tailored_status: 'ready', tailored_hash: 'old', tailored_score: 4.4, tailored_cv: 'cv.docx' }), opts))
      .toMatchObject({ state: 'stale', next: true, text: /the CV stays/ });
  });
});

describe('cyclePhase', () => {
  test('every phase has a text', () => {
    ['idle', 'refreshing', 'scoring', 'tailoring', 'paused', 'retry_wait'].forEach((p) => expect(CYCLE_PHASES[p]).toBeTruthy());
  });
  test('the order of precedence', () => {
    expect(cyclePhase({})).toBe('idle');
    expect(cyclePhase({ running: true, scoring: true })).toBe('refreshing');
    expect(cyclePhase({ scoring: true, tailoring: true })).toBe('scoring');
    expect(cyclePhase({ tailoring: true, paused: 'no network' })).toBe('tailoring');
    expect(cyclePhase({ paused: 'no network', retryPending: true })).toBe('paused');
    expect(cyclePhase({ retryPending: true })).toBe('retry_wait');
  });
});
