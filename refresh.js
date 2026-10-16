#!/usr/bin/env node
/**
 * refresh.js — main orchestrator for the BFSI job board.
 *
 * Pipeline: init db -> for each employer: scrape, parse, save to db,
 *           write data/roles.json -> descriptions -> classify -> publish.
 *           (--only=id1,id2 limits the scrape to those employers)
 *           --resume continues an unfinished run (lib/checkpoint.js):
 *           employers already saved in that run are skipped.
 *           --pause-on-sleep stops the run (exit code 75) when the Mac
 *           is on battery with the lid closed (lib/power.js).
 *
 * data/roles.json is read live by server.js's GET /api/roles — there is
 * no separate publish/sync step. See docs/ARCHITECTURE.md §5.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createLogger } from './lib/logger.js';
import { reportProgress } from './lib/progress.js';
import {
  newCheckpoint, loadCheckpoint, saveCheckpoint, resumableCheckpoint, recordEmployer, pendingEmployers,
} from './lib/checkpoint.js';
import { checkSleepRisk, createSleepWatch, PAUSED_EXIT_CODE } from './lib/power.js';

const logger = createLogger('refresh');

const EMPLOYERS_CONFIG = path.join('config', 'employers.json');
const FILTERS_CONFIG = path.join('config', 'filters.json');
// Time limit for one employer. After it, the employer counts as failed and
// the refresh goes on with the next one (the next run tries it again).
const limitMinutes = Number(process.env.EMPLOYER_TIME_LIMIT_MINUTES);
const EMPLOYER_TIME_LIMIT_MS = (limitMinutes > 0 ? limitMinutes : 20) * 60 * 1000;

async function scrapeWithTimeLimit(scraper, employer) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      scraper.cancel();
      reject(new Error(`time limit of ${EMPLOYER_TIME_LIMIT_MS / 60000} min reached for ${employer.name}`));
    }, EMPLOYER_TIME_LIMIT_MS);
  });
  try {
    return await Promise.race([scraper.scrape(), limit]);
  } finally {
    clearTimeout(timer);
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function initDatabase() {
  const { initDb } = await import('./lib/database.js');
  logger.info('Initializing database schema');
  await initDb();
  logger.info('Database initialized');
}

// Each employer is saved to the database (and the board updated) as soon
// as it finishes, so an interrupted run keeps its work. `save` writes the
// checkpoint; it is a no-op for --only runs. With pauseOnSleep it returns
// { paused: true } early when the Mac can sleep (lib/power.js).
async function scrapeEmployers(employers, filters, cp, save, { pauseOnSleep = false } = {}) {
  const { ScraperFactory } = await import('./lib/scrapers/ScraperFactory.js');
  const { parseRoles } = await import('./lib/parser.js');
  const { syncRoles, getKnownUrls, recordFetchedUrls } = await import('./lib/database.js');
  const { publish } = await import('./lib/publisher.js');
  const allActive = employers.filter((e) => e.active).length;
  const pending = pendingEmployers(cp, employers);
  const offset = allActive - pending.length;

  const scrapeOne = async (employer) => {
    try {
      logger.info(`Scraping ${employer.name} (${employer.ats_type})`);
      const scraper = ScraperFactory.create(employer);
      // Sitemap and Avature scrapers skip pages they read before.
      scraper.known = await getKnownUrls(employer.id);
      const rawListings = await scrapeWithTimeLimit(scraper, employer);
      const roles = parseRoles(rawListings, employer, filters);
      const { added, updated, closed } = await syncRoles(employer.id, roles, {
        presence: scraper.presence, goneUrls: scraper.goneUrls,
      });
      await recordFetchedUrls(employer.id, scraper.fetchedUrls);
      logger.info(`  -> ${roles.length} matching roles read (${added} new, ${closed} closed), saved`);
      return { status: 'ok', count: roles.length, added, updated, closed };
    } catch (err) {
      logger.error(`Failed scraping ${employer.name}: ${err.message}`);
      return { status: 'error', error: err.message };
    }
  };

  const watch = createSleepWatch();
  try {
    for (const [index, employer] of pending.entries()) {
      // A Mac on battery with the lid closed sleeps even with caffeinate:
      // stop here, and server.js continues the run (--resume) later.
      const risk = pauseOnSleep ? await checkSleepRisk() : null;
      if (risk) {
        logger.warn(`Refresh paused before ${employer.name}: the Mac is ${risk} and can sleep; it continues when the Mac can stay awake`);
        return { paused: true };
      }
      reportProgress('scrape', { done: offset + index + 1, total: allActive, item: employer.name });
      watch.reset();
      let result = await scrapeOne(employer);
      // A failure while the computer slept is most likely a timeout, not a
      // scraper fault: try once more, unless the Mac can sleep again.
      if (result.status === 'error' && watch.slept() && !(pauseOnSleep && await checkSleepRisk())) {
        logger.warn(`The computer slept while scraping ${employer.name}; trying it again`);
        watch.reset();
        result = await scrapeOne(employer);
      }
      recordEmployer(cp, employer.id, result);
      save(cp);
      try {
        await publish();
      } catch (err) {
        logger.warn(`Could not update the board after ${employer.name}: ${err.message}`);
      }

      const delayMs = (employer.crawl_delay_seconds || 8) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } finally {
    watch.stop();
  }
  return { paused: false };
}

// One aggregate scrape_runs row per run, from the checkpoint, so a resumed
// run counts the employers saved before the interruption too.
async function recordRun(cp, options) {
  const { recordScrapeRun } = await import('./lib/database.js');
  const entries = Object.entries(cp.employers);
  const ok = entries.filter(([, e]) => e.status === 'ok');
  const failed = entries.filter(([, e]) => e.status === 'error');
  await recordScrapeRun({
    run_id: cp.run_id,
    start_time: cp.started_at,
    end_time: new Date().toISOString(),
    total_sites_targeted: entries.length,
    sites_succeeded: ok.length,
    sites_failed: failed.length,
    total_roles_found: ok.reduce((sum, [, e]) => sum + (e.count || 0), 0),
    roles_added: ok.reduce((sum, [, e]) => sum + (e.added || 0), 0),
    roles_updated: ok.reduce((sum, [, e]) => sum + (e.updated || 0), 0),
    errors: JSON.stringify(failed.map(([id, e]) => ({ employer: id, message: e.error }))),
    status: 'completed',
  }, options);
}

// Detail requests for shortlisted roles only (lib/descriptions.js), one
// employer at a time with that employer's crawl delay between requests.
async function fetchDescriptions(employers) {
  const { getRolesNeedingDescription, saveDescriptionResult } = await import('./lib/database.js');
  const { fetchDescription, MIN_FULL_DESCRIPTION_CHARS } = await import('./lib/descriptions.js');
  const bySlug = new Map(employers.map((e) => [e.id, e]));

  const roles = await getRolesNeedingDescription(MIN_FULL_DESCRIPTION_CHARS);
  logger.info(`Fetching descriptions for ${roles.length} shortlisted roles`);
  const counts = { ok: 0, gone: 0, error: 0, skipped: 0 };

  // Group by employer so a suspicious wave of closures can be held back:
  // if most of one employer's roles come back 'gone', the detail API more
  // likely changed than the roles all closed, so record an error instead.
  const groups = new Map();
  roles.forEach((role) => {
    if (!groups.has(role.employer_slug)) groups.set(role.employer_slug, []);
    groups.get(role.employer_slug).push(role);
  });

  let position = 0;
  for (const [slug, group] of groups) {
    const employer = bySlug.get(slug);
    const results = [];
    for (const role of group) {
      position += 1;
      reportProgress('descriptions', { done: position, total: roles.length, item: employer ? employer.name : slug });
      const result = employer
        ? await fetchDescription(role, employer)
        : { status: 'skipped', message: `employer ${slug} not in config` };
      results.push([role, result]);
      if (result.status !== 'skipped') {
        const delayMs = ((employer && employer.crawl_delay_seconds) || 5) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const goneCount = results.filter(([, r]) => r.status === 'gone').length;
    const suspicious = group.length >= 4 && goneCount / group.length > 0.5;
    if (suspicious) logger.warn(`  ${slug}: ${goneCount}/${group.length} roles reported closed; not deactivating, check the detail API`);
    const errorCount = results.filter(([, r]) => r.status === 'error').length;
    if (errorCount === group.length) logger.warn(`  ${slug}: every description fetch failed; check the detail API`);

    for (const [role, raw] of results) {
      const result = suspicious && raw.status === 'gone'
        ? { status: 'error', message: 'closure not trusted: most roles of this employer reported closed' }
        : raw;
      await saveDescriptionResult(role.id, result);
      counts[result.status] += 1;
      if (result.status === 'error') logger.warn(`  description error, role ${role.id} (${role.title}): ${result.message}`);
    }
  }

  logger.info(`Descriptions: ${counts.ok} fetched, ${counts.gone} closed postings, ${counts.error} errors, ${counts.skipped} skipped`);
  return counts;
}

// Title rules plus the description check (config/targets.json). Runs after
// descriptions are fetched, so the description check sees the full text.
async function reclassify() {
  const { reclassifyRoles } = await import('./lib/database.js');
  reportProgress('classify');
  const { classifyRole, nonItReason } = await import('./lib/targeting.js');
  const { detectLevel } = await import('./lib/parser.js');
  return reclassifyRoles(classifyRole, detectLevel, nonItReason);
}

async function publishRoles() {
  const { publish } = await import('./lib/publisher.js');
  reportProgress('publish');
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

  if (args.includes('--descriptions')) {
    await initDatabase();
    await fetchDescriptions(loadJson(EMPLOYERS_CONFIG).employers);
    await reclassify();
    await publishRoles();
    return;
  }

  if (args.includes('--reclassify')) {
    await initDatabase();
    const counts = await reclassify();
    logger.info(`Reclassified ${counts.total} roles: ${counts.target} target, ${counts.exception} exception, ${counts.excluded} excluded`);
    await publishRoles();
    return;
  }

  const employers = loadJson(EMPLOYERS_CONFIG).employers;
  const filters = loadJson(FILTERS_CONFIG);

  // --only id1,id2: scrape just these employers (e.g. newly added ones).
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;
  const toScrape = only ? employers.filter((e) => only.has(e.id)) : employers;
  if (only) logger.info(`Scraping only: ${toScrape.map((e) => e.id).join(', ')}`);

  await initDatabase();

  // --resume (scheduled, catch-up and retry runs) continues an unfinished
  // run; anything else starts fresh. --only runs never touch the checkpoint.
  let cp = null;
  if (!only && args.includes('--resume')) {
    cp = resumableCheckpoint(loadCheckpoint());
    if (cp) {
      const active = toScrape.filter((e) => e.active);
      const done = active.filter((e) => cp.employers[e.id] && cp.employers[e.id].status === 'ok').length;
      const total = active.length;
      logger.info(`Resuming ${cp.run_id}: ${done} of ${total} employers already saved, continuing with the rest`);
    }
  }
  cp = cp || newCheckpoint(runId, runStart.toISOString());
  const save = only ? () => {} : (checkpoint) => saveCheckpoint(checkpoint);
  save(cp);

  // server.js passes --pause-on-sleep; a run by hand never pauses.
  const pauseOnSleep = !only && args.includes('--pause-on-sleep');
  const { paused } = await scrapeEmployers(toScrape, filters, cp, save, { pauseOnSleep });
  if (paused) {
    process.exitCode = PAUSED_EXIT_CODE;
    return;
  }
  // Closing dates also pass for employers whose scrape failed in this run.
  const { deactivateExpiredRoles } = await import('./lib/database.js');
  const expired = await deactivateExpiredRoles();
  if (expired) logger.info(`${expired} roles past their closing date set to inactive`);
  await fetchDescriptions(employers);
  const counts = await reclassify();
  logger.info(`Classified ${counts.total} roles: ${counts.target} target, ${counts.exception} exception, ${counts.excluded} excluded`);
  await recordRun(cp, { updateLastRefresh: !only });
  // Mark complete before the last publish so the board shows "complete";
  // if the publish fails, unmark it so the retry resumes, not rescrapes.
  cp.completed_at = new Date().toISOString();
  save(cp);
  try {
    await publishRoles();
  } catch (err) {
    cp.completed_at = null;
    save(cp);
    throw err;
  }

  const results = Object.values(cp.employers);
  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.filter((r) => r.status === 'error').length;
  logger.info(`=== Refresh complete: ${okCount} succeeded, ${errCount} failed ===`);
}

main().catch((err) => {
  logger.error(`Fatal error in refresh run: ${err.stack || err.message}`);
  process.exitCode = 1;
}).finally(() => {
  // The IPC channel from server.js keeps the process alive; close it.
  if (process.connected) process.disconnect();
});
