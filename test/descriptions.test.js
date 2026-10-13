import nock from 'nock';
import { htmlToText, fetchDescription, supportsDetailFetch } from '../lib/descriptions.js';

const workdayEmployer = {
  id: 'wells-fargo', ats_type: 'workday', crawl_delay_seconds: 0,
  workday: { tenant: 'wf', cluster: 'wd1', site: 'WellsFargoJobs' },
};
const oracleEmployer = {
  id: 'bny', ats_type: 'oracle', crawl_delay_seconds: 0,
  oracle: { host: 'eofe.fa.us2.oraclecloud.com', siteNumber: 'BNY-Careers' },
};
const WD = 'https://wf.wd1.myworkdayjobs.com';
const OR = 'https://eofe.fa.us2.oraclecloud.com';

beforeAll(() => nock.disableNetConnect());
afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

describe('htmlToText', () => {
  test('keeps paragraph and list breaks', () => {
    const text = htmlToText('<p>About the role</p><ul><li>Lead teams</li><li>Own <b>roadmap</b></li></ul>');
    expect(text).toBe('About the role\n- Lead teams\n- Own roadmap');
  });
  test('empty input gives empty string', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('fetchDescription: workday', () => {
  const role = { job_url: `${WD}/WellsFargoJobs/job/Bengaluru-India/Manager_R-1` };

  test('200 returns text from jobPostingInfo.jobDescription', async () => {
    nock(WD).get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /WellsFargoJobsTargeted/\n');
    nock(WD).get('/wday/cxs/wf/WellsFargoJobs/job/Bengaluru-India/Manager_R-1')
      .reply(200, { jobPostingInfo: { jobDescription: '<p>Lead the platform.</p>' } });
    await expect(fetchDescription(role, workdayEmployer)).resolves.toEqual({ status: 'ok', text: 'Lead the platform.' });
  });

  test('403 means the posting is closed', async () => {
    nock(WD).get('/robots.txt').reply(404);
    nock(WD).get(/\/wday\/cxs\/.*/).reply(403, { errorCode: 'S22', message: 'permission denied' });
    await expect(fetchDescription(role, workdayEmployer)).resolves.toEqual({ status: 'gone' });
  });

  test('500 is an error, not gone', async () => {
    nock(WD).get('/robots.txt').reply(404);
    nock(WD).get(/\/wday\/cxs\/.*/).reply(500);
    const result = await fetchDescription(role, workdayEmployer);
    expect(result.status).toBe('error');
  });

  test('a job_url from another site is an error, never a request', async () => {
    const result = await fetchDescription({ job_url: 'https://evil.example/x' }, workdayEmployer);
    expect(result.status).toBe('error');
  });
});

describe('fetchDescription: oracle', () => {
  const role = { external_job_id: '79584' };

  test('joins description, responsibilities and qualifications', async () => {
    nock(OR).get('/robots.txt').reply(404);
    nock(OR).get('/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails')
      .query((q) => q.finder === 'ById;Id="79584",siteNumber=BNY-Careers')
      .reply(200, { items: [{ ExternalDescriptionStr: '<p>Desc</p>', ExternalResponsibilitiesStr: '', ExternalQualificationsStr: '<p>Quals</p>' }] });
    await expect(fetchDescription(role, oracleEmployer)).resolves.toEqual({ status: 'ok', text: 'Desc\n\nQuals' });
  });

  test('no items means the posting is closed', async () => {
    nock(OR).get('/robots.txt').reply(404);
    nock(OR).get(/recruitingCEJobRequisitionDetails/).query(true).reply(200, { items: [] });
    await expect(fetchDescription(role, oracleEmployer)).resolves.toEqual({ status: 'gone' });
  });
});

describe('robots.txt and unsupported ATS', () => {
  test('a disallowed detail path is skipped with no detail request', async () => {
    const blocked = { ...workdayEmployer, workday: { tenant: 'blk', cluster: 'wd1', site: 'S' } };
    nock('https://blk.wd1.myworkdayjobs.com').get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /wday/\n');
    const result = await fetchDescription({ job_url: 'https://blk.wd1.myworkdayjobs.com/S/job/x' }, blocked);
    expect(result.status).toBe('skipped');
    expect(nock.isDone()).toBe(true);
  });

  test('custom ATS types are skipped', async () => {
    expect(supportsDetailFetch('custom')).toBe(false);
    const result = await fetchDescription({}, { ats_type: 'custom' });
    expect(result.status).toBe('skipped');
  });
});

describe('verifier fixes', () => {
  const role = { job_url: `${WD}/WellsFargoJobs/job/Bengaluru-India/Manager_R-2` };

  test('a 403 without errorCode S22 is an error, not gone', async () => {
    nock(WD).get(/\/wday\/cxs\/.*/).reply(403, '<html>Access denied</html>');
    const result = await fetchDescription(role, workdayEmployer);
    expect(result.status).toBe('error');
  });

  test('an employer with no config block is skipped', async () => {
    const result = await fetchDescription(role, { id: 'kpmg', ats_type: 'workday' });
    expect(result).toEqual({ status: 'skipped', message: 'employer has no workday config block' });
  });

  test('a non-numeric Oracle id is an error, never a request', async () => {
    const result = await fetchDescription({ external_job_id: '1",x' }, oracleEmployer);
    expect(result.status).toBe('error');
  });
});
