#!/usr/bin/env node
/**
 * Injects data/artifact-sync.json (written by lib/publisher.js) into the
 * job-board.html template, producing a ready-to-publish file. This is a
 * local build step, not a publish — see docs/ARCHITECTURE.md §5.1 for why
 * the actual publish/sync into the live board is a manual Claude Code
 * step, not something this script can do on its own.
 *
 * Usage: node frontend/build.js
 * Output: frontend/job-board.built.html (gitignored, regenerated each run)
 */
import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = path.join('frontend', 'job-board.html');
const SYNC_PATH = path.join('data', 'artifact-sync.json');
const EMPLOYERS_PATH = path.join('config', 'employers.json');
const OUTPUT_PATH = path.join('frontend', 'job-board.built.html');

const { shards, updatedAt } = JSON.parse(fs.readFileSync(SYNC_PATH, 'utf-8'));
// lib/publisher.js shards roles for the live db (256 KiB/doc cap) — the
// embedded fallback baked into this HTML has no such limit, so flatten
// back into one array here.
const roles = shards.flat();
const meta = { last_refresh: updatedAt };

// Employer coverage (how many of the employers we track actually got
// scraped) comes from config, not the roles list — an employer with an
// active scraper that returned zero roles this cycle is still "fetched",
// just empty. totalTracked includes employers.json's `excluded` list
// (e.g. Citigroup, JPMorgan, Schwab) — those were never attempted at all,
// so they count toward "not yet automated" same as any other manual one.
const employersConfig = JSON.parse(fs.readFileSync(EMPLOYERS_PATH, 'utf-8'));
const totalTracked = employersConfig.employers.length + employersConfig.excluded.length;
const fetchedCount = employersConfig.employers.filter((e) => e.active).length;
const coverage = { totalTracked, fetchedCount, manualCount: totalTracked - fetchedCount };

let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
html = html.replace('__ROLES_JSON__', JSON.stringify(roles));
html = html.replace('__META_JSON__', JSON.stringify(meta));
html = html.replace('__COVERAGE_JSON__', JSON.stringify(coverage));

fs.writeFileSync(OUTPUT_PATH, html);
console.log(`Built ${OUTPUT_PATH} with ${roles.length} roles (updated ${updatedAt}).`);
console.log('This is a local build only — publish/sync it via the Artifact tool from a Claude Code session.');
