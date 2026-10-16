// Parallel scrape helpers for refresh.js. Each active employer is on its
// own host (checked 2026-10-16: 92 employers, 92 hosts), so several
// employers run at once while each scraper keeps its own crawl delay
// between its requests. See docs/ARCHITECTURE.md §4.1. The number at the
// same time is settings.refresh.scrape_concurrency (config/settings.json).

import { settings } from './settings.js';

// Seconds an employer needs when no earlier run measured it: the
// detail-page scrapers read up to max_detail_fetches pages, one per crawl
// delay; a list API needs a few pages.
export function estimateSeconds(employer) {
  const delay = employer.crawl_delay_seconds || settings.scraping.default_crawl_delay_seconds;
  if (employer.ats_type === 'custom' || employer.ats_type === 'avature') {
    return ((employer.custom && employer.custom.max_detail_fetches) || 15) * (delay + 2);
  }
  return delay * 4;
}

// Longest first, so the slowest employer does not start last and keep the
// run open alone. previousSeconds: employer id -> seconds in the last run.
export function scrapeOrder(employers, previousSeconds = {}) {
  const cost = (e) => (previousSeconds[e.id] > 0 ? previousSeconds[e.id] : estimateSeconds(e));
  return [...employers].sort((a, b) => cost(b) - cost(a));
}

// Runs fn(item) for each item, not more than `limit` at a time, in list
// order. Before each new item, shouldStop() can stop the start of new
// items; the items in progress finish. Returns { stopped }.
export async function runPool(items, limit, fn, shouldStop = async () => false) {
  const queue = [...items];
  let stopped = false;
  const worker = async () => {
    while (queue.length && !stopped) {
      if (await shouldStop()) { stopped = true; break; }
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return { stopped };
}

// Calls fn at most once each intervalMs, and only after request(). With
// parallel employers, a publish after each one would read the database
// several times a minute for no change on the board.
export function createThrottle(fn, intervalMs, onError = () => {}) {
  let dirty = false;
  let running = null;
  const runNow = () => {
    if (running) return running;
    dirty = false;
    running = (async () => {
      try { await fn(); } catch (err) { onError(err); } finally { running = null; }
    })();
    return running;
  };
  const timer = setInterval(() => { if (dirty) runNow(); }, intervalMs);
  if (timer.unref) timer.unref();
  return {
    request() { dirty = true; },
    async flush() {
      clearInterval(timer);
      if (running) await running;
      if (dirty) await runNow();
    },
  };
}
