import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { settings } from './settings.js';

// settings.database.path (config/settings.json). Tests point it at a
// temporary file with useDatabasePath() before the first query.
let dbPath = settings.database.path;

export function databasePath() {
  return dbPath;
}

export function useDatabasePath(file) {
  if (dbInstance) throw new Error('useDatabasePath() must run before the first query');
  dbPath = file;
}

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    dbInstance = new sqlite3.Database(dbPath);
    // The publisher reads on its own connection while employers write in
    // parallel: wait for a lock instead of failing with SQLITE_BUSY.
    dbInstance.configure('busyTimeout', 5000);
  }
  return dbInstance;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function callback(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

// See docs/ARCHITECTURE.md §3 for the full schema rationale (dedup key,
// slug vs surrogate id, why scrape_runs is one row per run not per employer).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS employers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL,
  careers_url TEXT NOT NULL,
  ats_type TEXT,
  robots_txt_compliant BOOLEAN DEFAULT 1,
  crawl_delay_seconds INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT 1,
  last_scraped TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  external_job_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  country TEXT DEFAULT 'India',
  department TEXT,
  experience_level TEXT,
  job_type TEXT,
  salary_range TEXT,
  posted_date DATE,
  deadline DATE,
  job_url TEXT NOT NULL,
  source_updated TIMESTAMP,
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  UNIQUE(employer_id, external_job_id)
);

CREATE TABLE IF NOT EXISTS role_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  user_id TEXT,
  status TEXT,
  marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, user_id, status)
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT UNIQUE,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  total_sites_targeted INTEGER,
  sites_succeeded INTEGER,
  sites_failed INTEGER,
  total_roles_found INTEGER,
  roles_added INTEGER,
  roles_updated INTEGER,
  errors TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One row per scored role: ATS and fit scores for both resume variants
-- (config/scoring-rubric.md). Written by score.js --import.
CREATE TABLE IF NOT EXISTS role_scores (
  role_id INTEGER PRIMARY KEY REFERENCES roles(id),
  po_ats INTEGER NOT NULL,
  po_fit INTEGER NOT NULL,
  em_ats INTEGER NOT NULL,
  em_fit INTEGER NOT NULL,
  recommended TEXT NOT NULL,
  ats_score INTEGER NOT NULL,
  fit_score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  matched_keywords TEXT NOT NULL,
  gaps TEXT NOT NULL,
  confidence TEXT NOT NULL,
  scorer TEXT NOT NULL,
  rubric_version INTEGER NOT NULL,
  description_hash TEXT NOT NULL,
  scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Every detail page a sitemap or Avature scraper read, with or without a
-- role in it (a role outside India is read once, not each run). The
-- scraper reads a page again only when its sitemap lastmod is newer.
CREATE TABLE IF NOT EXISTS source_urls (
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  url TEXT NOT NULL,
  lastmod TEXT,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employer_id, url)
);

