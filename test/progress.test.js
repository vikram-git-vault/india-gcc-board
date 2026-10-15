import { formatMinutes, formatProgress, reportProgress, formatScoringProgress, formatScoringSummary } from '../lib/progress.js';

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
    const p = { stage: 'scrape', done: 14, total: 56, item: 'EY GDS', at: '2026-10-14T02:17:25Z' };
    expect(formatProgress(p, start, now)).toBe('Refresh running 1 h 49 min: scraping employer 14 of 56 (EY GDS), 2 min on this step');
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
