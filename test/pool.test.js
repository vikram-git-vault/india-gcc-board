import { scrapeConcurrency, estimateSeconds, scrapeOrder, runPool, createThrottle, DEFAULT_CONCURRENCY } from '../lib/pool.js';
import { createSleepWatch } from '../lib/power.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('scrapeConcurrency', () => {
  test('default, valid value, cap, junk', () => {
    expect(scrapeConcurrency(undefined)).toBe(DEFAULT_CONCURRENCY);
    expect(scrapeConcurrency('3')).toBe(3);
    expect(scrapeConcurrency('100')).toBe(16);
    expect(scrapeConcurrency('0')).toBe(DEFAULT_CONCURRENCY);
    expect(scrapeConcurrency('two')).toBe(DEFAULT_CONCURRENCY);
  });
});

describe('scrapeOrder', () => {
  const nomura = { id: 'nomura', ats_type: 'custom', crawl_delay_seconds: 8, custom: { max_detail_fetches: 60 } };
  const ey = { id: 'ey', ats_type: 'custom', crawl_delay_seconds: 10, custom: {} };
  const wd = { id: 'wd', ats_type: 'workday', crawl_delay_seconds: 5 };
  test('estimate: detail-page scrapers by page budget, list APIs small', () => {
    expect(estimateSeconds(nomura)).toBe(600);
    expect(estimateSeconds(ey)).toBe(180);
    expect(estimateSeconds(wd)).toBe(20);
  });
  test('longest first; the last run time wins over the estimate', () => {
    expect(scrapeOrder([wd, ey, nomura]).map((e) => e.id)).toEqual(['nomura', 'ey', 'wd']);
    expect(scrapeOrder([wd, ey, nomura], { wd: 900 }).map((e) => e.id)).toEqual(['wd', 'nomura', 'ey']);
  });
});

describe('runPool', () => {
  test('not more than `limit` at a time, every item once', async () => {
    let active = 0;
    let peak = 0;
    const done = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1; peak = Math.max(peak, active);
      await tick();
      done.push(n);
      active -= 1;
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  test('shouldStop: no new items start, items in progress finish', async () => {
    const started = [];
    let stop = false;
    const result = await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      if (n === 2) stop = true;
      await tick();
    }, async () => stop);
    expect(result.stopped).toBe(true);
    expect(started.sort()).toEqual([1, 2]);
  });
  test('fewer items than the limit', async () => {
    const seen = [];
    await runPool(['a'], 6, async (x) => { seen.push(x); });
    expect(seen).toEqual(['a']);
    await expect(runPool([], 6, async () => {})).resolves.toEqual({ stopped: false });
  });
});

describe('createThrottle', () => {
  test('flush runs once after requests; nothing without a request', async () => {
    let calls = 0;
    const t = createThrottle(async () => { calls += 1; }, 60000);
    t.request(); t.request(); t.request();
    await t.flush();
    expect(calls).toBe(1);
    const idle = createThrottle(async () => { calls += 1; }, 60000);
    await idle.flush();
    expect(calls).toBe(1);
  });
  test('interval runs a requested call; errors go to onError', async () => {
    const errors = [];
    const t = createThrottle(async () => { throw new Error('disk full'); }, 10, (e) => errors.push(e.message));
    t.request();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await t.flush();
    expect(errors).toEqual(['disk full']);
  });
});

describe('createSleepWatch.sleptSince', () => {
  test('a sleep after the start counts, an earlier one does not', () => {
    let t = 0;
    const watch = createSleepWatch({ tickMs: 5000, gapMs: 30000, now: () => t });
    try {
      t = 100000; // sleep, woke at 100000
      watch.tick();
      expect(watch.sleptSince(50000)).toBe(true);
      expect(watch.sleptSince(100000)).toBe(false);
      t = 105000;
      expect(watch.sleptSince(102000)).toBe(false);
    } finally {
      watch.stop();
    }
  });
});
