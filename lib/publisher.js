import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './data/jobs.db';
const EMPLOYERS_PATH = path.join('config', 'employers.json');
const OUTPUT_PATH = path.join('data', 'roles.json');

// This is the self-hosted server's data file — server.js serves it directly
// at GET /api/roles, no publish step required. (Earlier this wrote a
// Claude-Artifact-shaped sharded payload for manual db sync; that model is
// retired — see docs/ARCHITECTURE.md §5.)
export async function publish() {
  const db = new sqlite3.Database(DB_PATH);

  // Only target and exception roles reach the board (config/targets.json);
  // excluded roles stay in the database so a rule change needs no re-scrape.
  const roles = await all(db, `
    SELECT r.id, e.name as employer, e.ats_type, r.title, r.location, r.department,
           r.experience_level, r.job_type, r.posted_date, r.job_url,
           r.grade, r.family, r.tier
    FROM roles r JOIN employers e ON e.id = r.employer_id
    WHERE r.is_active = 1 AND r.tier IN ('target', 'exception')
    ORDER BY r.posted_date DESC
  `);
  // Same city, two spellings across employers' ATSs — one facet chip each.
  const CITY_ALIASES = { Bangalore: 'Bengaluru', Gurgaon: 'Gurugram' };
  roles.forEach((r) => { if (CITY_ALIASES[r.location]) r.location = CITY_ALIASES[r.location]; });

  const employerRow = await get(db, `
    SELECT COUNT(DISTINCT employer_id) AS n FROM roles WHERE is_active = 1
  `);
  const tierRows = await all(db, `
    SELECT COALESCE(tier, 'unclassified') AS tier, COUNT(*) AS n
    FROM roles WHERE is_active = 1 GROUP BY 1
  `);
  const metaRow = await get(db, "SELECT value FROM meta WHERE key = 'last_refresh'");
  db.close();

  const updatedAt = (metaRow && metaRow.value) || new Date().toISOString();

  const employersConfig = JSON.parse(fs.readFileSync(EMPLOYERS_PATH, 'utf-8'));
  const totalTracked = employersConfig.employers.length + employersConfig.excluded.length;
  const fetchedCount = employersConfig.employers.filter((e) => e.active).length;
  const coverage = {
    totalTracked, fetchedCount, manualCount: totalTracked - fetchedCount, withRoles: employerRow.n,
  };

  const targeting = { target: 0, exception: 0, excluded: 0, unclassified: 0 };
  tierRows.forEach((row) => { targeting[row.tier] = row.n; });
  targeting.scanned = tierRows.reduce((sum, row) => sum + row.n, 0);

  const payload = { roles, meta: { last_refresh: updatedAt }, coverage, targeting };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload));

  return { rolesWritten: roles.length, outputPath: OUTPUT_PATH };
}

function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function get(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
