import nock from 'nock';
import { WorkdayScraper } from '../lib/scrapers/WorkdayScraper.js';

const employer = {
  id: 'acme', name: 'Acme', careers_url: 'https://acme.wd5.myworkdayjobs.com/External', ats_type: 'workday',
  workday: { tenant: 'acme', cluster: 'wd5', site: 'External' }, crawl_delay_seconds: 0.01,
};
const HOST = 'https://acme.wd5.myworkdayjobs.com';
const API = '/wday/cxs/acme/External/jobs';
const posting = (i) => ({ title: `Role ${i}`, externalPath: `/job/Hyderabad/Role-${i}_R${1000 + i}`, locationsText: 'Hyderabad, India', postedOn: 'Posted Today', bulletFields: [] });
const page = (from, count, total) => ({ total, jobPostings: Array.from({ length: count }, (_, i) => posting(from + i)) });

afterEach(() => nock.cleanAll());

describe('WorkdayScraper', () => {
  test('reads every page: Workday gives the total only on the first page', async () => {
    nock(HOST).get('/robots.txt').reply(404);
    // As on Vanguard (2026-11-03): total 47 on offset 0, then total 0.
    nock(HOST).post(API, (b) => b.offset === 0).reply(200, page(0, 20, 47));
    nock(HOST).post(API, (b) => b.offset === 20).reply(200, page(20, 20, 0));
    nock(HOST).post(API, (b) => b.offset === 40).reply(200, page(40, 7, 0));
    const roles = await new WorkdayScraper(employer).scrape();
    expect(roles).toHaveLength(47);
    expect(roles[46]).toMatchObject({ externalJobId: 'R1046', title: 'Role 46', url: `${HOST}/External/job/Hyderabad/Role-46_R1046` });
    expect(nock.isDone()).toBe(true);
  });

  test('without a total, stops at the first short page', async () => {
    nock(HOST).get('/robots.txt').reply(404);
    nock(HOST).post(API, (b) => b.offset === 0).reply(200, { jobPostings: page(0, 20).jobPostings });
    nock(HOST).post(API, (b) => b.offset === 20).reply(200, { jobPostings: page(20, 3).jobPostings });
    expect(await new WorkdayScraper(employer).scrape()).toHaveLength(23);
  });

  test('stops after the first page when it has all the roles', async () => {
    nock(HOST).get('/robots.txt').reply(404);
    nock(HOST).post(API, (b) => b.offset === 0).reply(200, page(0, 20, 20));
    expect(await new WorkdayScraper(employer).scrape()).toHaveLength(20);
    expect(nock.isDone()).toBe(true);
  });
});
