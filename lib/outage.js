// Platform outages. When many employers on one platform (for Workday, one
// cluster such as wd5) fail with a server error (HTTP 500 to 599) in the
// same run, the platform is down, not each employer. Example: 2026-11-14,
// Cloudflare 521 on every employer on Workday wd1 and wd5. refresh.js then
// stops with OUTAGE_EXIT_CODE, and server.js tries the failed employers
// again after schedule.outage_retry_minutes (--resume).
import { settings } from './settings.js';

export const OUTAGE_EXIT_CODE = 76;

// The platform group of an employer: Workday clusters fail one by one, so
// each cluster is its own group.
export function platformOf(employer) {
  if (employer.ats_type === 'workday' && employer.workday && employer.workday.cluster) {
    return `workday ${employer.workday.cluster}`;
  }
  return employer.ats_type || 'unknown';
}

export function isServerError(status) {
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

// The HTTP status of a failed request (axios), if there is one.
export function httpStatusOf(err) {
  const status = (err && err.response && err.response.status) || (err && err.status);
  return Number.isInteger(status) ? status : null;
}

// The platforms that are down in this run: [{ platform, failed: [ids],
// total, statuses }]. Only employers with a result in the checkpoint count.
export function findOutages(cp, employers, {
  minEmployers = settings.refresh.outage_min_employers,
  minPercent = settings.refresh.outage_min_percent,
} = {}) {
  const groups = new Map();
  for (const employer of employers) {
    const result = cp.employers[employer.id];
    if (!employer.active || !result) continue;
    const platform = platformOf(employer);
    if (!groups.has(platform)) groups.set(platform, { platform, failed: [], total: 0, statuses: new Set() });
    const group = groups.get(platform);
    group.total += 1;
    if (result.status === 'error' && isServerError(result.http_status)) {
      group.failed.push(employer.id);
      group.statuses.add(result.http_status);
    }
  }
  return [...groups.values()]
    .filter((g) => g.failed.length >= minEmployers && (100 * g.failed.length) / g.total >= minPercent)
    .map((g) => ({ ...g, statuses: [...g.statuses].sort((a, b) => a - b) }));
}

export function formatOutage({ platform, failed, total, statuses }) {
  return `${platform} (${failed.length} of ${total} employers, HTTP ${statuses.join(', ')})`;
}
