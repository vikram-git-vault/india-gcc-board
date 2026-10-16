import axios from 'axios';
import { load } from 'cheerio';
import { isPathAllowed } from './scrapers/BaseScraper.js';
import { settings } from './settings.js';

// Full job descriptions for shortlisted roles (target + exception tiers).
// The Workday and Oracle list APIs return titles only, so scoring needs one
// detail request per role. Fetched once and stored in roles.full_description
// (a column syncRoles never overwrites); see docs/ARCHITECTURE.md.

// A scraped description at least this long is already the full text
// (Greenhouse, Avature, custom sitemap scrapers); shorter ones (Oracle's
// ShortDescriptionStr, Workday's empty string) need a detail fetch.
export const MIN_FULL_DESCRIPTION_CHARS = settings.descriptions.min_full_chars;

// Long enough for any real posting; stops a runaway page bloating the DB.
const MAX_DESCRIPTION_CHARS = settings.descriptions.max_chars;

const client = axios.create({
  timeout: settings.scraping.request_timeout_seconds * 1000,
  headers: { 'User-Agent': settings.scraping.user_agent, Accept: 'application/json' },
  validateStatus: () => true,
});

// Keeps paragraph and list breaks so the text stays readable for scoring.
export function htmlToText(html) {
  if (!html) return '';
  const $ = load(String(html));
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4, h5, h6, tr').each((_, el) => { $(el).append('\n'); });
  $('li').each((_, el) => { $(el).prepend('- '); });
  return $.text()
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}

function workdayDetailUrl(role, workday) {
  const cluster = workday.cluster || 'wd1';
  const host = `${workday.tenant}.${cluster}.myworkdayjobs.com`;
  const prefix = `https://${host}/${workday.site}`;
  if (!role.job_url.startsWith(prefix)) {
    throw new Error(`job_url does not start with ${prefix}`);
  }
  const externalPath = role.job_url.slice(prefix.length);
  return `https://${host}/wday/cxs/${workday.tenant}/${workday.site}${externalPath}`;
}

async function fetchWorkday(role, workday) {
  const url = workdayDetailUrl(role, workday);
  const res = await client.get(url);
  // Workday answers 403 with errorCode S22 "permission denied" for a closed
  // posting. Any other 403 (a WAF, a rate limit) is an error, not a closure.
  const closed = res.status === 404 || (res.status === 403 && res.data && res.data.errorCode === 'S22');
  if (closed) return { status: 'gone' };
  if (res.status !== 200) return { status: 'error', message: `HTTP ${res.status}` };
  const info = res.data && res.data.jobPostingInfo;
  const text = htmlToText(info && info.jobDescription);
  return text ? { status: 'ok', text } : { status: 'error', message: 'empty jobDescription' };
}

async function fetchOracle(role, oracle) {
  if (!/^\d+$/.test(String(role.external_job_id))) {
    return { status: 'error', message: `unexpected Oracle requisition id: ${role.external_job_id}` };
  }
  const url = `https://${oracle.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`;
  const res = await client.get(url, {
    params: {
      expand: 'all',
      onlyData: true,
      finder: `ById;Id="${role.external_job_id}",siteNumber=${oracle.siteNumber}`,
    },
  });
  if (res.status === 404) return { status: 'gone' };
  if (res.status !== 200) return { status: 'error', message: `HTTP ${res.status}` };
  const item = res.data && res.data.items && res.data.items[0];
  if (!item) return { status: 'gone' };
  const parts = [
    item.ExternalDescriptionStr,
    item.ExternalResponsibilitiesStr,
    item.ExternalQualificationsStr,
  ].map(htmlToText).filter(Boolean);
  const text = parts.join('\n\n');
  return text ? { status: 'ok', text } : { status: 'error', message: 'empty description fields' };
}

