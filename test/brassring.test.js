import nock from 'nock';
import { BrassRingScraper, brassRingDate } from '../lib/scrapers/BrassRingScraper.js';

const employer = { id: 'acme', name: 'Acme', careers_url: 'https://jobs.example.com/TGnewUI/Search/Home/Home?partnerid=1&siteid=2', ats_type: 'brassring', brassring: { host: 'jobs.example.com', partner_id: 1, site_id: 2 }, crawl_delay_seconds: 0.01 };
const HOME = '<input id="CookieValue" type="hidden" value="sess123" /><input name="__RequestVerificationToken" type="hidden" value="tok456" />';
const job = (id) => ({
  Link: `https://jobs.example.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=1&siteid=2&PageType=JobDetails&jobid=${id}`,
  Questions: [
    { QuestionName: 'reqid', Value: String(id) },
    { QuestionName: 'jobtitle', Value: `Role &amp; ${id}` },
    { QuestionName: 'jobdescription', Value: 'Lead the team.' },
    { QuestionName: 'formtext23', Value: 'India' },
    { QuestionName: 'department', Value: 'Operations ' },
    { QuestionName: 'lastupdated', Value: '03-Nov-2026' },
  ],
});

afterEach(() => nock.cleanAll());

describe('BrassRingScraper', () => {
  test('opens a session, pages through MatchedJobs and maps the fields', async () => {
    nock('https://jobs.example.com').get('/robots.txt').reply(404);
    nock('https://jobs.example.com').get('/TGnewUI/Search/Home/Home').query({ partnerid: '1', siteid: '2' })
      .reply(200, HOME, { 'Set-Cookie': ['tg_session=abc; path=/'] });
    const bodies = [];
    nock('https://jobs.example.com', { reqheaders: { RFT: 'tok456', Cookie: 'tg_session=abc' } })
      .post('/TgNewUI/Search/Ajax/MatchedJobs', (b) => bodies.push(b) && b.pageNumber === 1)
      .reply(200, { JobsCount: 51, Jobs: { Job: Array.from({ length: 50 }, (_, i) => job(i)) } })
      .post('/TgNewUI/Search/Ajax/MatchedJobs', (b) => b.pageNumber === 2)
      .reply(200, { JobsCount: 51, Jobs: { Job: [job(49), job(50)] } });
    const roles = await new BrassRingScraper(employer).scrape();
    expect(bodies[0]).toMatchObject({ partnerId: '1', siteId: '2', location: 'India', encryptedSessionValue: 'sess123' });
    expect(roles).toHaveLength(51);
    expect(roles[0]).toEqual({
      externalJobId: '0', title: 'Role & 0', description: 'Lead the team.', location: 'India',
      url: job(0).Link, postedDate: '2026-11-03', jobType: null, department: 'Operations',
    });
  });

  test('fails when the search page has no session value', async () => {
    nock('https://jobs.example.com').get('/robots.txt').reply(404);
    nock('https://jobs.example.com').get('/TGnewUI/Search/Home/Home').query(true).reply(200, '<html></html>');
    await expect(new BrassRingScraper(employer).scrape()).rejects.toThrow('no session value');
  });

  test('brassRingDate converts the site date', () => {
    expect(brassRingDate('3-Nov-2026')).toBe('2026-11-03');
    expect(brassRingDate('')).toBeNull();
  });
});