CREATE INDEX IF NOT EXISTS idx_roles_employer ON roles(employer_id);
CREATE INDEX IF NOT EXISTS idx_roles_location ON roles(location);
CREATE INDEX IF NOT EXISTS idx_roles_posted ON roles(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_roles_active ON roles(is_active);
CREATE INDEX IF NOT EXISTS idx_role_marks_user ON role_marks(user_id);
`;

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Columns added after the first schema shipped. CREATE TABLE IF NOT EXISTS
// does not add columns to an existing table, so add any that are missing.
const ROLE_COLUMN_MIGRATIONS = [
  ['grade', 'TEXT'],
  ['family', 'TEXT'],
  ['tier', 'TEXT'],
  ['tier_reason', 'TEXT'],
  // Full job description from the ATS detail API (lib/descriptions.js).
  // syncRoles never writes these, so a re-scrape does not erase them.
  ['full_description', 'TEXT'],
  ['description_status', 'TEXT'],
  ['description_error', 'TEXT'],
  ['description_fetched_at', 'TIMESTAMP'],
];

async function migrateRoles() {
  const existing = new Set((await all('PRAGMA table_info(roles)')).map((c) => c.name));
  for (const [name, type] of ROLE_COLUMN_MIGRATIONS) {
    if (!existing.has(name)) await run(`ALTER TABLE roles ADD COLUMN ${name} ${type}`);
  }
  await run('CREATE INDEX IF NOT EXISTS idx_roles_tier ON roles(tier)');
}

export async function initDb() {
  await new Promise((resolve, reject) => {
    getDb().exec(SCHEMA, (err) => (err ? reject(err) : resolve()));
  });
  await migrateRoles();
  await seedEmployers();
  await seedMeta();
}

async function seedEmployers() {
  const configUrl = new URL('../config/employers.json', import.meta.url);
  const { employers } = JSON.parse(fs.readFileSync(configUrl, 'utf-8'));
  for (const e of employers) {
    await run(
      `INSERT INTO employers (slug, name, domain, careers_url, ats_type, crawl_delay_seconds, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         name=excluded.name, domain=excluded.domain, careers_url=excluded.careers_url,
         ats_type=excluded.ats_type, crawl_delay_seconds=excluded.crawl_delay_seconds,
         active=excluded.active`,
      [e.id, e.name, e.domain, e.careers_url, e.ats_type, e.crawl_delay_seconds, e.active ? 1 : 0]
    );
  }
}

async function seedMeta() {
  const defaults = { total_employers: '34', data_version: '1.0', total_active_roles: '0' };
  for (const [key, value] of Object.entries(defaults)) {
    await run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }
}

export async function getEmployerBySlug(slug) {
  return get('SELECT * FROM employers WHERE slug = ?', [slug]);
}

// The role id (external_job_id, one per employer) is the key. A role
// becomes inactive only when:
//   - its closing date (deadline) is in the past;
//   - its id is no longer on the site: the scraper read the full list of
//     ids (presence 'ids', complete) or of job URLs (presence 'urls',
//     complete, from a sitemap), and the role is not in it;
//   - the scraper read its page and the site says it is closed (goneUrls).
// A role that a run did not read is not closed: a sitemap scraper reads
// only some detail pages per run. A known role whose URL is on the site
// again becomes active again.
export async function syncRoles(employerSlug, roles, { presence = { type: 'ids', complete: true }, goneUrls = [] } = {}) {
  const employer = await getEmployerBySlug(employerSlug);
  if (!employer) throw new Error(`Unknown employer slug: ${employerSlug}`);

  let added = 0;
  let updated = 0;
  let closed = 0;
  const seenExternalIds = [];

  for (const role of roles) {
    seenExternalIds.push(role.external_job_id);
    const existing = await get(
      'SELECT id FROM roles WHERE employer_id = ? AND external_job_id = ?',
      [employer.id, role.external_job_id]
    );

    const fields = [
      role.title, role.description, role.location, role.country, role.department,
      role.experience_level, role.job_type, role.salary_range, role.posted_date,
      role.deadline, role.job_url, role.source_updated,
      role.grade, role.family, role.tier, role.tier_reason,
    ];

    if (existing) {
      await run(
        `UPDATE roles SET title=?, description=?, location=?, country=?, department=?,
           experience_level=?, job_type=?, salary_range=?, posted_date=?, deadline=?,
           job_url=?, source_updated=?, grade=?, family=?, tier=?, tier_reason=?, is_active=1
         WHERE id=?`,
        [...fields, existing.id]
      );
      updated += 1;
    } else {
      await run(
        `INSERT INTO roles (employer_id, external_job_id, title, description, location,
           country, department, experience_level, job_type, salary_range, posted_date,
           deadline, job_url, source_updated, grade, family, tier, tier_reason, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [employer.id, role.external_job_id, ...fields]
      );
      added += 1;
    }
  }

  if (presence.type === 'ids' && presence.complete && seenExternalIds.length > 0) {
    const placeholders = seenExternalIds.map(() => '?').join(',');
    const result = await run(
      `UPDATE roles SET is_active = 0
       WHERE employer_id = ? AND is_active = 1 AND external_job_id NOT IN (${placeholders})`,
      [employer.id, ...seenExternalIds]
    );
    closed += result.changes;
  }

  // An empty URL list means the sitemap or the URL pattern broke, not that
  // every role closed: change nothing then.
  if (presence.type === 'urls' && presence.urls && presence.urls.size > 0) {
    const stored = await all('SELECT id, job_url, is_active FROM roles WHERE employer_id = ?', [employer.id]);
    const onSite = stored.filter((r) => presence.urls.has(r.job_url));
    const reopen = onSite.filter((r) => !r.is_active).map((r) => r.id);
    const close = presence.complete ? stored.filter((r) => r.is_active && !presence.urls.has(r.job_url)).map((r) => r.id) : [];
    await setActive(reopen, 1);
    closed += await setActive(close, 0);
  }

  if (goneUrls.length > 0) {
    const placeholders = goneUrls.map(() => '?').join(',');
    const result = await run(
      `UPDATE roles SET is_active = 0 WHERE employer_id = ? AND is_active = 1 AND job_url IN (${placeholders})`,
      [employer.id, ...goneUrls]
    );
    closed += result.changes;
  }

  // Last, so no step above can make a role with a past closing date active.
  closed += await deactivateExpiredRoles(employer.id);

  await run('UPDATE employers SET last_scraped = CURRENT_TIMESTAMP WHERE id = ?', [employer.id]);
  return { added, updated, closed };
}

