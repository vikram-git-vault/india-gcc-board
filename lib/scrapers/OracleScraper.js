import { BaseScraper } from './BaseScraper.js';

// One class, N configured employers. Covers Oracle Fusion Recruiting
// Cloud's public Candidate Experience (CE) REST API — confirmed live and
// unauthenticated against DTCC and BNY (docs/ARCHITECTURE.md §4). This is
// NOT the same product as classic Oracle Taleo (taleo.net/tal.net); no
// employer in this project was verified to run genuine legacy Taleo, so
// there is no separate TaleoScraper — see ARCHITECTURE.md for the note.
export class OracleScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { oracle } = employer;
    if (!oracle || !oracle.host || !oracle.siteNumber) {
      throw new Error(`Employer "${employer.id}" is missing config.oracle.{host,siteNumber}`);
    }
    this.host = oracle.host;
    this.siteNumber = oracle.siteNumber;
    this.apiUrl = `https://${this.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
  }

  async fetchListings() {
    const pageSize = 25;
    let offset = 0;
    const requisitions = [];
    let total = Infinity;

    while (requisitions.length < total) {
      const { data } = await this.client.get(this.apiUrl, {
        params: {
          onlyData: true,
          expand: 'requisitionList',
          // Server-side location filter, not a post-hoc one: cuts DTCC's
          // ~427 global postings to ~98 India ones before we ever page
          // through them (confirmed against the live API 2026-09-13).
          finder: `findReqs;siteNumber=${this.siteNumber},location=India,limit=${pageSize},offset=${offset}`,
        },
      });

      const wrapper = data.items && data.items[0];
      const batch = (wrapper && wrapper.requisitionList) || [];
      requisitions.push(...batch);
      total = wrapper && typeof wrapper.TotalJobsCount === 'number' ? wrapper.TotalJobsCount : requisitions.length;

      if (batch.length < pageSize) break;
      offset += pageSize;
      await this.delay();
    }

    return requisitions;
  }

  extractRoles(requisitions) {
    return requisitions.map((req) => ({
      externalJobId: String(req.Id),
      title: req.Title,
      description: req.ShortDescriptionStr || '',
      location: req.PrimaryLocation || '',
      url: `https://${this.host}/hcmUI/CandidateExperience/en/sites/${this.siteNumber}/job/${req.Id}`,
      postedDate: req.PostedDate || null,
      jobType: req.WorkplaceType || null,
      department: req.Organization || null,
    }));
  }
}
