import { classifyRole } from './targeting.js';

// Company discovery from a job-site sitemap whose job URLs encode
// /jobs/<company-slug>/<title-words>-<city>-<id>/ (Talent500 shape).
// Pure functions only; discover.js does the fetching. Only company-level
// aggregates leave this module — never the job listings themselves.

const CITY_WORDS = [
  'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'pune', 'mumbai', 'thane',
  'gurugram', 'gurgaon', 'noida', 'delhi', 'kolkata', 'ahmedabad', 'vadodara',
  'coimbatore', 'trivandrum', 'kochi', 'remote', 'india',
];
const CITY_ALIASES = { bangalore: 'bengaluru', gurgaon: 'gurugram' };

export function parseJobUrl(url) {
  const m = String(url).match(/\/jobs\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  const words = m[2].replace(/-t500[-_].*$/i, '').split('-').filter(Boolean);
  let city = null;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (CITY_WORDS.includes(words[i].toLowerCase())) {
      city = CITY_ALIASES[words[i].toLowerCase()] || words[i].toLowerCase();
      words.splice(i);
      break;
    }
  }
  return { company: m[1].toLowerCase(), title: words.join(' '), city };
}

export function sitemapLocs(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

// ATS signatures in a careers page (HTML, links, embedded scripts). The
// first match wins; `config` is what config/employers.json needs for the
// scraper types this project supports.
const ATS_SIGNATURES = [
  { ats: 'workday', supported: true, re: /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    config: (m) => ({ workday: { tenant: m[1], cluster: m[2], site: m[3] } }) },
  { ats: 'oracle', supported: true, re: /https?:\/\/([a-z0-9]+\.fa\.[a-z0-9]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_-]+)/,
    config: (m) => ({ oracle: { host: m[1], siteNumber: m[2] } }) },
  { ats: 'greenhouse', supported: true, re: /(?:boards|job-boards)(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/|embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)/i,
    config: (m) => ({ greenhouse: { board: m[1] } }) },
  // Avature works with AvatureScraper, but custom.search_url must be found by hand.
  { ats: 'avature', supported: false, re: /([a-z0-9-]+)\.avature\.net/i, config: (m) => ({ avature_tenant: m[1] }) },
  { ats: 'lever', supported: false, re: /jobs\.lever\.co\/([a-z0-9-]+)/i, config: (m) => ({ lever: { company: m[1] } }) },
  { ats: 'smartrecruiters', supported: false, re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9-]+)/, config: (m) => ({ smartrecruiters: { company: m[1] } }) },
  { ats: 'eightfold', supported: false, re: /([a-z0-9-]+)\.eightfold\.ai/i, config: (m) => ({ eightfold: { tenant: m[1] } }) },
  { ats: 'successfactors', supported: false, re: /successfactors\.(?:com|eu)|jobs\.sap\.com|rmkcdn\.successfactors/i, config: () => ({}) },
  { ats: 'icims', supported: false, re: /(?:https?:\/\/)(?!www\.|cookie)([a-z0-9-]+)\.icims\.com/i, config: (m) => ({ icims: { tenant: m[1] } }) },
  { ats: 'phenom', supported: false, re: /phenompeople\.com|phenom-feeds|"phenomTenant"/i, config: () => ({}) },
  { ats: 'taleo', supported: false, re: /([a-z0-9-]+)\.taleo\.net/i, config: (m) => ({ taleo: { tenant: m[1] } }) },
];

// Returns { ats, supported, config, evidence } or null when no signature matches.
export function detectAts(html) {
  for (const sig of ATS_SIGNATURES) {
    const m = String(html).match(sig.re);
    if (m) return { ats: sig.ats, supported: sig.supported, config: sig.config(m), evidence: m[0] };
  }
  return null;
}

// Groups job URLs by company and keeps companies with at least one title
// that passes config/targets.json (target or exception tier).
export function summarizeCompanies(urls, classify = classifyRole) {
  const companies = new Map();
  for (const url of urls) {
    const job = parseJobUrl(url);
    if (!job) continue;
    const entry = companies.get(job.company) || { company: job.company, jobs: 0, matching: 0, cities: new Set(), samples: [] };
    entry.jobs += 1;
    const { tier, grade } = classify(job.title);
    if (tier !== 'excluded') {
      entry.matching += 1;
      if (job.city) entry.cities.add(job.city);
      if (entry.samples.length < 5) entry.samples.push(`${job.title}${grade ? ` (${grade})` : ''}`);
    }
    companies.set(job.company, entry);
  }
  return [...companies.values()]
    .filter((c) => c.matching > 0)
    .map((c) => ({ ...c, cities: [...c.cities].sort() }))
    .sort((a, b) => b.matching - a.matching || a.company.localeCompare(b.company));
}
