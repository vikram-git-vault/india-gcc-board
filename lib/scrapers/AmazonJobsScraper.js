import { BaseScraper } from './BaseScraper.js';

// amazon.jobs (verified 2026-10-14). The site's own search calls
// /en/search.json; normalized_country_code[]=IND filters on the server and
// each page has up to 100 jobs WITH the description and qualifications, so
// no detail request is needed. robots.txt allows /en/search.json.
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 40;
export const AMAZON_API_PATH = '/en/search.json';

export class AmazonJobsScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const cfg = employer.amazon || {};
    this.host = cfg.host || 'www.amazon.jobs';
    this.countryCode = cfg.country_code || 'IND';
    this.maxPages = cfg.max_pages || DEFAULT_MAX_PAGES;
    this.apiUrl = `https://${this.host}${AMAZON_API_PATH}`;
  }

  async scrape() {
    const robotsCheck = await this.checkRobotsTxt(AMAZON_API_PATH);
    if (robotsCheck.allowed === false) throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    return super.scrape();
  }

  async fetchPage(offset) {
    const { data } = await this.client.get(this.apiUrl, {
      params: { 'normalized_country_code[]': this.countryCode, result_limit: PAGE_SIZE, offset, sort: 'recent' },
      headers: { Accept: 'application/json' },
    });
    if (!data || !Array.isArray(data.jobs)) throw new Error('unexpected amazon.jobs response: no jobs');
    return { total: Number(data.hits) || 0, jobs: data.jobs };
  }

  async fetchListings() {
    const first = await this.fetchPage(0);
    const jobs = [...first.jobs];
    const allPages = Math.ceil(first.total / PAGE_SIZE);
    const pages = Math.min(allPages, this.maxPages);
    // Stopped at max_pages: roles not read are not closed.
    if (allPages > this.maxPages) this.presence = { type: 'ids', complete: false };
    for (let page = 1; page < pages; page += 1) {
      await this.delay();
      const { jobs: more } = await this.fetchPage(page * PAGE_SIZE);
      if (!more.length) break;
      jobs.push(...more);
    }
    const seen = new Set();
    return jobs.filter((j) => j.id_icims && !seen.has(j.id_icims) && seen.add(j.id_icims));
  }

  extractRoles(jobs) {
    return jobs.map((j) => ({
      externalJobId: String(j.id_icims),
      title: j.title,
      description: [
        j.description,
        j.basic_qualifications && `Basic qualifications:\n${j.basic_qualifications}`,
        j.preferred_qualifications && `Preferred qualifications:\n${j.preferred_qualifications}`,
      ].filter(Boolean).join('\n\n'),
      location: j.normalized_location || j.location || '',
      url: `https://${this.host}${j.job_path || `/en/jobs/${j.id_icims}`}`,
      postedDate: j.posted_date || null,
      jobType: j.job_schedule_type || null,
      department: j.job_category || null,
    }));
  }
}
