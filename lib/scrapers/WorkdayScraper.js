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
  }

  async fetchListings() {
    const pageSize = 20;
    let offset = 0;
    const postings = [];
    let total = Infinity;

    while (postings.length < total) {
      const { data } = await this.client.post(this.apiUrl, {
        appliedFacets: {},
        limit: pageSize,
        offset,
        searchText: '',
      });

      const batch = data.jobPostings || [];
      postings.push(...batch);
      total = typeof data.total === 'number' ? data.total : postings.length;

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
