import fs from 'fs';
import os from 'os';
import path from 'path';
import nock from 'nock';
import sqlite3 from 'sqlite3';
import { parseDeadline } from '../lib/parser.js';
import { selectDetailUrls } from '../lib/scrapers/CustomScraper.js';
import { AvatureScraper } from '../lib/scrapers/AvatureScraper.js';
import { JibeScraper } from '../lib/scrapers/JibeScraper.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-'));
const db = await import('../lib/database.js');
db.useDatabasePath(path.join(dir, 'jobs.db'));
await db.initDb();

const SLUG = 'nomura'; // any employer in config/employers.json

function role(id, extra = {}) {
  return {
    external_job_id: id, title: `Role ${id}`, description: '', location: 'Mumbai', country: 'India',
    department: null, experience_level: 'entry', job_type: null, salary_range: null, posted_date: null,
    deadline: null, job_url: `https://x.example.com/job/${id}`, source_updated: new Date().toISOString(),
    grade: null, family: null, tier: 'target', tier_reason: null, ...extra,
  };
}

async function activeIds() {
  const conn = new sqlite3.Database(db.databasePath());
  const rows = await new Promise((resolve, reject) => {
    conn.all(`SELECT r.external_job_id AS id FROM roles r JOIN employers e ON e.id = r.employer_id
      WHERE e.slug = ? AND r.is_active = 1 ORDER BY 1`, [SLUG], (err, out) => (err ? reject(err) : resolve(out)));
  });
  conn.close();
  return rows.map((r) => r.id);
}
afterAll(() => db.closeDb());
afterEach(() => nock.cleanAll());

const url = (id) => `https://x.example.com/job/${id}`;

describe('syncRoles lifecycle', () => {
  test('full id list: a role not in the list closes', async () => {
    await db.syncRoles(SLUG, [role('a'), role('b')]);
    const r = await db.syncRoles(SLUG, [role('a')]);
    expect(r).toMatchObject({ added: 0, updated: 1, closed: 1 });
    expect(await activeIds()).toEqual(['a']);
  });

  test('incomplete id list (max_pages): a role not read stays active', async () => {
    await db.syncRoles(SLUG, [role('a'), role('b')]);
    const r = await db.syncRoles(SLUG, [role('a')], { presence: { type: 'ids', complete: false } });
    expect(r.closed).toBe(0);
    expect(await activeIds()).toEqual(['a', 'b']);
  });

  test('sitemap URLs: not read but on the site stays active, off the site closes, back on the site reopens', async () => {
    await db.syncRoles(SLUG, [role('a'), role('b'), role('c')]);
    let r = await db.syncRoles(SLUG, [], { presence: { type: 'urls', urls: new Set([url('a'), url('b')]), complete: true } });
    expect(r.closed).toBe(1);
    expect(await activeIds()).toEqual(['a', 'b']);
    r = await db.syncRoles(SLUG, [], { presence: { type: 'urls', urls: new Set([url('a'), url('b'), url('c')]), complete: true } });
    expect(await activeIds()).toEqual(['a', 'b', 'c']);
  });

  test('empty URL list changes nothing (a broken sitemap is not every role closed)', async () => {
    const r = await db.syncRoles(SLUG, [], { presence: { type: 'urls', urls: new Set(), complete: true } });
    expect(r.closed).toBe(0);
    expect(await activeIds()).toEqual(['a', 'b', 'c']);
  });

  test('incomplete URL list: reopens what it sees, closes nothing', async () => {
    await db.syncRoles(SLUG, [], { presence: { type: 'urls', urls: new Set([url('a')]), complete: true } });
    const r = await db.syncRoles(SLUG, [], { presence: { type: 'urls', urls: new Set([url('b')]), complete: false } });
    expect(r.closed).toBe(0);
    expect(await activeIds()).toEqual(['a', 'b']);
  });

  test('goneUrls closes that role only', async () => {
    const r = await db.syncRoles(SLUG, [], { presence: { type: 'ids', complete: false }, goneUrls: [url('a')] });
    expect(r.closed).toBe(1);
    expect(await activeIds()).toEqual(['b']);
  });

  test('a past closing date closes the role, even when the site still lists it', async () => {
    const r = await db.syncRoles(SLUG, [role('b', { deadline: '2020-01-31' }), role('d', { deadline: '2999-12-31' })],
      { presence: { type: 'ids', complete: false } });
    expect(r.closed).toBe(1);
    expect(await activeIds()).toEqual(['d']);
    expect(await db.deactivateExpiredRoles()).toBe(0);
  });

  test('getKnownUrls has stored roles and read pages; recordFetchedUrls stores pages without a role', async () => {
    await db.recordFetchedUrls(SLUG, [{ url: 'https://x.example.com/job/outside-india', lastmod: '2026-10-01' }]);
    const known = await db.getKnownUrls(SLUG);
    expect(known.get(url('d'))).toMatchObject({ active: true });
    expect(known.get(url('a'))).toMatchObject({ active: false });
    expect(known.get('https://x.example.com/job/outside-india')).toMatchObject({ active: null, lastmod: '2026-10-01' });
    expect(known.get('https://x.example.com/job/outside-india').fetchedAt).toMatch(/Z$/);
  });
});

