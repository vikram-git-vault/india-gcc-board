import fs from 'fs';
import { load } from 'cheerio';
import { BaseScraper } from './BaseScraper.js';

const FILTERS_URL = new URL('../../config/filters.json', import.meta.url);
const FILTERS = JSON.parse(fs.readFileSync(FILTERS_URL, 'utf-8'));
const LOCATION_KEYWORDS = [...FILTERS.locations, ...(FILTERS.locations_secondary || [])].map((l) => l.toLowerCase());

const DEFAULT_MAX_DETAIL_FETCHES = 15;
const DEFAULT_JOB_URL_PATTERN = /\/job\//i;

// One class covering every employer whose careers site isn't Workday or
// Oracle Fusion — which in practice, per docs/ARCHITECTURE.md §4, means
// Phenom, SAP SuccessFactors, iCIMS, and genuinely bespoke sites alike.
// The unifying mechanism isn't an ATS vendor, it's a convention nearly all
// of them share for Google for Jobs SEO: a sitemap.xml listing job URLs,
// and each job page carrying schema.org JobPosting JSON-LD. That's a far
// more stable integration surface than reverse-engineering each vendor's
// private search API.
//
// Known limitation: large employers can have thousands of postings.
// Fetching every detail page in one run would blow the crawl-delay/time
// budget, so this pre-filters candidate URLs by matching a target city
// name in the URL itself (cheap, no extra requests) and caps the number
// of detail-page fetches per run (max_detail_fetches). Coverage of a very
// large employer improves across multiple daily runs rather than being
// complete on day one — an accepted tradeoff, not a bug.
export class CustomScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { custom } = employer;
    if (!custom || !custom.sitemap_url) {
      throw new Error(`Employer "${employer.id}" is missing config.custom.sitemap_url`);
    }
    this.sitemapUrl = custom.sitemap_url;
    this.jobUrlPattern = custom.job_url_pattern ? new RegExp(custom.job_url_pattern, 'i') : DEFAULT_JOB_URL_PATTERN;
    this.maxDetailFetches = custom.max_detail_fetches || DEFAULT_MAX_DETAIL_FETCHES;
  }

  async fetchSitemapEntries(sitemapUrl, depth = 0) {
    if (depth > 2) return [];
    const { data } = await this.client.get(sitemapUrl);
    const text = String(data);
    const isIndex = /<sitemapindex/i.test(text);
    const locs = [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => decodeXmlEntities(m[1]));
    const lastmods = [...text.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((m) => m[1]);

    if (isIndex) {
      let entries = [];
      for (const subUrl of locs) {
        await this.delay();
        entries = entries.concat(await this.fetchSitemapEntries(subUrl, depth + 1));
      }
      return entries;
    }

    return locs.map((loc, i) => ({ loc, lastmod: lastmods[i] || null }));
  }

  async fetchListings() {
    const entries = await this.fetchSitemapEntries(this.sitemapUrl);
    const jobEntries = entries.filter((e) => this.jobUrlPattern.test(e.loc));

    // Rank by location-in-URL match rather than hard-filtering on it: some
    // platforms embed the city in the slug (SuccessFactors, e.g. "Mumbai-
    // Head-Affluent-..."), others don't (Phenom's slugs are just a job ID
    // + title, e.g. "FTGFTMUS869124EXTERNALENUS/Portfolio-Manager..."). A
    // hard filter would silently return zero candidates for the latter —
    // this happened for real against Franklin Templeton (verified India
    // postings exist, zero were ever selected). Ranking degrades
    // gracefully to plain recency when no URL carries a location hint,
    // instead of failing closed.
    const withRank = jobEntries.map((e) => ({
      ...e,
      locationHint: LOCATION_KEYWORDS.some((kw) => e.loc.toLowerCase().includes(kw)) ? 1 : 0,
    }));
    withRank.sort((a, b) => b.locationHint - a.locationHint || (b.lastmod || '').localeCompare(a.lastmod || ''));
    const selected = withRank.slice(0, this.maxDetailFetches);

    const postings = [];
    for (const entry of selected) {
      try {
        const { data: html } = await this.client.get(entry.loc);
        const posting = extractJobPostingJsonLd(html);
        if (posting) postings.push({ ...posting, sourceUrl: entry.loc });
      } catch {
        // A single bad detail page shouldn't fail the whole employer run.
      }
      await this.delay();
    }

    return postings;
  }

  extractRoles(postings) {
    return postings.map((posting) => {
      const identifier = posting.identifier && posting.identifier.value;
      const trailingId = posting.sourceUrl.match(/(\d{5,})\/?$/);
      return {
        externalJobId: identifier ? String(identifier) : (trailingId ? trailingId[1] : posting.sourceUrl),
        title: posting.title || '',
        description: posting.description || '',
        location: extractLocationText(posting.jobLocation),
        url: posting.sourceUrl,
        postedDate: posting.datePosted || null,
        jobType: Array.isArray(posting.employmentType) ? posting.employmentType[0] : posting.employmentType || null,
        department: (posting.hiringOrganization && posting.hiringOrganization.name) || null,
      };
    });
  }
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Not every platform embeds JobPosting as JSON-LD — SAP SuccessFactors
// (verified against EY GDS and Standard Chartered) uses schema.org
// Microdata (itemprop attributes) instead. Both are real, both are
// intended for search-engine consumption, so both are fair game; this
// tries JSON-LD first and falls back to Microdata rather than assuming
// one format universally.
function extractJobPostingJsonLd(html) {
  const $ = load(html);
  let posting = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (posting) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const found = candidates.find((c) => c && c['@type'] === 'JobPosting');
      if (found) posting = found;
    } catch {
      // Malformed JSON-LD on a job page is a data-quality issue on the
      // employer's side, not something to crash the scrape over.
    }
  });
  return posting || extractJobPostingMicrodata($);
}

function extractJobPostingMicrodata($) {
  const scope = $('[itemtype="http://schema.org/JobPosting"], [itemtype="https://schema.org/JobPosting"]').first();
  if (!scope.length) return null;

  const getProp = (name) => {
    const el = scope.find(`[itemprop="${name}"]`).first();
    if (!el.length) return null;
    return el.is('meta') ? el.attr('content') : el.text().trim();
  };

  const title = getProp('title');
  if (!title) return null; // no usable JobPosting data, not just a different format

  return {
    title,
    description: getProp('description'),
    datePosted: getProp('datePosted'),
    employmentType: getProp('employmentType'),
    jobLocation: {
      address: {
        addressLocality: getProp('addressLocality'),
        addressRegion: getProp('addressRegion'),
        addressCountry: getProp('addressCountry'),
      },
    },
    hiringOrganization: { name: getProp('hiringOrganization') },
  };
}

function extractLocationText(jobLocation) {
  if (!jobLocation) return '';
  const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  return locations
    .map((loc) => {
      const addr = (loc && loc.address) || {};
      return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join(' | ');
}
