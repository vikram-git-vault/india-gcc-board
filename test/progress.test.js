import { formatMinutes, formatProgress, reportProgress } from '../lib/progress.js';

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
