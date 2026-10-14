import nock from 'nock';
import { EightfoldScraper } from '../lib/scrapers/EightfoldScraper.js';
import { fetchDescription } from '../lib/descriptions.js';

const employer = {
  id: 'hsbc', name: 'HSBC', careers_url: 'https://portal.example.com/careers', ats_type: 'eightfold',
  eightfold: { host: 'portal.example.com', domain: 'example.com', location: 'India' }, crawl_delay_seconds: 0.01,
};
const pos = (id, name, extra = {}) => ({
  id, name, location: 'Pune, Maharashtra, India', locations: ['Pune, Maharashtra, India', 'Hyderabad, Telangana, India'],
  department: 'Technology', t_create: 1791876293, canonicalPositionUrl: `https://portal.example.com/careers/job/${id}`, ...extra,
});

afterEach(() => nock.cleanAll());

describe('EightfoldScraper', () => {
  test('reads every page, keeps each position once, maps the fields', async () => {
    nock('https://portal.example.com').get('/robots.txt').times(2).reply(200, 'User-agent: *\nDisallow: /\nAllow: /careers\nAllow: /api/apply\n');
    nock('https://portal.example.com').get('/api/apply/v2/jobs').query({ domain: 'example.com', location: 'India', start: 0, num: 10 })
      .reply(200, { count: 12, positions: Array.from({ length: 10 }, (_, i) => pos(100 + i, `Role ${i}`)) });
    nock('https://portal.example.com').get('/api/apply/v2/jobs').query({ domain: 'example.com', location: 'India', start: 10, num: 10 })
      .reply(200, { count: 12, positions: [pos(109, 'Role 9'), pos(200, 'Director, Product', { department: 'None', locations: [] })] });
    const roles = await new EightfoldScraper(employer).scrape();
    expect(roles).toHaveLength(11);
    expect(roles[0]).toMatchObject({
      externalJobId: '100', title: 'Role 0', location: 'Pune, Maharashtra, India | Hyderabad, Telangana, India',
      url: 'https://portal.example.com/careers/job/100', department: 'Technology', postedDate: new Date(1791876293000).toISOString(),
    });
    expect(roles[10]).toMatchObject({ externalJobId: '200', location: 'Pune, Maharashtra, India', department: null });
  });

  test('stops when robots.txt disallows the API', async () => {
    nock('https://portal.example.com').get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /api/\n');
    await expect(new EightfoldScraper(employer).scrape()).rejects.toThrow('robots.txt');
  });

  test('needs host and domain', () => {
    expect(() => new EightfoldScraper({ ...employer, eightfold: { host: 'x' } })).toThrow('eightfold.domain');
  });
});

describe('Eightfold description fetch', () => {
  test('ok, gone and a bad id', async () => {
    nock('https://portal.example.com').get('/robots.txt').reply(200, 'User-agent: *\nAllow: /api/apply\n');
    nock('https://portal.example.com').get('/api/apply/v2/jobs/100').query({ domain: 'example.com' })
      .reply(200, { job_description: '<p>Lead the platform.</p><ul><li>Roadmap</li></ul>' });
    nock('https://portal.example.com').get('/api/apply/v2/jobs/101').query({ domain: 'example.com' }).reply(404, {});
    expect(await fetchDescription({ external_job_id: '100' }, employer)).toEqual({ status: 'ok', text: 'Lead the platform.\n- Roadmap' });
    expect(await fetchDescription({ external_job_id: '101' }, employer)).toEqual({ status: 'gone' });
    expect((await fetchDescription({ external_job_id: '../x' }, employer)).status).toBe('error');
  });
});
