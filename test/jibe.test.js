import nock from 'nock';
import { JibeScraper } from '../lib/scrapers/JibeScraper.js';

const employer = { id: 'acme', name: 'Acme', careers_url: 'https://jobs.example.com/', ats_type: 'jibe', jibe: { host: 'jobs.example.com' }, crawl_delay_seconds: 0.01 };
const job = (id, extra = {}) => ({ data: {
  req_id: String(id), slug: String(id), title: `Role ${id}`, description: '<p>Lead.</p>', responsibilities: '<p>Own it.</p>', qualifications: '',
  city: 'Pune', state: 'Maharashtra', country: 'India', posted_date: '2026-10-01T00:00:00+0000', employment_type: 'FULL_TIME', categories: [{ name: 'Technology' }], ...extra,
} });

afterEach(() => nock.cleanAll());

describe('JibeScraper', () => {
  test('pages through /api/jobs and keeps the full description', async () => {
    nock('https://jobs.example.com').get('/robots.txt').times(2).reply(200, 'User-agent: *\nDisallow: /admin\n');
    nock('https://jobs.example.com').get('/api/jobs').query({ location: 'India', page: 1, limit: 100 })
      .reply(200, { totalCount: 101, jobs: Array.from({ length: 100 }, (_, i) => job(i)) });
    nock('https://jobs.example.com').get('/api/jobs').query({ location: 'India', page: 2, limit: 100 })
      .reply(200, { totalCount: 101, jobs: [job(99), job(500, { full_location: 'Mumbai, India', categories: [] })] });
    const roles = await new JibeScraper(employer).scrape();
    expect(roles).toHaveLength(101);
    expect(roles[0]).toEqual({
      externalJobId: '0', title: 'Role 0', description: '<p>Lead.</p>\n<p>Own it.</p>', location: 'Pune, Maharashtra, India',
      url: 'https://jobs.example.com/jobs/0', postedDate: '2026-10-01T00:00:00+0000', jobType: 'FULL_TIME', department: 'Technology',
    });
    expect(roles[100]).toMatchObject({ externalJobId: '500', location: 'Mumbai, India', department: null });
  });
  test('respects robots.txt for /api/jobs', async () => {
    nock('https://jobs.example.com').get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /api/\n');
    await expect(new JibeScraper(employer).scrape()).rejects.toThrow('robots.txt');
  });
});
