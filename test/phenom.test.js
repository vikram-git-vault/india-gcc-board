import nock from 'nock';
import { PhenomScraper, phenomSearchBody } from '../lib/scrapers/PhenomScraper.js';
import { fetchDescription } from '../lib/descriptions.js';

const phenom = { host: 'careers.example.com', lang: 'en_global', country: 'global', path: 'global/en' };
const employer = { id: 'acme', name: 'Acme', careers_url: 'https://careers.example.com/global/en', ats_type: 'phenom', phenom, crawl_delay_seconds: 0.01 };
const job = (n, extra = {}) => ({
  jobSeqNo: `ACMEGLOBALR${n}EXTERNALENGLOBAL`, jobId: `R${n}`, title: `Role ${n}`, location: 'Pune, Maharashtra, India',
  multi_location: ['Pune, Maharashtra, India'], postedDate: '2026-10-01T00:00:00.000+0000', type: 'Full time', category: 'Engineering', ...extra,
});
const page = (total, jobs) => ({ refineSearch: { status: 200, totalHits: total, data: { jobs } } });

afterEach(() => nock.cleanAll());

describe('PhenomScraper', () => {
  test('pages through the India search and maps the fields', async () => {
    nock('https://careers.example.com').get('/robots.txt').times(2).reply(200, 'User-agent: *\nDisallow: */px-widgets\nDisallow: */apply\n');
    nock('https://careers.example.com').post('/widgets', (b) => b.from === 0 && b.size === 50 && b.selected_fields.country[0] === 'India' && b.lang === 'en_global')
      .reply(200, page(52, Array.from({ length: 50 }, (_, i) => job(i))));
    nock('https://careers.example.com').post('/widgets', (b) => b.from === 50)
      .reply(200, page(52, [job(49), job(900, { multi_location: ['Warsaw, Poland', 'Bengaluru, Karnataka, India'] })]));
    const roles = await new PhenomScraper(employer).scrape();
    expect(roles).toHaveLength(51);
    expect(roles[0]).toEqual({
      externalJobId: 'ACMEGLOBALR0EXTERNALENGLOBAL', title: 'Role 0', description: '', location: 'Pune, Maharashtra, India',
      url: 'https://careers.example.com/global/en/job/R0', postedDate: '2026-10-01T00:00:00.000+0000', jobType: 'Full time', department: 'Engineering',
    });
    expect(roles[50].location).toBe('Bengaluru, Karnataka, India');
  });

  test('respects robots.txt for /widgets', async () => {
    nock('https://careers.example.com').get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /widgets\n');
    await expect(new PhenomScraper(employer).scrape()).rejects.toThrow('robots.txt');
  });

  test('needs the full phenom config', () => {
    expect(() => new PhenomScraper({ ...employer, phenom: { host: 'x' } })).toThrow('config.phenom');
    expect(phenomSearchBody(phenom, 100).from).toBe(100);
  });
});

describe('Phenom description fetch', () => {
  test('ok, gone (empty data) and a bad id', async () => {
    nock('https://careers.example.com').get('/robots.txt').reply(200, 'User-agent: *\nDisallow: */px-widgets\n');
    nock('https://careers.example.com').post('/widgets', (b) => b.ddoKey === 'jobDetail' && b.jobSeqNo === 'A1')
      .reply(200, { jobDetail: { data: { job: { description: '<h1>Summary</h1><p>Own the roadmap.</p>' } } } });
    nock('https://careers.example.com').post('/widgets', (b) => b.jobSeqNo === 'A2').reply(200, { jobDetail: { status: 200, hits: 0, totalHits: 0, data: {} } });
    nock('https://careers.example.com').post('/widgets', (b) => b.jobSeqNo === 'A3').reply(200, '<html>Please verify you are human</html>');
    nock('https://careers.example.com').post('/widgets', (b) => b.jobSeqNo === 'A4').reply(200, { jobDetail: { status: 500, data: {} } });
    expect(await fetchDescription({ external_job_id: 'A1' }, employer)).toEqual({ status: 'ok', text: 'Summary\nOwn the roadmap.' });
    expect(await fetchDescription({ external_job_id: 'A2' }, employer)).toEqual({ status: 'gone' });
    expect((await fetchDescription({ external_job_id: 'A3' }, employer)).status).toBe('error');
    expect((await fetchDescription({ external_job_id: 'A4' }, employer)).status).toBe('error');
    expect((await fetchDescription({ external_job_id: 'a/../b' }, employer)).status).toBe('error');
  });
});
