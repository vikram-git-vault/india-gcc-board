import axios from 'axios';
import { settings } from '../settings.js';


// See docs/ARCHITECTURE.md §2 and §4 — every scraper shares this base so
// robots.txt compliance, crawl delay, and UA identification are enforced
// once, not re-implemented per ATS family.
export class BaseScraper {
  constructor(employer) {
    this.employer = employer;
    this.client = axios.create({
      timeout: settings.scraping.request_timeout_seconds * 1000,
      headers: { 'User-Agent': settings.scraping.user_agent },
    });
    // After cancel() (the refresh time limit for one employer), every new
    // request and every crawl delay throws, so the scraper stops soon and
    // sends no more requests in the background.
    this.cancelled = false;
    // Role lifecycle (lib/database.js syncRoles). refresh.js sets `known`
    // (url -> { fetchedAt, lastmod, active }) before scrape(). A scraper
    // that reads the full list of ids keeps the default presence; one that
    // stops at max_pages sets complete: false, so absent roles stay active.
    this.known = new Map();
    this.presence = { type: 'ids', complete: true };
    this.goneUrls = [];
    this.fetchedUrls = [];
    this.client.interceptors.request.use((config) => {
      if (this.cancelled) throw new Error('scrape cancelled: time limit reached');
      return config;
    });
  }

  cancel() {
    this.cancelled = true;
  }

  async checkRobotsTxt(pathToCheck) {
    const target = new URL(this.employer.careers_url);
    const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
    try {
      const { data } = await this.client.get(robotsUrl);
      return isPathAllowed(data, pathToCheck || target.pathname);
    } catch (err) {
      // No robots.txt (404) or host unreachable here specifically — fail
      // open on the robots check itself; a genuinely unreachable host will
      // still fail loudly in fetchListings().
      return { allowed: true, reason: `robots.txt unavailable: ${err.message}` };
    }
  }

  async delay() {
    const ms = (this.employer.crawl_delay_seconds || settings.scraping.default_crawl_delay_seconds) * 1000;
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (this.cancelled) throw new Error('scrape cancelled: time limit reached');
  }

  async fetchListings() {
    throw new Error('fetchListings() must be implemented by subclass');
  }

  extractRoles(_raw) {
    throw new Error('extractRoles() must be implemented by subclass');
  }

  async scrape() {
    const robotsCheck = await this.checkRobotsTxt();
    if (robotsCheck.allowed === false) {
      throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    }
    const raw = await this.fetchListings();
    return this.extractRoles(raw);
  }
}

// A detail-page scraper that read no page of `attempted` (every request
// failed) has no data: an error, not "0 roles". Some pages failing is
// still a result.
export function failIfAllFailed(attempted, succeeded, lastError) {
  if (attempted === 0 || succeeded > 0 || !lastError) return;
  const err = new Error(`all ${attempted} detail pages failed (last: ${lastError.message})`);
  err.code = lastError.code;
  throw err;
}

// Google's robots.txt spec treats "*" in a rule as a wildcard matching any
// character sequence and "$" as an end-of-path anchor — plain startsWith()
// treats both as literal characters instead. Found for real against
// Deloitte USI's robots.txt: "Allow: /*/careers" is meant to cover any
// locale-prefixed careers path (/en_US/careersUSI included), but a literal
// match never fires, so the catch-all "Disallow: /" at the end of the file
// wins by default and every such path reads as blocked when it isn't.
function robotsRuleToRegex(rule) {
  const hasEndAnchor = rule.endsWith('$');
  const body = hasEndAnchor ? rule.slice(0, -1) : rule;
  // "?" is literal in robots.txt ("Disallow: /jobs?*" blocks query URLs
  // only); unescaped, it made "/job/" match too (found on jobs.experian.com).
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${hasEndAnchor ? '$' : ''}`);
}

export function isPathAllowed(robotsTxt, pathToCheck) {
  const lines = robotsTxt.split('\n').map((l) => l.trim());
  let inWildcardGroup = false;
  const disallows = [];
  const allows = [];

  for (const line of lines) {
    if (/^user-agent:\s*\*/i.test(line)) {
      inWildcardGroup = true;
      continue;
    }
    if (/^user-agent:/i.test(line)) {
      inWildcardGroup = false;
      continue;
    }
    if (!inWildcardGroup) continue;

    const disallowMatch = line.match(/^disallow:\s*(.*)$/i);
    if (disallowMatch && disallowMatch[1]) disallows.push(disallowMatch[1].trim());

    const allowMatch = line.match(/^allow:\s*(.*)$/i);
    if (allowMatch && allowMatch[1]) allows.push(allowMatch[1].trim());
  }

  const longestMatch = (rules) => rules
    .filter((rule) => robotsRuleToRegex(rule).test(pathToCheck))
    .sort((a, b) => b.length - a.length)[0];

  const matchingDisallow = longestMatch(disallows);
  if (!matchingDisallow) return { allowed: true };

  const matchingAllow = longestMatch(allows);
  if (matchingAllow && matchingAllow.length >= matchingDisallow.length) return { allowed: true };

  return { allowed: false, reason: `Disallow: ${matchingDisallow}` };
}