async function setActive(ids, value) {
  let changes = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const result = await run(
      `UPDATE roles SET is_active = ? WHERE id IN (${chunk.map(() => '?').join(',')})`,
      [value, ...chunk]
    );
    changes += result.changes;
  }
  return changes;
}

// Roles whose closing date is before today (UTC). All employers when
// employerId is not given, so an employer whose scrape failed is included.
export async function deactivateExpiredRoles(employerId) {
  const result = await run(
    `UPDATE roles SET is_active = 0
     WHERE is_active = 1 AND deadline IS NOT NULL AND deadline < date('now')
       ${employerId ? 'AND employer_id = ?' : ''}`,
    employerId ? [employerId] : []
  );
  return result.changes;
}

// SQLite CURRENT_TIMESTAMP ("2026-10-16 02:42:33") is UTC without a zone.
function toIso(timestamp) {
  if (!timestamp) return null;
  const text = String(timestamp);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
}

// Every URL an employer's scraper read before: stored roles and the pages
// in source_urls. url -> { fetchedAt, lastmod, active } (active is null
// for a page with no stored role).
export async function getKnownUrls(employerSlug) {
  const employer = await getEmployerBySlug(employerSlug);
  const known = new Map();
  if (!employer) return known;
  const pages = await all('SELECT url, lastmod, fetched_at FROM source_urls WHERE employer_id = ?', [employer.id]);
  pages.forEach((p) => known.set(p.url, { fetchedAt: toIso(p.fetched_at), lastmod: p.lastmod, active: null }));
  const roles = await all('SELECT job_url, is_active, source_updated, scraped_at FROM roles WHERE employer_id = ?', [employer.id]);
  roles.forEach((r) => {
    const page = known.get(r.job_url);
    const roleTime = toIso(r.source_updated || r.scraped_at);
    const fetchedAt = page && page.fetchedAt && page.fetchedAt > roleTime ? page.fetchedAt : roleTime;
    known.set(r.job_url, { fetchedAt, lastmod: page ? page.lastmod : null, active: !!r.is_active });
  });
  return known;
}

// entries: [{ url, lastmod }] that the scraper read in this run.
export async function recordFetchedUrls(employerSlug, entries) {
  if (!entries || entries.length === 0) return;
  const employer = await getEmployerBySlug(employerSlug);
  if (!employer) return;
  for (const e of entries) {
    await run(
      `INSERT INTO source_urls (employer_id, url, lastmod, fetched_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(employer_id, url) DO UPDATE SET lastmod=excluded.lastmod, fetched_at=CURRENT_TIMESTAMP`,
      [employer.id, e.url, e.lastmod || null]
    );
  }
}

