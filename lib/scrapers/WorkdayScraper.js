import { BaseScraper } from './BaseScraper.js';

// One class, N configured employers (docs/ARCHITECTURE.md §4). Every
// Workday-based employer is scraped through this same class; what differs
// is the `workday` block in config/employers.json (tenant/cluster/site),
// not code. Uses Workday's public CXS JSON search API rather than HTML
// scraping — it's the mechanism Workday's own career-site frontend uses,
// supports pagination cleanly, and avoids fragile HTML selectors.
export class WorkdayScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { workday } = employer;
    if (!workday || !workday.tenant || !workday.site) {
      throw new Error(`Employer "${employer.id}" is missing config.workday.{tenant,site}`);
    }
    this.tenant = workday.tenant;
    this.site = workday.site;
    this.cluster = workday.cluster || 'wd1';
    this.host = `${this.tenant}.${this.cluster}.myworkdayjobs.com`;
    this.apiUrl = `https://${this.host}/wday/cxs/${this.tenant}/${this.site}/jobs`;
    // Default to a server-side "India" text search rather than paginating
    // every global posting (confirmed against Bank of America: 2000 global
    // -> 20 candidates). Site-specific facet UUIDs aren't stable across
    // tenants, so plain-text search is the portable filter; set
    // workday.search_text: "" for a career site already scoped to India
    // (e.g. LPL's India_Ext) where the extra term would be redundant.
    this.searchText = workday.search_text !== undefined ? workday.search_text : 'India';
    // workday.applied_facets: the site's own facet filter, for a global site
    // where the "India" text also matches US places (Walmart: Indiana, Indio).
    // Example: { "locationCountry": ["<India facet id>"] } with search_text "".
    this.appliedFacets = workday.applied_facets || {};
  }

  async fetchListings() {
    const pageSize = 20;
    let offset = 0;
    const postings = [];
    let total = Infinity;

    while (postings.length < total) {
      const { data } = await this.client.post(this.apiUrl, {
        appliedFacets: this.appliedFacets,
        limit: pageSize,
        offset,
        searchText: this.searchText,
      });

      const batch = data.jobPostings || [];
      postings.push(...batch);
      // Workday gives the total only on the first page; later pages say
      // total: 0 (checked 2026-11-03 on Vanguard: 87, then 0, 0, 0). Using
      // that 0 stopped every Workday employer at 40 roles, and the role
      // lifecycle then closed the roles after the first 40.
      if (offset === 0) total = typeof data.total === 'number' && data.total > 0 ? data.total : Infinity;

      if (batch.length < pageSize) break;
      offset += pageSize;
      await this.delay();
    }

    return postings;
  }

  extractRoles(postings) {
    return postings.map((posting) => {
      const externalPath = posting.externalPath || '';
      const idMatch = externalPath.match(/([A-Za-z]*-?\d[\d-]*)$/);
      const jobTypeField = (posting.bulletFields || [])
        .find((f) => /full.?time|part.?time|contract|intern/i.test(f));

      return {
        externalJobId: idMatch ? idMatch[1] : externalPath,
        title: posting.title,
        description: '',
        location: posting.locationsText || '',
        url: `https://${this.host}/${this.site}${externalPath}`,
        postedDate: posting.postedOn || null,
        jobType: jobTypeField || null,
        department: null,
      };
    });
  }
}
