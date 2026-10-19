import { isNetworkError, waitForNetwork, createNetworkGate } from '../lib/network.js';
import { failIfAllFailed } from '../lib/scrapers/BaseScraper.js';

describe('isNetworkError', () => {
  test('no network: DNS and local address errors', () => {
    expect(isNetworkError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND careers.ey.com' })).toBe(true);
    expect(isNetworkError(new Error('connect EADDRNOTAVAIL 3.253.170.55:443 - Local (192.168.29.16:57332)'))).toBe(true);
    expect(isNetworkError({ message: 'x', cause: { code: 'EAI_AGAIN' } })).toBe(true);
    expect(isNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED at https://x'))).toBe(true);
  });
  test('a problem of one site is not a network error', () => {
    expect(isNetworkError(new Error('Request failed with status code 503'))).toBe(false);
    expect(isNetworkError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isNetworkError({ code: 'ETIMEDOUT', message: 'timeout' })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

const noSleep = async () => {};

describe('waitForNetwork', () => {
  test('true at once when online', async () => {
    let checks = 0;
    expect(await waitForNetwork({ check: async () => { checks += 1; return true; }, sleep: noSleep })).toBe(true);
    expect(checks).toBe(1);
  });
  test('true when the network comes back before the limit', async () => {
    const answers = [false, false, true];
    const waits = [];
    const back = await waitForNetwork({
      check: async () => answers.shift(), intervalMs: 30000, maxWaitMs: 900000, sleep: noSleep, onWait: (m) => waits.push(m),
    });
    expect(back).toBe(true);
    expect(waits).toEqual([0, 1]);
  });
  test('false after the limit', async () => {
    let checks = 0;
    const back = await waitForNetwork({ check: async () => { checks += 1; return false; }, intervalMs: 30000, maxWaitMs: 90000, sleep: noSleep });
    expect(back).toBe(false);
    expect(checks).toBe(4); // at 0, 30, 60 and 90 s
  });
});

describe('createNetworkGate', () => {
  test('parallel employers share one wait', async () => {
    let checks = 0;
    let release;
    const gate = createNetworkGate({
      check: async () => { checks += 1; return checks > 1; },
      sleep: () => new Promise((r) => { release = r; }),
    });
    const a = gate.wait();
    const b = gate.wait();
    expect(gate.waiting).toBe(true);
    const ready = gate.ready();
    await new Promise((r) => setImmediate(r));
    release();
    expect(await Promise.all([a, b, ready])).toEqual([true, true, true]);
    expect(checks).toBe(2);
    expect(gate.waiting).toBe(false);
    expect(gate.lost).toBe(false);
  });
  test('lost after a wait without a network; new employers stop', async () => {
    const gate = createNetworkGate({ check: async () => false, intervalMs: 1, maxWaitMs: 2, sleep: noSleep });
    expect(await gate.wait()).toBe(false);
    expect(gate.lost).toBe(true);
    expect(await gate.ready()).toBe(false);
    expect(await gate.wait()).toBe(false);
  });
  test('ready without a wait is true', async () => {
    expect(await createNetworkGate({ check: async () => true }).ready()).toBe(true);
  });
});

describe('failIfAllFailed', () => {
  const err = Object.assign(new Error('getaddrinfo ENOTFOUND careers.wise.com'), { code: 'ENOTFOUND' });
  test('every detail page failed: an error that keeps the code', () => {
    expect(() => failIfAllFailed(15, 0, err)).toThrow('all 15 detail pages failed (last: getaddrinfo ENOTFOUND careers.wise.com)');
    try { failIfAllFailed(15, 0, err); } catch (e) { expect(e.code).toBe('ENOTFOUND'); }
  });
  test('some pages read, no pages to read, or no error: no error', () => {
    expect(() => failIfAllFailed(15, 3, err)).not.toThrow();
    expect(() => failIfAllFailed(0, 0, null)).not.toThrow();
    expect(() => failIfAllFailed(5, 0, null)).not.toThrow();
  });
});
