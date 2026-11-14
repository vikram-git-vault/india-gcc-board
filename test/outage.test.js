import { platformOf, isServerError, httpStatusOf, findOutages, formatOutage } from '../lib/outage.js';

const workday = (id, cluster) => ({ id, name: id, ats_type: 'workday', workday: { tenant: id, cluster, site: 'x' }, active: true });
const custom = (id) => ({ id, name: id, ats_type: 'custom', active: true });
const down = (status = 521) => ({ status: 'error', error: `Request failed with status code ${status}`, http_status: status });
const ok = { status: 'ok', count: 1 };

describe('platformOf', () => {
  test('a Workday employer groups by cluster; others by ats_type', () => {
    expect(platformOf(workday('visa', 'wd5'))).toBe('workday wd5');
    expect(platformOf(custom('nestle'))).toBe('custom');
    expect(platformOf({ ats_type: 'workday' })).toBe('workday');
    expect(platformOf({})).toBe('unknown');
  });
});

describe('isServerError and httpStatusOf', () => {
  test('only HTTP 500 to 599 is a server error', () => {
    expect(isServerError(521)).toBe(true);
    expect(isServerError(500)).toBe(true);
    expect(isServerError(404)).toBe(false);
    expect(isServerError(null)).toBe(false);
  });

  test('reads the axios response status, then err.status', () => {
    expect(httpStatusOf({ response: { status: 521 } })).toBe(521);
    expect(httpStatusOf({ status: 503 })).toBe(503);
    expect(httpStatusOf(new Error('timeout'))).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
  });
});

describe('findOutages', () => {
  const opts = { minEmployers: 3, minPercent: 50 };

  test('the 2026-11-14 case: wd5 all down, wd3 up', () => {
    const employers = ['a', 'b', 'c', 'd'].map((id) => workday(id, 'wd5')).concat(['e', 'f', 'g'].map((id) => workday(id, 'wd3')));
    const cp = { employers: { a: down(), b: down(), c: down(), d: down(), e: ok, f: ok, g: ok } };
    const outages = findOutages(cp, employers, opts);
    expect(outages).toEqual([{ platform: 'workday wd5', failed: ['a', 'b', 'c', 'd'], total: 4, statuses: [521] }]);
    expect(formatOutage(outages[0])).toBe('workday wd5 (4 of 4 employers, HTTP 521)');
  });

  test('fewer than minEmployers failed: no outage', () => {
    const employers = ['a', 'b', 'c'].map((id) => workday(id, 'wd1'));
    expect(findOutages({ employers: { a: down(), b: down(), c: ok } }, employers, opts)).toEqual([]);
  });

  test('less than minPercent of the platform failed: no outage', () => {
    const employers = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => workday(id, 'wd1'));
    const cp = { employers: { a: down(), b: down(), c: down(), d: ok, e: ok, f: ok, g: ok } };
    expect(findOutages(cp, employers, opts)).toEqual([]);
  });

  test('404 errors are site changes, not an outage', () => {
    const employers = ['a', 'b', 'c'].map(custom);
    expect(findOutages({ employers: { a: down(404), b: down(404), c: down(404) } }, employers, opts)).toEqual([]);
  });

  test('inactive employers and employers with no result do not count', () => {
    const employers = [workday('a', 'wd5'), workday('b', 'wd5'), workday('c', 'wd5'), { ...workday('d', 'wd5'), active: false }, workday('e', 'wd5')];
    const cp = { employers: { a: down(503), b: down(521), c: down(521), d: ok } };
    expect(findOutages(cp, employers, opts)).toEqual([{ platform: 'workday wd5', failed: ['a', 'b', 'c'], total: 3, statuses: [503, 521] }]);
  });
});