async function fetchEightfold(role, eightfold) {
  if (!/^\d+$/.test(String(role.external_job_id))) {
    return { status: 'error', message: `unexpected Eightfold position id: ${role.external_job_id}` };
  }
  if (eightfold.api === 'pcsx') {
    const res = await client.get(`https://${eightfold.host}/api/pcsx/position_details`, {
      params: { position_id: role.external_job_id, domain: eightfold.domain, hl: 'en' },
    });
    if (res.status === 404) return { status: 'gone' };
    if (res.status !== 200) return { status: 'error', message: `HTTP ${res.status}` };
    const text = htmlToText(res.data && res.data.data && res.data.data.jobDescription);
    return text ? { status: 'ok', text } : { status: 'error', message: 'empty jobDescription' };
  }
  const url = `https://${eightfold.host}/api/apply/v2/jobs/${role.external_job_id}`;
  const res = await client.get(url, { params: { domain: eightfold.domain } });
  if (res.status === 404) return { status: 'gone' };
  if (res.status !== 200) return { status: 'error', message: `HTTP ${res.status}` };
  const text = htmlToText(res.data && res.data.job_description);
  return text ? { status: 'ok', text } : { status: 'error', message: 'empty job_description' };
}

async function fetchPhenom(role, phenom) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(role.external_job_id))) {
    return { status: 'error', message: `unexpected Phenom jobSeqNo: ${role.external_job_id}` };
  }
  const res = await client.post(`https://${phenom.host}/widgets`, {
    lang: phenom.lang, deviceType: 'desktop', country: phenom.country, pageName: 'job',
    ddoKey: 'jobDetail', jobSeqNo: String(role.external_job_id), siteType: 'external',
  }, { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) return { status: 'error', message: `HTTP ${res.status}` };
  const detail = res.data && typeof res.data === 'object' ? res.data.jobDetail : null;
  const job = detail && detail.data && detail.data.job;
  // A closed posting comes back as HTTP 200 with status 200 and 0 hits,
  // not a 404. Any other shape (an HTML challenge page, an error status
  // inside the body) is an error: "gone" would hide the role.
  if (detail && Number(detail.status) === 200 && Number(detail.totalHits ?? detail.hits) === 0) return { status: 'gone' };
  if (!job || !Object.keys(job).length) return { status: 'error', message: 'unexpected jobDetail response' };
  const text = htmlToText(job.description);
  return text ? { status: 'ok', text } : { status: 'error', message: 'empty description' };
}

const FETCHERS = {
  workday: { configKey: 'workday', fetch: fetchWorkday, apiPath: (c) => `/wday/cxs/${c.tenant}/${c.site}/` },
  oracle: { configKey: 'oracle', fetch: fetchOracle, apiPath: () => '/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails' },
  eightfold: { configKey: 'eightfold', fetch: fetchEightfold, apiPath: (c) => (c.api === 'pcsx' ? '/api/pcsx/position_details' : '/api/apply/v2/jobs/') },
  phenom: { configKey: 'phenom', fetch: fetchPhenom, apiPath: () => '/widgets' },
};

export function supportsDetailFetch(atsType) {
  return Object.prototype.hasOwnProperty.call(FETCHERS, atsType);
}

const robotsCache = new Map();

async function robotsAllows(host, apiPath) {
  if (!robotsCache.has(host)) {
    const res = await client.get(`https://${host}/robots.txt`, { headers: { Accept: 'text/plain' } });
    robotsCache.set(host, res.status === 200 && typeof res.data === 'string' ? res.data : null);
  }
  const robotsTxt = robotsCache.get(host);
  // No robots.txt (or unreachable): fail open, same as BaseScraper.
  return robotsTxt ? isPathAllowed(robotsTxt, apiPath) : { allowed: true };
}

// One role. Never throws: returns { status: 'ok' | 'gone' | 'error' | 'skipped', text?, message? }.
export async function fetchDescription(role, employer) {
  const fetcher = FETCHERS[employer.ats_type];
  if (!fetcher) return { status: 'skipped', message: `no detail fetcher for ${employer.ats_type}` };
  const config = employer[fetcher.configKey];
  if (!config) return { status: 'skipped', message: `employer has no ${fetcher.configKey} config block` };
  try {
    const host = employer.ats_type === 'workday'
      ? `${config.tenant}.${config.cluster || 'wd1'}.myworkdayjobs.com`
      : config.host;
    const robots = await robotsAllows(host, fetcher.apiPath(config));
    if (robots.allowed === false) return { status: 'skipped', message: `robots.txt: ${robots.reason}` };
    return await fetcher.fetch(role, config);
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}
