import { BaseScraper } from './BaseScraper.js';

// Phenom career sites (verified 2026-10-14 against GE Aerospace, ABB,
// Danaher, Thales, Zimmer Biomet, Allianz and Fiserv). The site's own
// search page calls POST /widgets with ddoKey "refineSearch"; the country
// facet "India" filters on the server. Phenom robots.txt files disallow
// */px-widgets, */apply and */jobcart, not /widgets. The list has no full
// description; lib/descriptions.js asks /widgets with ddoKey "jobDetail".
// Each site has its own locale (lang "en_global" / country "global", or
// "en_us" / "us") and URL prefix (global/en, us/en): read them from the
// site's home page (phApp "locale" and "country") when you add an employer.
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;
export const PHENOM_API_PATH = '/widgets';

export function phenomSearchBody({ lang, country }, from, size = PAGE_SIZE) {
  return {
    lang,
    deviceType: 'desktop',
    country,
    pageName: 'search-results',
    ddoKey: 'refineSearch',
    sortBy: '',
    subsearch: '',
    from,
    jobs: true,
    counts: true,
    all_fields: ['country'],
    size,
    clearAll: false,
    jdsource: 'facets',
    isSliderEnable: false,
    pageId: 'page20',
    siteType: 'external',
    keywords: '',
    global: true,
    selected_fields: { country: ['India'] },
  };
}

export class PhenomScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { phenom } = employer;
    if (!phenom || !phenom.host || !phenom.lang || !phenom.country || !phenom.path) {
      throw new Error(`Employer "${employer.id}" is missing config.phenom host, lang, country or path`);
    }
    this.phenom = phenom;
    this.maxPages = phenom.max_pages || DEFAULT_MAX_PAGES;
    this.apiUrl = `https://${phenom.host}${PHENOM_API_PATH}`;
  }

  async scrape() {
    const robotsCheck = await this.checkRobotsTxt(PHENOM_API_PATH);
    if (robotsCheck.allowed === false) {
      throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    }
    return super.scrape();
  }

  async fetchPage(from) {
    const { data } = await this.client.post(this.apiUrl, phenomSearchBody(this.phenom, from), {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const search = data && data.refineSearch;
    if (!search || !search.data || !Array.isArray(search.data.jobs)) throw new Error('unexpected Phenom response: no refineSearch.data.jobs');
    return { total: Number(search.totalHits) || 0, jobs: search.data.jobs };
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
    return jobs.filter((j) => j.jobSeqNo && !seen.has(j.jobSeqNo) && seen.add(j.jobSeqNo));
  }

  // externalJobId is the jobSeqNo: the jobDetail request needs it. The
  // jobSeqNo includes the site locale (…EXTERNALENGLOBAL): do not change
  // an employer's phenom.lang or phenom.country after its first scrape, or
  // every role gets a new id and loses its score and your marks.
  extractRoles(jobs) {
    return jobs.map((j) => {
      const locations = Array.isArray(j.multi_location) && j.multi_location.length ? j.multi_location : [j.location].filter(Boolean);
      // A multi-country posting lists India among other countries; keep the India ones first.
      const india = locations.filter((l) => /\bIndia\b/i.test(l));
      return {
        externalJobId: j.jobSeqNo,
        title: j.title,
        description: '',
        location: (india.length ? india : locations).join(' | '),
        url: `https://${this.phenom.host}/${this.phenom.path}/job/${encodeURIComponent(j.jobId || j.reqId || '')}`,
        postedDate: j.postedDate || null,
        jobType: j.type || null,
        department: j.category || null,
      };
    });
  }
}
