import fs from 'fs';
import os from 'os';
import path from 'path';
import nock from 'nock';
import sqlite3 from 'sqlite3';
import { cvAllowed } from '../lib/tailoring.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-job-'));
const db = await import('../lib/database.js');
db.useDatabasePath(path.join(dir, 'jobs.db'));
await db.initDb();
const {
  checkUrl, isPrivateAddress, workdayApiUrl, jobPostingFromHtml, readJobLink, prepareManualJob, addManualJob, MIN_TEXT_CHARS,
} = await import('../lib/manual-job.js');

// Every host is a public address in these tests (no real DNS lookup).
const lookup = async () => [{ address: '93.184.216.34' }];
const TEXT = `About the role\n${'Lead the platform engineering teams and own the delivery roadmap. '.repeat(12)}`;

function query(sql, params = []) {
  const conn = new sqlite3.Database(db.databasePath());
  return new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => { conn.close(); return err ? reject(err) : resolve(rows); });
  });
}
const roleRow = async (id) => (await query('SELECT * FROM roles WHERE id = ?', [id]))[0];

afterAll(() => db.closeDb());
afterEach(() => nock.cleanAll());

describe('link checks', () => {
  test('checkUrl accepts http(s) only and drops the fragment', () => {
    expect(checkUrl('https://jobs.example.com/a?x=1#apply')).toEqual({ url: 'https://jobs.example.com/a?x=1' });
    expect(checkUrl('')).toEqual({ url: null });
    expect(checkUrl('file:///etc/passwd').error).toMatch(/http/);
    expect(checkUrl('javascript:alert(1)').error).toBeTruthy();
    expect(checkUrl('https://user:pw@example.com/').error).toMatch(/password/);
    expect(checkUrl('not a link').error).toMatch(/not a valid URL/);
  });

  test('isPrivateAddress: loopback, private and link-local addresses are not read', () => {
    ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']
      .forEach((ip) => expect(isPrivateAddress(ip)).toBe(true));
    ['93.184.216.34', '8.8.8.8', '2606:4700::1111'].forEach((ip) => expect(isPrivateAddress(ip)).toBe(false));
  });

  test('a link to a private address is refused', async () => {
    const out = await readJobLink('http://127.0.0.1:8080/admin');
    expect(out.error).toMatch(/not a public internet address/);
    const viaDns = await readJobLink('https://intranet.example.com/job', { lookup: async () => [{ address: '10.0.0.5' }] });
    expect(viaDns.error).toMatch(/not a public internet address/);
  });

  test('a redirect to a private address is refused', async () => {
    nock('https://jobs.example.com').get('/r').reply(302, '', { Location: 'http://169.254.169.254/latest/meta-data' });
    const out = await readJobLink('https://jobs.example.com/r', { lookup });
    expect(out.error).toMatch(/169\.254\.169\.254 is not a public internet address/);
  });
});

