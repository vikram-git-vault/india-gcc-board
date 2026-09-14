import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './data/jobs.db';
const SYNC_PATH = path.join('data', 'artifact-sync.json');
// The db capability caps a document at 256 KiB. A single doc holding all
// roles was already at ~248 KiB (95% of the limit) with 586 roles — the
// next Phase 2c batch of employers would have broken it. Shard instead:
// ~150 roles/shard keeps each doc comfortably under the cap (~90 KiB)
// with real headroom to grow.
const ROLES_PER_SHARD = 150;

// There is no public API for a plain Node script to push data into a
// published Claude Artifact's database — that write path only exists for
// a live page-viewer (client-side `db` capability calls) or an
// interactive Claude Code session (the Artifact tool's write_db action).
// So this doesn't "publish" anything by itself: it prepares the exact
// payload an interactive session needs, in the exact shape the job
// board's frontend expects at db.doc("roles/current"). See
// docs/ARCHITECTURE.md §5.1 for the manual sync step this feeds.
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
  const shards = [];
  for (let i = 0; i < roles.length; i += ROLES_PER_SHARD) {
    shards.push(roles.slice(i, i + ROLES_PER_SHARD));
  }

  const payload = { shards, updatedAt };

  fs.mkdirSync(path.dirname(SYNC_PATH), { recursive: true });
  fs.writeFileSync(SYNC_PATH, JSON.stringify(payload));

  return { rolesWritten: roles.length, shardCount: shards.length, syncPath: SYNC_PATH };
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
