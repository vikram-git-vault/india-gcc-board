import { formatMinutes, formatProgress, reportProgress, formatScoringProgress, formatScoringSummary, formatRefreshSummary, reportSummary,
  formatTailoringProgress, formatTailoringResult, formatTailoringSummary } from '../lib/progress.js';

const start = '2026-10-14T00:30:00Z';
const now = new Date('2026-10-14T02:19:30Z');

describe('formatMinutes', () => {
  test('minutes and hours', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(59 * 60000 + 59000)).toBe('59 min');
    expect(formatMinutes(75 * 60000)).toBe('1 h 15 min');
    expect(formatMinutes(-5000)).toBe('0 min');
  });
});

describe('formatProgress', () => {
  test('employer i of n with time on the step', () => {
    const p = { stage: 'scrape', done: 14, total: 56, item: 'EY GDS, Nomura', at: '2026-10-14T02:17:25Z' };
    expect(formatProgress(p, start, now)).toBe('Refresh running 1 h 49 min: 14 of 56 employers done (now: EY GDS, Nomura)');
    expect(formatProgress({ ...p, item: '' }, start, now)).toBe('Refresh running 1 h 49 min: 14 of 56 employers done');
    const d = { stage: 'descriptions', done: 3, total: 12, item: 'BNY', at: '2026-10-14T02:17:25Z' };
    expect(formatProgress(d, start, now)).toBe('Refresh running 1 h 49 min: fetching description 3 of 12 (BNY), 2 min on this step');
  });
  test('stage without a count', () => {
    expect(formatProgress({ stage: 'classify', at: '2026-10-14T02:19:00Z' }, start, now))
      .toBe('Refresh running 1 h 49 min: classifying roles, 0 min on this step');
  });
  test('no progress yet', () => {
    expect(formatProgress(null, start, now)).toBe('Refresh running 1 h 49 min: starting');
  });
});

describe('reportProgress', () => {
  test('does nothing without an IPC channel', () => {
    expect(() => reportProgress('scrape', { done: 1, total: 2, item: 'X' })).not.toThrow();
  });
});

describe('formatScoringProgress', () => {
  const started = '2026-10-15T04:04:22Z';
  const at = new Date('2026-10-15T04:08:30Z');
  test('counts after a batch', () => {
    const p = { stage: 'score', total: 15, done: 10, scored: 9, rejected: 1, item: 'batch 1' };
    expect(formatScoringProgress(p, started, at)).toBe('Scoring running 4 min: 10 of 15 roles done (batch 1 running), 9 scored, 1 rejected, 5 left');
  });
  test('with the model', () => {
    const p = { total: 15, done: 15, scored: 13, rejected: 2, model: 'claude-opus-5-5' };
    expect(formatScoringProgress(p, started, at)).toBe('Scoring running 4 min: 15 of 15 roles done, 13 scored, 2 rejected, 0 left; model: claude-opus-5-5');
    expect(formatScoringSummary(p)).toBe('13 scored, 2 rejected (tried again next run), 0 left; model: claude-opus-5-5');
  });
  test('before the count is known, and nothing to score', () => {
    expect(formatScoringProgress(null, started, at)).toBe('Scoring running 4 min: finding the roles that need a score');
    expect(formatScoringProgress({ total: 0, done: 0 }, started, at)).toBe('Scoring running 4 min: no roles need a score');
  });
});

describe('formatScoringSummary', () => {
  test('final counts', () => {
    expect(formatScoringSummary({ total: 15, done: 15, scored: 13, rejected: 2, more: 0 }))
      .toBe('13 scored, 2 rejected (tried again next run), 0 left');
    expect(formatScoringSummary({ total: 50, done: 50, scored: 50, rejected: 0, more: 12 }))
      .toBe('50 scored, 0 rejected, 0 left; 12 more need a score (over the --max limit)');
  });
  test('no counts', () => {
    expect(formatScoringSummary(null)).toBe('no counts reported');
    expect(formatScoringSummary({ total: 0 })).toBe('no roles needed a score');
  });
});

