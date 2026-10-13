#!/usr/bin/env node
/**
 * discover.js — find GCCs that are hiring for target roles (manual run only).
 *
 *   node discover.js --talent500
 *   node discover.js --detect <careers-url> [<careers-url> ...]
 *
 * Reads the Talent500 jobs sitemap (no job pages), applies
 * config/targets.json to the job titles in the URLs, and writes a
 * company-level summary to .cache/discovery/talent500-companies.json
 * (gitignored). Roles themselves are always scraped from each employer's
 * own career site, never from Talent500.
 *
 * NOTE: Talent500's Terms of Use (6 Feb 2025) prohibit automated access.
 * The project owner chose to run this anyway (2026-10-13). It is not part
 * of the daily refresh; keep it a rare, manual run.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { createLogger } from './lib/logger.js';
import { isPathAllowed } from './lib/scrapers/BaseScraper.js';
import { sitemapLocs, summarizeCompanies, detectAts } from './lib/discovery.js';

const logger = createLogger('discover');
const USER_AGENT = process.env.USER_AGENT
  || 'india-gcc-board-bot/1.0 (+https://github.com/vikram-git-vault/india-gcc-board)';
const OUT_DIR = path.join('.cache', 'discovery');
const DELAY_MS = 5000;

const client = axios.create({ timeout: 30000, headers: { 'User-Agent': USER_AGENT } });
const pause = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

// Employers already in config/employers.json (active or excluded), matched
// loosely by name so the report can mark them.
function knownEmployers() {
  const cfg = JSON.parse(fs.readFileSync(path.join('config', 'employers.json'), 'utf-8'));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  return [...cfg.employers, ...cfg.excluded].map((e) => ({ key: norm(e.name || e.id), name: e.name || e.id }))
    .concat([]);
}

function markKnown(companies) {
  const known = knownEmployers();
  return companies.map((c) => {
    const slug = c.company.replace(/[^a-z0-9]/g, '');
    // Prefix match, not substring: "officeworks" must not match "ICE".
    const hit = known.find((k) => k.key.length >= 3 && (slug.startsWith(k.key) || k.key.startsWith(slug)));
    return { ...c, already_tracked: hit ? hit.name : null };
  });
}

async function talent500() {
  const host = 'https://talent500.com';
  const robots = await client.get(`${host}/robots.txt`, { responseType: 'text' });
  const check = isPathAllowed(String(robots.data), '/jobs/');
  if (!check.allowed) throw new Error(`robots.txt disallows /jobs/ (${check.reason})`);
  await pause();

  const index = await client.get(`${host}/sitemap.xml`, { responseType: 'text' });
  const jobsSitemap = sitemapLocs(index.data).find((u) => /jobs-sitemap\.xml$/.test(u));
  if (!jobsSitemap) throw new Error('jobs sitemap not listed in sitemap.xml');
  await pause();

  const jobs = await client.get(jobsSitemap, { responseType: 'text' });
  const urls = sitemapLocs(jobs.data);
  const companies = markKnown(summarizeCompanies(urls));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'talent500-companies.json');
  fs.writeFileSync(outFile, JSON.stringify({
    source: jobsSitemap,
    generated_at: new Date().toISOString(),
    job_urls: urls.length,
    companies,
  }, null, 2));
  logger.info(`${urls.length} job URLs, ${companies.length} companies with target roles -> ${outFile}`);
}

// One careers page per company: robots.txt for that path, then the page
// itself; the ATS comes from links and scripts in the HTML.
async function detect(urls) {
  const results = [];
  for (const url of urls) {
    const result = { careers_url: url };
    try {
      const u = new URL(url);
      const robots = await client.get(`${u.origin}/robots.txt`, { responseType: 'text', validateStatus: () => true });
      const check = robots.status === 200 ? isPathAllowed(String(robots.data), u.pathname) : { allowed: true };
      result.robots = check.allowed ? 'allowed' : `blocked (${check.reason})`;
      if (check.allowed) {
        await pause();
        const page = await client.get(url, { responseType: 'text', maxRedirects: 5, validateStatus: () => true });
        result.http = page.status;
        result.final_url = page.request && page.request.res ? page.request.res.responseUrl : url;
        result.detected = detectAts(`${result.final_url}\n${page.data}`);
      }
    } catch (err) {
      result.error = err.message;
    }
    results.push(result);
    logger.info(`${url} -> ${result.robots || ''} ${result.detected ? `${result.detected.ats} ${JSON.stringify(result.detected.config)}` : (result.error || 'no ATS signature')}`);
    await pause();
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'detect-results.json');
  const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf-8')) : [];
  const merged = previous.filter((p) => !urls.includes(p.careers_url)).concat(results);
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--talent500')) await talent500();
  else if (args.includes('--detect')) await detect(args.filter((a) => /^https?:\/\//.test(a)));
  else logger.info('Usage: node discover.js --talent500 | --detect <careers-url> ...');
}

main().catch((err) => {
  logger.error(err.stack || err.message);
  process.exitCode = 1;
});
