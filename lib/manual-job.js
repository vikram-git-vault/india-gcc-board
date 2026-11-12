// Jobs the owner adds by hand (the board's "Add a job" form, tools/add-job.js):
// a link, the job text, or both. A link is read with the Workday job API
// or from the schema.org JobPosting data in the page; other pages (a login,
// a page made by script) need the pasted text. The role then goes through
// the same RM scoring, career-ops and CV gate as a scraped role
// (lib/database.js addManualRole).
import axios from 'axios';
import dns from 'dns/promises';
import net from 'net';
import { load } from 'cheerio';
import { settings } from './settings.js';
import { htmlToText } from './descriptions.js';
import { classifyRole } from './targeting.js';
import { detectLevel } from './parser.js';
import { addManualRole, findRoleByUrl } from './database.js';

// Shorter pasted text is not a full job description.
export const MIN_TEXT_CHARS = 500;
const MAX_TEXT_CHARS = settings.descriptions.max_chars;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

const client = axios.create({
  timeout: settings.scraping.request_timeout_seconds * 1000,
  maxContentLength: MAX_PAGE_BYTES,
  maxRedirects: 3,
  headers: { 'User-Agent': settings.scraping.user_agent },
  validateStatus: () => true,
});

// One line, no control characters, at most max characters.
function line(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// The job text: control characters out (line breaks stay), at most max_chars.
export function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT_CHARS);
}

// An http(s) URL, or null. Returns { url } or { error }.
export function checkUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { url: null };
  let url;
  try { url = new URL(text); } catch { return { error: 'The link is not a valid URL' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { error: 'The link must start with http:// or https://' };
  if (url.username || url.password) return { error: 'The link must not hold a user name or password' };
  url.hash = '';
  return { url: url.toString() };
}

// Loopback, private, link-local and other addresses that are not on the
// internet: the server never reads them (a link cannot reach the owner's
// own network).
export function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/i, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8')
      || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true;
}

// lookup: the DNS lookup (tests give their own).
const dnsLookup = (name) => dns.lookup(name, { all: true });
// Behind an HTTP proxy (a command in the Claude Code sandbox) the proxy
// resolves the name and decides what the request can reach: a name that
// does not resolve here is not an error then. The board server has no proxy.
const viaProxy = () => Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);

async function assertPublicHost(hostname, lookup) {
  const name = hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = net.isIP(name) ? [{ address: name }] : await lookup(name);
  } catch (err) {
    if (err.code === 'ENOTFOUND' && viaProxy()) return;
    throw err;
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${hostname} is not a public internet address`);
  }
}

// GET with the host check on each redirect.
async function getPublic(url, options, lookup) {
  let next = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    const u = new URL(next);
    await assertPublicHost(u.hostname, lookup);
    const res = await client.get(next, { ...options, maxRedirects: 0 });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      next = new URL(res.headers.location, next).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

// https://<tenant>.<wdN>.myworkdayjobs.com/[en-US/]<site>/job/<path> ->
// the job API https://<host>/wday/cxs/<tenant>/<site>/job/<path>, or null.
export function workdayApiUrl(url) {
  const u = new URL(url);
  const host = u.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
  if (!host) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0])) parts.shift();
  const jobAt = parts.indexOf('job');
  if (jobAt !== 1) return null;
  return `https://${u.hostname}/wday/cxs/${host[1]}/${parts[0]}/${parts.slice(1).join('/')}`;
}

async function readWorkday(apiUrl, lookup) {
  const res = await getPublic(apiUrl, { headers: { Accept: 'application/json' } }, lookup);
  if (res.status !== 200) return { error: `Workday answered HTTP ${res.status}` };
  const info = res.data && res.data.jobPostingInfo;
  if (!info) return { error: 'Workday gave no job data' };
  const org = res.data.hiringOrganization;
  return {
    title: info.title, location: info.location, jobId: info.jobReqId,
    company: org && org.name, text: htmlToText(info.jobDescription), via: 'Workday job API',
  };
}

// The first schema.org JobPosting in the page's JSON-LD blocks, or null.
export function jobPostingFromHtml(html) {
  const $ = load(String(html || ''));
  const found = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const type = [].concat(item['@type'] || []);
        if (type.includes('JobPosting')) found.push(item);
      }
    } catch { /* not valid JSON: try the next block */ }
  });
  const job = found[0];
  if (!job) return null;
  const org = [].concat(job.hiringOrganization || [])[0];
  const place = [].concat(job.jobLocation || [])[0];
  const address = place && place.address;
  const id = job.identifier && (typeof job.identifier === 'object' ? job.identifier.value : job.identifier);
  return {
    title: job.title,
    company: typeof org === 'string' ? org : org && org.name,
    location: typeof address === 'string' ? address : address && (address.addressLocality || address.addressRegion),
    jobId: id,
    text: htmlToText(job.description),
    via: 'the job data in the page',
  };
}

// Reads a job link. Never throws: { title, company, location, jobId, text,
// via } with what it found, or { error }.
export async function readJobLink(url, { lookup = dnsLookup } = {}) {
  try {
    const api = workdayApiUrl(url);
    if (api) return await readWorkday(api, lookup);
    const res = await getPublic(url, { headers: { Accept: 'text/html' }, responseType: 'text' }, lookup);
    if (res.status !== 200) return { error: `the site answered HTTP ${res.status}` };
    const job = jobPostingFromHtml(res.data);
    return job || { error: 'the page has no job data that the board can read' };
  } catch (err) {
    return { error: err.message };
  }
}

// The owner's input, completed with what the link gives. The owner's own
// fields win over the link's. Returns { job } or { error, needText }.
export async function prepareManualJob(input, options = {}) {
  const checked = checkUrl(input.url);
  if (checked.error) return { error: checked.error };
  const url = checked.url;
  let text = cleanText(input.text);
  let fromLink = {};
  let linkError = null;
  if (url && text.length < MIN_TEXT_CHARS) {
    fromLink = await readJobLink(url, options);
    if (fromLink.error) { linkError = fromLink.error; fromLink = {}; }
    if (fromLink.text) text = cleanText(fromLink.text);
  }
  const job = {
    url,
    company: line(input.company || fromLink.company, 100),
    title: line(input.title || fromLink.title, 200),
    location: line(input.location || fromLink.location, 100),
    jobId: line(input.jobId || fromLink.jobId, 60) || null,
    text,
    via: text && fromLink.text ? fromLink.via : 'pasted text',
  };
  if (text.length < MIN_TEXT_CHARS) {
    const why = !url ? 'Paste the full job description, or give a link'
      : linkError ? `The board could not read the job from the link (${linkError}). Open the link, copy the whole job description and paste it`
        : 'The link gave too little text. Open the link, copy the whole job description and paste it';
    return { error: why, needText: true, job };
  }
  const missing = [!job.company && 'company', !job.title && 'job title'].filter(Boolean);
  if (missing.length) return { error: `Give the ${missing.join(' and ')}`, needFields: missing, job };
  return { job };
}

// Adds the job, or finds the role that has the same link. Returns
// { roleId, created, via } or { error, ... } from prepareManualJob.
export async function addManualJob(input, options = {}) {
  const checked = checkUrl(input.url);
  if (checked.url) {
    const existing = await findRoleByUrl(checked.url);
    if (existing) return { roleId: existing.id, created: false, existing };
  }
  const prepared = await prepareManualJob(input, options);
  if (prepared.error) return prepared;
  const { job } = prepared;
  const { grade, family } = classifyRole(job.title);
  const added = await addManualRole({ ...job, grade, family, level: detectLevel(job.title) });
  return { ...added, via: job.via, job };
}
