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

  const roles = await all(db, `
    SELECT r.id, e.name as employer, e.ats_type, r.title, r.location, r.department,
           r.experience_level, r.job_type, r.posted_date, r.job_url
    FROM roles r JOIN employers e ON e.id = r.employer_id
    WHERE r.is_active = 1
    ORDER BY r.posted_date DESC
  `);
  const metaRow = await get(db, "SELECT value FROM meta WHERE key = 'last_refresh'");
  db.close();

  const updatedAt = (metaRow && metaRow.value) || new Date().toISOString();

  const employersConfig = JSON.parse(fs.readFileSync(EMPLOYERS_PATH, 'utf-8'));
  const totalTracked = employersConfig.employers.length + employersConfig.excluded.length;
  const fetchedCount = employersConfig.employers.filter((e) => e.active).length;
  const coverage = { totalTracked, fetchedCount, manualCount: totalTracked - fetchedCount };

  const payload = { roles, meta: { last_refresh: updatedAt }, coverage };

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