describe('formatRefreshSummary', () => {
  const cp = {
    run_id: 'refresh_20261017T021211',
    started_at: '2026-10-17T02:12:11Z',
    employers: {
      nomura: { status: 'ok', count: 40, added: 3, updated: 37, closed: 2, seconds: 572 },
      chubb: { status: 'error', error: 'Request failed with status code 503', seconds: 30 },
      wise: { status: 'ok', count: 10, added: 1, updated: 9, closed: 0, seconds: 45 },
    },
  };
  const names = { nomura: 'Nomura', chubb: 'Chubb', wise: 'Wise' };

  test('all lines', () => {
    expect(formatRefreshSummary({
      cp, names, finishedAt: '2026-10-17T02:28:35Z', expired: 4,
      descriptions: { ok: 19, gone: 1, error: 0, skipped: 2 },
      classified: { total: 100, target: 20, exception: 5, excluded: 75 },
      rolesOnBoard: 24,
    })).toEqual([
      '=== Refresh complete in 16 min: 2 of 3 employers succeeded, 1 failed ===',
      '  Failed: Chubb (Request failed with status code 503)',
      '  Roles: 50 matching roles read, 4 new, 46 seen again, 2 closed (left the site), 4 closed (closing date passed)',
      '  Descriptions: 19 fetched, 1 closed postings, 0 errors, 2 skipped',
      '  Classified: 100 roles, 20 target, 5 exception, 75 excluded',
      '  Board: 24 roles in data/roles.json',
      '  Slowest employers: Nomura 9 min 32 s, Wise 45 s, Chubb 30 s',
    ]);
  });

  test('resumed run with no failures leaves out the optional lines', () => {
    const lines = formatRefreshSummary({
      cp: { ...cp, employers: { wise: cp.employers.wise } }, names, finishedAt: '2026-10-17T03:30:00Z', resumed: true,
    });
    expect(lines[0]).toBe('=== Refresh complete in 1 h 17 min (resumed run): 1 of 1 employers succeeded, 0 failed ===');
    expect(lines.some((l) => l.includes('Failed:') || l.includes('Board:'))).toBe(false);
  });

  test('a run with too many failed employers says it is not complete', () => {
    const lines = formatRefreshSummary({ cp, names, finishedAt: '2026-10-17T02:28:35Z', incomplete: 'more than 50% of employers failed' });
    expect(lines[0]).toBe('=== Refresh NOT complete (more than 50% of employers failed) after 16 min: 2 of 3 employers succeeded, 1 failed ===');
  });

  test('a platform outage gives one line before the failed employers', () => {
    const lines = formatRefreshSummary({
      cp, names, finishedAt: '2026-10-17T02:28:35Z', incomplete: 'platform down: workday wd5',
      outages: ['workday wd5 (23 of 23 employers, HTTP 521)'],
    });
    expect(lines[0]).toBe('=== Refresh NOT complete (platform down: workday wd5) after 16 min: 2 of 3 employers succeeded, 1 failed ===');
    expect(lines[1]).toBe('  Platform down: workday wd5 (23 of 23 employers, HTTP 521)');
    expect(lines[2]).toMatch(/^ {2}Failed: Chubb/);
  });
});

describe('reportSummary', () => {
  test('does nothing without an IPC channel', () => {
    expect(() => reportSummary(['=== Refresh complete ==='])).not.toThrow();
  });
});

describe('tailoring progress', () => {
  const start = '2026-11-05T02:53:00.000Z';
  const now = new Date('2026-11-05T03:07:00.000Z');
  const base = { total: 34, done: 5, scored: 5, passed: 2, ready: 1, too_old: 1, failed: 0, cv_from: '2026-11-02' };
  test('before the count is known, and no roles', () => {
    expect(formatTailoringProgress(null, start, now)).toBe('Tailoring running 14 min: finding the roles that need career-ops');
    expect(formatTailoringProgress({ total: 0 }, start, now)).toBe('Tailoring running 14 min: no roles need career-ops');
  });
  test('the role in progress, its step, model and time', () => {
    const p = { ...base, item: 'Barclays: Director', step: 'CV and cover letter', model: 'claude-opus-5-5', role_started: '2026-11-05T03:05:00.000Z' };
    expect(formatTailoringProgress(p, start, now)).toBe('Tailoring running 14 min: 5 of 34 roles done '
      + '(now: Barclays: Director, CV and cover letter on claude-opus-5-5, 2 min on this role); '
      + '5 scored, 2 passed the gate, 1 Word CVs, 1 too old for a CV, 0 failed, 29 left');
  });
  test('a line for each finished role', () => {
    const line = (last) => formatTailoringResult({ ...base, last: { role: 'Barclays: Director', seconds: 185, ...last } });
    expect(line({ score: 4.2, outcome: 'ready' })).toBe('Tailoring role 5 of 34: Barclays: Director: career-ops 4.2/5, Word CV made (3 min 5 s)');
    expect(line({ score: 3.5, outcome: 'below' })).toMatch(/career-ops 3\.5\/5, below the CV threshold, no CV/);
    expect(line({ score: 4, outcome: 'too_old', age_date: '2026-10-30' })).toMatch(/dated 2026-10-30 \(posted or changed\), before 2026-11-02: no CV/);
    expect(line({ score: null, outcome: 'failed', error: 'the worker took more than 20 minutes' })).toMatch(/: failed: the worker took more than 20 minutes/);
    expect(formatTailoringResult(base)).toBeNull();
  });
  test('the summary, also after a usage limit', () => {
    expect(formatTailoringSummary({ ...base, done: 34 })).toBe('5 scored, 2 passed the gate, 1 Word CVs, 1 too old for a CV, 0 failed, 0 left');
    expect(formatTailoringSummary({ ...base, stopped: 'Claude usage limit: x' })).toMatch(/29 left; stopped: Claude usage limit: x$/);
  });
});
