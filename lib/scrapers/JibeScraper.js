import { BaseScraper } from './BaseScraper.js';

// Jibe career sites (an iCIMS front end; verified 2026-10-14 against AMD
// careers.amd.com, Gallagher jobs.ajg.com and Aon jobs.aon.com). The site's
// own search calls GET /api/jobs?location=India&page=N&limit=100, which
// returns up to 100 jobs per page WITH the full description, so no detail
// request is needed. robots.txt on these hosts allows /api/jobs.
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 15;
export const JIBE_API_PATH = '/api/jobs';

export class JibeScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { jibe } = employer;
    if (!jibe || !jibe.host) throw new Error(`Employer "${employer.id}" is missing config.jibe.host`);
    this.host = jibe.host;
    this.location = jibe.location || 'India';
    this.maxPages = jibe.max_pages || DEFAULT_MAX_PAGES;
    this.apiUrl = `https://${this.host}${JIBE_API_PATH}`;
  }

  async scrape() {
    const robotsCheck = await this.checkRobotsTxt(JIBE_API_PATH);
    if (robotsCheck.allowed === false) throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    return super.scrape();
  }

  async fetchPage(page) {
    const { data } = await this.client.get(this.apiUrl, {
      params: { location: this.location, page, limit: PAGE_SIZE },
      headers: { Accept: 'application/json' },
    });
    if (!data || !Array.isArray(data.jobs)) throw new Error('unexpected Jibe response: no jobs');
    return { total: Number(data.totalCount) || 0, jobs: data.jobs.map((j) => j.data || j) };
  }

  async fetchListings() {
    const first = await this.fetchPage(1);
    const jobs = [...first.jobs];
    const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), this.maxPages);
    for (let page = 2; page <= pages; page += 1) {
      await this.delay();
      const { jobs: more } = await this.fetchPage(page);
      if (!more.length) break;
      jobs.push(...more);
    }
    const seen = new Set();
    return jobs.filter((j) => j.req_id && !seen.has(j.req_id) && seen.add(j.req_id));
  }

  extractRoles(jobs) {
    return jobs.map((j) => {
      // Some tenants split the posting into description, responsibilities
      // and qualifications; keep all three for scoring.
      const description = [j.description, j.responsibilities, j.qualifications].filter(Boolean).join('\n');
      const location = j.full_location || [j.city, j.state, j.country].filter(Boolean).join(', ') || j.location_name || '';
      return {
        externalJobId: String(j.req_id),
        title: j.title,
        description,
        location,
        url: `https://${this.host}/jobs/${encodeURIComponent(j.slug || j.req_id)}`,
        postedDate: j.posted_date || j.create_date || null,
        jobType: j.employment_type || null,
        department: Array.isArray(j.categories) && j.categories[0] ? j.categories[0].name || null : null,
      };
    });
  }
}