// Re-applies config/targets.json (and the title-only level) to every stored
// role, so a rule change takes effect without a new scrape.
export async function reclassifyRoles(classify, detectLevel, nonItReason = () => null) {
  const rows = await all(`SELECT r.id, r.title, e.slug AS employer, COALESCE(r.full_description, r.description) AS description
    FROM roles r JOIN employers e ON e.id = r.employer_id`);
  const counts = { target: 0, exception: 0, excluded: 0 };
  await run('BEGIN');
  try {
    for (const row of rows) {
      let { grade, family, tier, reason } = classify(row.title, undefined, row.employer);
      if (tier !== 'excluded') {
        const nonIt = nonItReason(row.description);
        if (nonIt) { tier = 'excluded'; family = null; reason = nonIt; }
      }
      await run(
        'UPDATE roles SET grade=?, family=?, tier=?, tier_reason=?, experience_level=? WHERE id=?',
        [grade, family, tier, reason, detectLevel(row.title), row.id]
      );
      counts[tier] += 1;
    }
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
  return { total: rows.length, ...counts };
}

// Shortlisted roles that need a (re)fetch of their description:
//   - never fetched and the scraped text is too short to score;
//   - fetched 'ok' more than refetch_ok_days ago (a live posting can be edited);
//   - 'error' more than retry_error_hours ago (back off, retry about once a day);
//   - 'skipped' more than retry_skipped_days ago (config or robots.txt may change);
//   - 'gone' but reactivated by a later scrape (is_active is 1 again).
// The ages come from settings.descriptions (config/settings.json).
export async function getRolesNeedingDescription(minChars) {
  const d = settings.descriptions;
  return all(
    `SELECT r.id, r.external_job_id, r.job_url, r.title, e.slug AS employer_slug, e.ats_type
     FROM roles r JOIN employers e ON e.id = r.employer_id
     WHERE r.is_active = 1
       AND r.tier IN ('target', 'exception')
       AND (
         (r.description_status IS NULL AND LENGTH(COALESCE(r.description, '')) < ?)
         OR (r.description_status = 'ok' AND r.description_fetched_at < datetime('now', ?))
         OR (r.description_status = 'error' AND r.description_fetched_at < datetime('now', ?))
         OR (r.description_status = 'skipped' AND r.description_fetched_at < datetime('now', ?))
         OR r.description_status = 'gone'
       )
     ORDER BY e.slug, r.id`,
    [minChars, `-${d.refetch_ok_days} days`, `-${d.retry_error_hours} hours`, `-${d.retry_skipped_days} days`]
  );
}

export async function saveDescriptionResult(roleId, result) {
  if (result.status === 'ok') {
    await run(
      `UPDATE roles SET full_description=?, description_status='ok', description_error=NULL,
         description_fetched_at=CURRENT_TIMESTAMP WHERE id=?`,
      [result.text, roleId]
    );
  } else if (result.status === 'gone') {
    // The ATS says the posting is closed: take it off the board now rather
    // than waiting for the next full scrape.
    await run(
      `UPDATE roles SET description_status='gone', description_error=NULL,
         description_fetched_at=CURRENT_TIMESTAMP, is_active=0 WHERE id=?`,
      [roleId]
    );
  } else {
    await run(
      `UPDATE roles SET description_status=?, description_error=?,
         description_fetched_at=CURRENT_TIMESTAMP WHERE id=?`,
      [result.status, result.message || null, roleId]
    );
  }
}

// Shortlisted, active roles with the text a scorer needs, plus the hash and
// rubric version of any existing score so the caller can tell what is stale.
export async function getRolesForScoring() {
  return all(
    `SELECT r.id, e.name AS employer, r.title, r.grade, r.family, r.tier, r.location,
            COALESCE(r.full_description, r.description, '') AS description,
            s.description_hash AS scored_hash, s.rubric_version AS scored_rubric_version
     FROM roles r
     JOIN employers e ON e.id = r.employer_id
     LEFT JOIN role_scores s ON s.role_id = r.id
     WHERE r.is_active = 1 AND r.tier IN ('target', 'exception')
     ORDER BY r.id`
  );
}

export async function upsertScore(score, { scorer, rubricVersion, descriptionHash }) {
  await run(
    `INSERT INTO role_scores (role_id, po_ats, po_fit, em_ats, em_fit, recommended, ats_score,
       fit_score, reason, matched_keywords, gaps, confidence, scorer, rubric_version,
       description_hash, scored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(role_id) DO UPDATE SET
       po_ats=excluded.po_ats, po_fit=excluded.po_fit, em_ats=excluded.em_ats,
       em_fit=excluded.em_fit, recommended=excluded.recommended, ats_score=excluded.ats_score,
       fit_score=excluded.fit_score, reason=excluded.reason,
       matched_keywords=excluded.matched_keywords, gaps=excluded.gaps,
       confidence=excluded.confidence, scorer=excluded.scorer,
       rubric_version=excluded.rubric_version, description_hash=excluded.description_hash,
       scored_at=CURRENT_TIMESTAMP`,
    [score.role_id, score.po_ats, score.po_fit, score.em_ats, score.em_fit, score.recommended,
      score.ats_score, score.fit_score, score.reason, JSON.stringify(score.matched_keywords),
      JSON.stringify(score.gaps), score.confidence, scorer, rubricVersion, descriptionHash]
  );
}

// A resumed run can record the same run_id again: replace the row.
// updateLastRefresh is false for --only runs, which are not complete runs.
export async function recordScrapeRun(summary, { updateLastRefresh = true } = {}) {
  await run(
    `INSERT OR REPLACE INTO scrape_runs (run_id, start_time, end_time, total_sites_targeted,
       sites_succeeded, sites_failed, total_roles_found, roles_added, roles_updated,
       errors, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [summary.run_id, summary.start_time, summary.end_time, summary.total_sites_targeted,
      summary.sites_succeeded, summary.sites_failed, summary.total_roles_found,
      summary.roles_added, summary.roles_updated, summary.errors, summary.status]
  );

  const totalActive = await get('SELECT COUNT(*) as c FROM roles WHERE is_active = 1');
  const upsertMeta = async (key, value) => run(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`,
    [key, value]
  );
  if (updateLastRefresh) await upsertMeta('last_refresh', summary.end_time);
  await upsertMeta('total_active_roles', String(totalActive.c));
}

export function closeDb() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return resolve();
    dbInstance.close((err) => (err ? reject(err) : resolve()));
  });
}
