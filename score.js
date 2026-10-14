#!/usr/bin/env node
/**
 * score.js — ATS and fit scores for shortlisted roles (config/scoring-rubric.md).
 *
 *   node score.js --status                 counts: scored, pending, stale
 *   node score.js --pending [--out FILE]   roles that need a score, as JSON
 *                           [--limit N]    (default FILE: .cache/scoring/pending.json)
 *                           [--exclude ID,ID]  skip these role ids
 *   node score.js --import FILE            validate and store scores, then republish
 *                 [--scorer NAME]          (default scorer: claude-code)
 *
 * autoscore.js runs this automatically after each refresh (claude -p).
 * By hand: ask Claude Code to "score the new roles". It runs
 * --pending, scores each role against the two resume variants in Resume/
 * (gitignored), writes the records to a file and runs --import.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createLogger } from './lib/logger.js';
import { initDb, getRolesForScoring, upsertScore, closeDb } from './lib/database.js';
import { rubricVersion, descriptionHash, validateScoreRecord } from './lib/scoring.js';
import { publish } from './lib/publisher.js';
import { htmlToText } from './lib/descriptions.js';

const logger = createLogger('score');
const DEFAULT_PENDING = path.join('.cache', 'scoring', 'pending.json');

function argValue(args, name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

function classify(role, version) {
  const hash = descriptionHash(role.title, role.description);
  if (role.scored_hash == null) return { state: 'new', hash };
  if (role.scored_hash !== hash || role.scored_rubric_version !== version) return { state: 'stale', hash };
  return { state: 'scored', hash };
}

async function status(version) {
  const roles = await getRolesForScoring();
  const counts = { scored: 0, new: 0, stale: 0 };
  roles.forEach((r) => { counts[classify(r, version).state] += 1; });
  logger.info(`Rubric v${version}: ${roles.length} shortlisted, ${counts.scored} scored, ${counts.new} new, ${counts.stale} stale`);
}

async function pending(version, outFile, limit, exclude = new Set()) {
  const roles = (await getRolesForScoring())
    .map((r) => ({ ...r, ...classify(r, version) }))
    .filter((r) => r.state !== 'scored' && !exclude.has(r.id))
    .slice(0, limit)
    .map((r) => ({
      role_id: r.id,
      // Echo this back in the score record: import rejects the score if the
      // description changed after this export (the scorer saw other text).
      description_hash: r.hash,
      employer: r.employer,
      title: r.title,
      grade: r.grade,
      family: r.family,
      tier: r.tier,
      location: r.location,
      description_available: r.description.length >= 200,
      // Some custom scrapers store markup; give the scorer plain text.
      description: /<[a-z][^>]*>/i.test(r.description) ? htmlToText(r.description) : r.description,
    }));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ rubric_version: version, roles }, null, 2));
  logger.info(`Wrote ${roles.length} roles to score to ${outFile}`);
}

async function importScores(version, file, scorer) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const records = Array.isArray(parsed) ? parsed : parsed.scores;
  if (!Array.isArray(records)) throw new Error(`${file}: expected an array or { "scores": [...] }`);

  const byId = new Map((await getRolesForScoring()).map((r) => [r.id, r]));
  let stored = 0;
  const rejected = [];
  const seen = new Set();
  for (const record of records) {
    const result = validateScoreRecord(record);
    const role = result.ok && byId.get(result.value.role_id);
    const currentHash = role && descriptionHash(role.title, role.description);
    const reject = (errors) => rejected.push({ role_id: record && record.role_id, errors });
    if (!result.ok) {
      reject(result.errors);
    } else if (seen.has(result.value.role_id)) {
      reject(['duplicate role_id in this file; only the first record is kept']);
    } else if (!role) {
      reject(['not an active shortlisted role']);
    } else if (record.description_hash !== currentHash) {
      reject([record.description_hash
        ? 'stale: the description changed after --pending; export and score it again'
        : 'description_hash missing; copy it from the --pending output']);
    } else {
      seen.add(result.value.role_id);
      await upsertScore(result.value, { scorer, rubricVersion: version, descriptionHash: currentHash });
      stored += 1;
    }
  }

  rejected.forEach((r) => logger.warn(`  rejected role ${r.role_id}: ${r.errors.join('; ')}`));
  logger.info(`Stored ${stored} scores, rejected ${rejected.length}`);
  return { stored, rejected };
}

async function main() {
  const args = process.argv.slice(2);
  const version = rubricVersion();
  await initDb();

  if (args.includes('--pending')) {
    const limit = Number(argValue(args, '--limit', Infinity));
    if (!(limit > 0)) throw new Error('--limit must be a positive number');
    const exclude = new Set(String(argValue(args, '--exclude', '')).split(',').filter(Boolean).map(Number));
    await pending(version, argValue(args, '--out', DEFAULT_PENDING), limit, exclude);
  } else if (args.includes('--import')) {
    const file = argValue(args, '--import');
    if (!file) throw new Error('--import needs a file path');
    const { rejected } = await importScores(version, file, argValue(args, '--scorer', 'claude-code'));
    await closeDb();
    const { rolesWritten } = await publish();
    logger.info(`Republished ${rolesWritten} roles`);
    if (rejected.length) process.exitCode = 2;
    return;
  } else {
    await status(version);
  }
  await closeDb();
}

main().catch((err) => {
  logger.error(err.stack || err.message);
  process.exitCode = 1;
});