describe('parseDeadline', () => {
  test('ISO date and date-time to YYYY-MM-DD; junk and empty to null', () => {
    expect(parseDeadline('2026-11-30')).toBe('2026-11-30');
    expect(parseDeadline('2026-11-30T23:59:59Z')).toBe('2026-11-30');
    expect(parseDeadline('not a date')).toBeNull();
    expect(parseDeadline(null)).toBeNull();
  });
});

describe('selectDetailUrls', () => {
  const ranked = ['n1', 'k-old', 'n2', 'k-new', 'n3'].map((id) => ({ loc: id, lastmod: id === 'k-new' ? '2026-10-15' : '2026-10-01' }));
  const known = new Map([
    ['k-old', { fetchedAt: '2026-10-10T00:00:00Z' }],
    ['k-new', { fetchedAt: '2026-10-10T00:00:00Z' }],
  ]);
  test('new pages first, then known pages with a newer lastmod; unchanged known pages skipped', () => {
    expect(selectDetailUrls(ranked, known, 10).map((e) => e.loc)).toEqual(['n1', 'n2', 'n3', 'k-new']);
  });
  test('the budget applies', () => {
    expect(selectDetailUrls(ranked, known, 2).map((e) => e.loc)).toEqual(['n1', 'n2']);
  });
});

describe('capped list scrapers', () => {
  test('Jibe at max_pages reports an incomplete id list', async () => {
    const s = new JibeScraper({ id: 'j', careers_url: 'https://j.example.com/', crawl_delay_seconds: 0.001, jibe: { host: 'j.example.com', max_pages: 1 } });
    nock('https://j.example.com').get('/api/jobs').query(true)
      .reply(200, { totalCount: 250, jobs: [{ data: { req_id: '1', title: 'A' } }] });
    await s.fetchListings();
    expect(s.presence).toEqual({ type: 'ids', complete: false });
  });
});

describe('AvatureScraper lifecycle', () => {
  const host = 'https://av.example.com';
  const employer = { id: 'av', careers_url: `${host}/careers`, crawl_delay_seconds: 0.001, custom: { search_url: `${host}/search`, max_detail_fetches: 3 } };
  const listing = (offset, ids, total) => `<html><body>${ids.map((id) => `
    <article class="article--result" data-total="${total}"><div class="article__header">
    <h3 class="article__header__text__title"><a class="link" href="${host}/JobDetail/${id}">T</a></h3></div></article>`).join('')}</body></html>`;
  const detail = (title) => `<html><body><h2 class="article__header__text__title">${title}</h2></body></html>`;

  test('reads new URLs, re-checks the oldest known active role, closes an expired one', async () => {
    const s = new AvatureScraper(employer);
    s.known = new Map([
      [`${host}/JobDetail/1`, { active: true, fetchedAt: '2026-10-15T00:00:00Z' }],
      [`${host}/JobDetail/90`, { active: true, fetchedAt: '2026-10-01T00:00:00Z' }],
    ]);
    nock(host)
      .get('/search').query({ jobRecordsPerPage: '10', jobOffset: '0' }).reply(200, listing(0, [1, 2, 3], 3))
      .get('/JobDetail/2').reply(200, detail('Two'))
      .get('/JobDetail/3').reply(200, detail('Three'))
      .get('/JobDetail/90').reply(200, detail(''));
    const postings = await s.fetchListings();
    expect(postings.map((p) => p.title)).toEqual(['Two', 'Three']);
    expect(s.goneUrls).toEqual([`${host}/JobDetail/90`]);
    expect(s.presence.complete).toBe(true);
    expect([...s.presence.urls]).toHaveLength(3);
    expect(s.fetchedUrls).toHaveLength(3);
  });

  test('a walk that stops early is incomplete', async () => {
    const s = new AvatureScraper({ ...employer, custom: { ...employer.custom, max_detail_fetches: 1 } });
    nock(host)
      .get('/search').query({ jobRecordsPerPage: '10', jobOffset: '0' }).reply(200, listing(0, [5], 50))
      .get('/JobDetail/5').reply(200, detail('Five'));
    await s.fetchListings();
    expect(s.presence.complete).toBe(false);
  });
});
