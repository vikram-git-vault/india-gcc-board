import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './data/jobs.db';

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbInstance = new sqlite3.Database(DB_PATH);
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

CREATE INDEX IF NOT EXISTS idx_roles_employer ON roles(employer_id);
CREATE INDEX IF NOT EXISTS idx_roles_location ON roles(location);
CREATE INDEX IF NOT EXISTS idx_roles_posted ON roles(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_roles_active ON roles(is_active);
CREATE INDEX IF NOT EXISTS idx_role_marks_user ON role_marks(user_id);
`;

export async function initDb() {
  await new Promise((resolve, reject) => {
    getDb().exec(SCHEMA, (err) => (err ? reject(err) : resolve()));
  });
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

export async function syncRoles(employerSlug, roles) {
  const employer = await getEmployerBySlug(employerSlug);
  if (!employer) throw new Error(`Unknown employer slug: ${employerSlug}`);

  let added = 0;
  let updated = 0;
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
    ];

    if (existing) {
      await run(
        `UPDATE roles SET title=?, description=?, location=?, country=?, department=?,
           experience_level=?, job_type=?, salary_range=?, posted_date=?, deadline=?,
           job_url=?, source_updated=?, is_active=1
         WHERE id=?`,
        [...fields, existing.id]
      );
      updated += 1;
    } else {
      await run(
        `INSERT INTO roles (employer_id, external_job_id, title, description, location,
           country, department, experience_level, job_type, salary_range, posted_date,
           deadline, job_url, source_updated, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [employer.id, role.external_job_id, ...fields]
      );
      added += 1;
    }
  }

  if (seenExternalIds.length > 0) {
    const placeholders = seenExternalIds.map(() => '?').join(',');
    await run(
      `UPDATE roles SET is_active = 0
       WHERE employer_id = ? AND external_job_id NOT IN (${placeholders})`,
      [employer.id, ...seenExternalIds]
    );
  }

  await run('UPDATE employers SET last_scraped = CURRENT_TIMESTAMP WHERE id = ?', [employer.id]);
  return { added, updated };
}

export async function recordScrapeRun(summary) {
  await run(
    `INSERT INTO scrape_runs (run_id, start_time, end_time, total_sites_targeted,
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
  await upsertMeta('last_refresh', summary.end_time);
  await upsertMeta('total_active_roles', String(totalActive.c));
}

export function closeDb() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return resolve();
    dbInstance.close((err) => (err ? reject(err) : resolve()));
  });
}
