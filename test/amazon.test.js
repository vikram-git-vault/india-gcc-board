import nock from 'nock';
import { AmazonJobsScraper } from '../lib/scrapers/AmazonJobsScraper.js';

const employer = { id: 'amazon', name: 'Amazon', careers_url: 'https://www.amazon.jobs/', ats_type: 'amazon', amazon: { host: 'www.amazon.jobs' }, crawl_delay_seconds: 0.01 };
const job = (id) => ({
  id_icims: id, title: `Role ${id}`, description: 'Own the roadmap.', basic_qualifications: '10+ years', preferred_qualifications: '',
  normalized_location: 'Bengaluru, Karnataka, IND', job_path: `/en/jobs/${id}/role`, posted_date: 'October 13, 2026', job_schedule_type: 'full-time', job_category: 'Program Management',
});

afterEach(() => nock.cleanAll());

test('pages through /en/search.json for India and keeps description and qualifications', async () => {
  nock('https://www.amazon.jobs').get('/robots.txt').times(2).reply(200, 'User-agent: *\nDisallow: /en/applicant\n');
  nock('https://www.amazon.jobs').get('/en/search.json').query((q) => q.offset === '0' && q['normalized_country_code[]'] === 'IND')
    .reply(200, { hits: 101, jobs: Array.from({ length: 100 }, (_, i) => job(String(i))) });
  nock('https://www.amazon.jobs').get('/en/search.json').query((q) => q.offset === '100').reply(200, { hits: 101, jobs: [job('99'), job('500')] });
  const roles = await new AmazonJobsScraper(employer).scrape();
  expect(roles).toHaveLength(101);
  expect(roles[0]).toEqual({
    externalJobId: '0', title: 'Role 0', description: 'Own the roadmap.\n\nBasic qualifications:\n10+ years', location: 'Bengaluru, Karnataka, IND',
    url: 'https://www.amazon.jobs/en/jobs/0/role', postedDate: 'October 13, 2026', jobType: 'full-time', department: 'Program Management',
  });
});
