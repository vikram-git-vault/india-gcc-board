import { BaseScraper } from './BaseScraper.js';

// Eightfold career sites (verified against HSBC, portal.careers.hsbc.com,
// 2026-10-14). The public job API /api/apply/v2/jobs takes a domain and a
// location and returns 10 positions per page with title, all locations,
// department and dates, but no description; lib/descriptions.js gets the
// description of shortlisted roles from /api/apply/v2/jobs/<id>.
// The newer /api/pcsx/search answers 403 "PCSX is not enabled" here.
// robots.txt on the HSBC host allows /careers and /api/apply.
const PAGE_SIZE = 10; // the API ignores a larger num
const DEFAULT_MAX_PAGES = 60;
export const EIGHTFOLD_API_PATH = '/api/apply/v2/jobs';

export class EightfoldScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { eightfold } = employer;
    if (!eightfold || !eightfold.host || !eightfold.domain) {
      throw new Error(`Employer "${employer.id}" is missing config.eightfold.host or config.eightfold.domain`);
    }
    this.host = eightfold.host;
    this.domain = eightfold.domain;
    this.location = eightfold.location || 'India';
    this.maxPages = eightfold.max_pages || DEFAULT_MAX_PAGES;
    this.apiUrl = `https://${this.host}${EIGHTFOLD_API_PATH}`;
  }

  async scrape() {
    // The careers page and the API path can have different robots rules.
    const robotsCheck = await this.checkRobotsTxt(EIGHTFOLD_API_PATH);
    if (robotsCheck.allowed === false) {
      throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    }
    return super.scrape();
  }

  async fetchPage(start) {
    const { data } = await this.client.get(this.apiUrl, {
      params: { domain: this.domain, location: this.location, start, num: PAGE_SIZE },
      headers: { Accept: 'application/json' },
    });
    if (!data || !Array.isArray(data.positions)) throw new Error('unexpected Eightfold response: no positions');
    return { count: Number(data.count) || 0, positions: data.positions };
  }

  async fetchListings() {
    const first = await this.fetchPage(0);
    const positions = [...first.positions];
    const pages = Math.min(Math.ceil(first.count / PAGE_SIZE), this.maxPages);
    for (let page = 1; page < pages; page += 1) {
      await this.delay();
      const { positions: more } = await this.fetchPage(page * PAGE_SIZE);
      if (!more.length) break;
      positions.push(...more);
    }
    // Pages can shift while we read them; keep each position once.
    const seen = new Set();
    return positions.filter((p) => !seen.has(p.id) && seen.add(p.id));
  }

  extractRoles(positions) {
    return positions.map((p) => {
      const locations = Array.isArray(p.locations) && p.locations.length ? p.locations : [p.location].filter(Boolean);
      return {
        externalJobId: String(p.id),
        title: p.name,
        description: '',
        location: locations.join(' | '),
        url: p.canonicalPositionUrl || `https://${this.host}/careers/job/${p.id}`,
        postedDate: p.t_create ? new Date(Number(p.t_create) * 1000).toISOString() : null,
        jobType: p.type || null,
        department: p.department && p.department !== 'None' ? p.department : null,
      };
    });
  }
}
