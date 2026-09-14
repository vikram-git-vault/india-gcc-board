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
const OUTPUT_PATH = path.join('frontend', 'job-board.built.html');

const { roles, updatedAt } = JSON.parse(fs.readFileSync(SYNC_PATH, 'utf-8'));
const meta = { last_refresh: updatedAt };

let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
html = html.replace('__ROLES_JSON__', JSON.stringify(roles));
html = html.replace('__META_JSON__', JSON.stringify(meta));

fs.writeFileSync(OUTPUT_PATH, html);
console.log(`Built ${OUTPUT_PATH} with ${roles.length} roles (updated ${updatedAt}).`);
console.log('This is a local build only — publish/sync it via the Artifact tool from a Claude Code session.');
