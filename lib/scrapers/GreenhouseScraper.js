import { BaseScraper } from './BaseScraper.js';

// One class, N configured employers. Greenhouse's board API is public by
// design (meant for embedding a company's job board on their own site) —
// confirmed unauthenticated and working against Bridgewater's board.
export class GreenhouseScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { greenhouse } = employer;
    if (!greenhouse || !greenhouse.board) {
      throw new Error(`Employer "${employer.id}" is missing config.greenhouse.board`);
    }
    this.board = greenhouse.board;
    this.apiUrl = `https://boards-api.greenhouse.io/v1/boards/${this.board}/jobs`;
  }

  async fetchListings() {
    const { data } = await this.client.get(this.apiUrl, { params: { content: true } });
    return data.jobs || [];
  }

  extractRoles(jobs) {
    return jobs.map((job) => ({
      externalJobId: String(job.id),
      title: job.title,
      description: job.content || '',
      location: (job.location && job.location.name) || '',
      url: job.absolute_url,
      postedDate: job.updated_at || null,
      jobType: null,
      department: (job.departments && job.departments[0] && job.departments[0].name) || null,
    }));
  }
}