describe('reading a job link', () => {
  test('workdayApiUrl maps a job page to the job API, with or without a locale', () => {
    expect(workdayApiUrl('https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Pune/Director_R-123'))
      .toBe('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/job/Pune/Director_R-123');
    expect(workdayApiUrl('https://acme.wd3.myworkdayjobs.com/Careers/job/Pune/Director_R-123'))
      .toBe('https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/job/Pune/Director_R-123');
    expect(workdayApiUrl('https://acme.wd3.myworkdayjobs.com/Careers')).toBeNull();
    expect(workdayApiUrl('https://jobs.example.com/job/1')).toBeNull();
  });

  test('a Workday link: title, city, job id and text from the job API', async () => {
    nock('https://acme.wd3.myworkdayjobs.com').get('/wday/cxs/acme/Careers/job/Pune/Director_R-123')
      .reply(200, { jobPostingInfo: { title: 'Director, Engineering', location: 'Pune', jobReqId: 'R-123', jobDescription: `<p>${TEXT}</p>` }, hiringOrganization: { name: 'Acme Corp' } });
    const out = await readJobLink('https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Pune/Director_R-123', { lookup });
    expect(out).toMatchObject({ title: 'Director, Engineering', location: 'Pune', jobId: 'R-123', company: 'Acme Corp', via: 'Workday job API' });
    expect(out.text).toContain('Lead the platform engineering teams');
  });

  test('jobPostingFromHtml reads schema.org JobPosting, also inside @graph', () => {
    const page = (data) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;
    const job = { '@type': 'JobPosting', title: 'VP Technology', description: '<p>Own the <b>roadmap</b>.</p>', hiringOrganization: { name: 'Example Bank' },
      jobLocation: [{ address: { addressLocality: 'Hyderabad' } }], identifier: { value: 'JR-9' } };
    expect(jobPostingFromHtml(page(job))).toMatchObject({ title: 'VP Technology', company: 'Example Bank', location: 'Hyderabad', jobId: 'JR-9', text: 'Own the roadmap.' });
    expect(jobPostingFromHtml(page({ '@graph': [{ '@type': 'Organization' }, job] })).title).toBe('VP Technology');
    expect(jobPostingFromHtml('<html><script type="application/ld+json">{broken</script></html>')).toBeNull();
    expect(jobPostingFromHtml('<html><body>no data</body></html>')).toBeNull();
  });

  test('a page with no job data asks for the pasted text, and keeps what the owner typed', async () => {
    nock('https://www.linkedin.example').get('/jobs/view/1').reply(200, '<html><body>Sign in</body></html>');
    const out = await prepareManualJob({ url: 'https://www.linkedin.example/jobs/view/1', company: 'Acme' }, { lookup });
    expect(out.needText).toBe(true);
    expect(out.error).toMatch(/paste it/);
    expect(out.job.company).toBe('Acme');
  });

  test('pasted text needs the company and the title, and must be a full description', async () => {
    expect((await prepareManualJob({ text: 'too short' })).needText).toBe(true);
    const noFields = await prepareManualJob({ text: TEXT });
    expect(noFields.needFields).toEqual(['company', 'job title']);
    const ok = await prepareManualJob({ text: TEXT, company: ' Acme\u0007 Corp ', title: 'Director' });
    expect(ok.job).toMatchObject({ company: 'Acme Corp', title: 'Director', url: null, via: 'pasted text' });
    expect(TEXT.length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
  });

  test('with pasted text the link is not read', async () => {
    const out = await prepareManualJob({ url: 'https://jobs.example.com/never-read', text: TEXT, company: 'Acme', title: 'Director' }, { lookup });
    expect(out.job).toMatchObject({ url: 'https://jobs.example.com/never-read', via: 'pasted text' });
    expect(nock.pendingMocks()).toEqual([]);
  });
});

describe('a manual role in the database', () => {
  test('a new company gets its own employer row; the role is a target dated today', async () => {
    const added = await addManualJob({ text: TEXT, company: 'Zeta Analytics', title: 'Director of Engineering', location: 'Pune', url: 'https://zeta.example.com/jobs/42' });
    expect(added.created).toBe(true);
    const r = await roleRow(added.roleId);
    expect(r).toMatchObject({ source: 'manual', tier: 'target', is_active: 1, description_status: 'ok', location: 'Pune', job_url: 'https://zeta.example.com/jobs/42' });
    expect(r.full_description).toContain('Lead the platform');
    const [employer] = await query('SELECT slug, ats_type, active FROM employers WHERE id = ?', [r.employer_id]);
    expect(employer).toEqual({ slug: 'manual-zeta-analytics', ats_type: 'manual', active: 1 });
  });

  test('the same link again finds the role; a query or a last "/" does not matter', async () => {
    const first = await addManualJob({ text: TEXT, company: 'Zeta Analytics', title: 'VP Data', url: 'https://zeta.example.com/jobs/77' });
    const again = await addManualJob({ url: 'https://zeta.example.com/jobs/77/?utm_source=x' });
    expect(again).toMatchObject({ roleId: first.roleId, created: false });
    expect(await db.findRoleByUrl('https://zeta.example.com/jobs/7')).toBeUndefined();
  });

  test('a board employer of the same name is used, and a scrape never closes or changes the manual role', async () => {
    const added = await addManualJob({ text: TEXT, company: 'nomura', title: 'Head of Platform', jobId: 'M-1' });
    const r = await roleRow(added.roleId);
    const [nomura] = await query("SELECT id FROM employers WHERE slug = 'nomura'");
    expect(r.employer_id).toBe(nomura.id);

    const scraped = { external_job_id: 'S-1', title: 'Scraped role', description: '', location: 'Mumbai', country: 'India', department: null,
      experience_level: null, job_type: null, salary_range: null, posted_date: null, deadline: null, job_url: 'https://nomura.example.com/S-1',
      source_updated: null, grade: null, family: null, tier: 'target', tier_reason: null };
    await db.syncRoles('nomura', [scraped]);
    await db.syncRoles('nomura', [scraped], { presence: { type: 'urls', urls: new Set(['https://nomura.example.com/S-1']), complete: true } });
    await db.syncRoles('nomura', [{ ...scraped, external_job_id: 'M-1', title: 'Changed by a scrape' }]);
    expect(await roleRow(added.roleId)).toMatchObject({ is_active: 1, title: 'Head of Platform', source: 'manual' });

    // The same job id at the same employer: the role that is there.
    expect(await addManualJob({ text: TEXT, company: 'Nomura', title: 'Head of Platform', jobId: 'M-1' })).toMatchObject({ roleId: added.roleId, created: false });
  });

  test('the refresh never classifies again or fetches the description of a manual role', async () => {
    const added = await addManualJob({ text: TEXT, company: 'Zeta Analytics', title: 'Engineer', url: 'https://zeta.example.com/jobs/90' });
    await db.reclassifyRoles(() => ({ grade: null, family: null, tier: 'excluded', reason: 'test' }), () => null);
    expect((await roleRow(added.roleId)).tier).toBe('target');
    await query("UPDATE roles SET description_fetched_at = '2000-01-01' WHERE id = ?", [added.roleId]);
    const due = await db.getRolesNeedingDescription(1000);
    expect(due.map((x) => x.id)).not.toContain(added.roleId);
  });

  test('getManualRole finds only manual roles', async () => {
    const added = await addManualJob({ text: TEXT, company: 'Zeta Analytics', title: 'Director', url: 'https://zeta.example.com/jobs/91' });
    expect(await db.getManualRole(added.roleId)).toMatchObject({ id: added.roleId, is_active: 1, best_fit: null });
    const [scraped] = await query("SELECT id FROM roles WHERE source IS NULL LIMIT 1");
    expect(await db.getManualRole(scraped.id)).toBeUndefined();
  });
});

test('cvAllowed: the CV window does not apply to a manual role', () => {
  expect(cvAllowed({ age_date: '2026-10-01', source: 'manual' }, '2026-11-09')).toBe(true);
  expect(cvAllowed({ age_date: '2026-10-01', source: null }, '2026-11-09')).toBe(false);
});
