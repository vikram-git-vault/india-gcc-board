#!/usr/bin/env node
/**
 * refresh.js — main orchestrator for the BFSI job board.
 *
 * Pipeline: init db -> scrape employers -> parse roles -> sync to db
 *           -> write data/roles.json for the local server to serve.
 *
 * data/roles.json is read live by server.js's GET /api/roles — there is
 * no separate publish/sync step. See docs/ARCHITECTURE.md §5.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createLogger } from './lib/logger.js';

const logger = createLogger('refresh');

const EMPLOYERS_CONFIG = path.join('config', 'employers.json');
const FILTERS_CONFIG = path.join('config', 'filters.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function initDatabase() {
  const { initDb } = await import('./lib/database.js');
  logger.info('Initializing database schema');
  await initDb();
  logger.info('Database initialized');
}

async function scrapeEmployers(employers, filters) {
  const { ScraperFactory } = await import('./lib/scrapers/ScraperFactory.js');
  const { parseRoles } = await import('./lib/parser.js');
  const results = [];

  for (const employer of employers.filter((e) => e.active)) {
    const startedAt = new Date().toISOString();
    try {
      logger.info(`Scraping ${employer.name} (${employer.ats_type})`);
      const scraper = ScraperFactory.create(employer);
      const rawListings = await scraper.scrape();
      const roles = parseRoles(rawListings, employer, filters);
      results.push({ employer: employer.id, status: 'ok', count: roles.length, roles, startedAt });
      logger.info(`  -> ${roles.length} matching roles`);
    } catch (err) {
      logger.error(`Failed scraping ${employer.name}: ${err.message}`);
      results.push({ employer: employer.id, status: 'error', error: err.message, startedAt });
    }

    const delayMs = (employer.crawl_delay_seconds || 8) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return results;
}

async function syncToDatabase(runId, startTime, results) {
  const { syncRoles, recordScrapeRun } = await import('./lib/database.js');
  logger.info('Syncing scraped roles to database');

  let rolesAdded = 0;
  let rolesUpdated = 0;
  for (const result of results) {
    if (result.status === 'ok') {
      const { added, updated } = await syncRoles(result.employer, result.roles);
      rolesAdded += added;
      rolesUpdated += updated;
    }
  }

  // One aggregate scrape_runs row per run; per-employer detail lives in the
  // structured request logs (see docs/ARCHITECTURE.md §2.3/§7.2), not in the DB.
  await recordScrapeRun({
    run_id: runId,
    start_time: startTime,
    end_time: new Date().toISOString(),
    total_sites_targeted: results.length,
    sites_succeeded: results.filter((r) => r.status === 'ok').length,
    sites_failed: results.filter((r) => r.status === 'error').length,
    total_roles_found: results.reduce((sum, r) => sum + (r.count || 0), 0),
    roles_added: rolesAdded,
    roles_updated: rolesUpdated,
    errors: JSON.stringify(
      results.filter((r) => r.status === 'error').map((r) => ({ employer: r.employer, message: r.error }))
    ),
    status: 'completed',
  });
  logger.info('Sync complete');
}

async function publishRoles() {
  const { publish } = await import('./lib/publisher.js');
  const { rolesWritten, outputPath } = await publish();
  logger.info(`Wrote ${rolesWritten} active roles to ${outputPath} — served live by server.js`);
}

async function main() {
  const args = process.argv.slice(2);
  const runStart = new Date();
  const runId = `refresh_${runStart.toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  logger.info(`=== BFSI job board refresh started at ${runStart.toISOString()} (${runId}) ===`);

  if (args.includes('--init')) {
    await initDatabase();
    logger.info('Database initialization complete. Exiting (--init).');
    return;
  }

  if (args.includes('--reclassify')) {
    await initDatabase();
    const { reclassifyRoles } = await import('./lib/database.js');
    const { classifyRole } = await import('./lib/targeting.js');
    const { detectLevel } = await import('./lib/parser.js');
    const counts = await reclassifyRoles(classifyRole, detectLevel);
    logger.info(`Reclassified ${counts.total} roles: ${counts.target} target, ${counts.exception} exception, ${counts.excluded} excluded`);
    await publishRoles();
    return;
  }

  const employers = loadJson(EMPLOYERS_CONFIG).employers;
  const filters = loadJson(FILTERS_CONFIG);

  await initDatabase();
  const results = await scrapeEmployers(employers, filters);
  await syncToDatabase(runId, runStart.toISOString(), results);
  await publishRoles();

  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.filter((r) => r.status === 'error').length;
  logger.info(`=== Refresh complete: ${okCount} succeeded, ${errCount} failed ===`);
}

main().catch((err) => {
  logger.error(`Fatal error in refresh run: ${err.stack || err.message}`);
  process.exitCode = 1;
});
