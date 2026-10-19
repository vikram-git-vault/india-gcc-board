import { load } from 'cheerio';
import { BaseScraper, failIfAllFailed } from './BaseScraper.js';
import { isNetworkError } from '../network.js';

const DEFAULT_MAX_DETAIL_FETCHES = 15;
const DEFAULT_MAX_LISTING_PAGES = 80;
// Verified against Deloitte USI 2026-09-14: the search-results page ignores
// a jobRecordsPerPage override and always returns 10 results/page, so this
// isn't configurable per employer the way CustomScraper's page size would be.
const RESULTS_PER_PAGE = 10;
const DEFAULT_JOB_URL_PATTERN = /\/JobDetail\//i;

// Avature portals (verified against Deloitte USI, usijobs.deloitte.com) are
// a distinct family from the sitemap+JSON-LD convention CustomScraper
// relies on: there is no sitemap for the job-search results at all (the
// platform's generic sitemap.xml is a one-entry favicon stub) — the only
// enumeration surface is the server-rendered, paginated search-results
// list itself (?jobRecordsPerPage=10&jobOffset=N). Detail pages do carry
// schema.org JobPosting JSON-LD, but a multi-location posting (the norm on
// this tenant) leaves jobLocation.address empty; the real per-city list
// lives in a separate "toggleLocations" HTML block JSON-LD doesn't cover,
// so this class reads that directly instead of trusting the JSON-LD
// location field.
export class AvatureScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { custom } = employer;
    if (!custom || !custom.search_url) {
      throw new Error(`Employer "${employer.id}" is missing config.custom.search_url`);
    }
    this.searchUrl = custom.search_url;
    this.jobUrlPattern = custom.job_url_pattern ? new RegExp(custom.job_url_pattern, 'i') : DEFAULT_JOB_URL_PATTERN;
    this.maxDetailFetches = custom.max_detail_fetches || DEFAULT_MAX_DETAIL_FETCHES;
    this.maxListingPages = custom.max_listing_pages || DEFAULT_MAX_LISTING_PAGES;
    // Extra query parameters for a server-side filter, e.g. MetLife:
    // "semanticSearch=India&listFilterMode=1" (verified 2026-10-14).
    this.searchParams = custom.search_params || '';
  }

  async fetchListingPage(offset) {
    const extra = this.searchParams ? `${this.searchParams}&` : '';
    const url = `${this.searchUrl}?${extra}jobRecordsPerPage=${RESULTS_PER_PAGE}&jobOffset=${offset}`;
    const { data } = await this.client.get(url);
    const $ = load(data);
    const total = parseInt($('article.article--result').first().attr('data-total'), 10) || 0;
    const links = $('h3.article__header__text__title a.link')
      .map((_, el) => $(el).attr('href'))
      .get()
      .filter((href) => this.jobUrlPattern.test(href));
    // The listing card's location ("Jaipur, India"): some tenants (MetLife)
    // have no location block or JSON-LD location on the detail page.
    this.listingLocations = this.listingLocations || new Map();
    $('h3.article__header__text__title a.link').each((_, el) => {
      const loc = $(el).closest('.article__header').find('.list-item-location').first().text().trim();
      // "Multiple Locations" (Deloitte cards) is not a location.
      if (loc && !/^multiple locations$/i.test(loc)) this.listingLocations.set($(el).attr('href'), loc);
    });
    return { total, links };
  }

  // No location hint is available before fetching a detail page (listing
  // cards just say "Multiple Locations"), so there's no ranking to do.
  // Found for real against Deloitte USI (683 total listings): walking the
  // full ~69-page result set took 16+ minutes every day. So the walk stops
  // as soon as it has maxFresh URLs that are not known yet. It reports
  // complete: true only when it read every page, because only then is a
  // known URL that is not in the list closed.
  async walkListing(maxFresh) {
    const { total, links: firstPageLinks } = await this.fetchListingPage(0);
    let urls = [...firstPageLinks];
    // Some tenants (MetLife) show no data-total: page on until a page
    // comes back empty, up to maxListingPages.
    const allPages = total ? Math.ceil(total / RESULTS_PER_PAGE) : Infinity;
    const pageCount = Math.min(allPages, this.maxListingPages);
    const freshCount = () => urls.filter((u) => !this.known.has(u)).length;
    let complete = allPages <= 1 && firstPageLinks.length > 0;
    let failed = false;

    for (let page = 1; page < pageCount && freshCount() < maxFresh && firstPageLinks.length; page++) {
      await this.delay();
      try {
        const { links } = await this.fetchListingPage(page * RESULTS_PER_PAGE);
        if (!total && !links.length) { complete = true; break; }
        urls = urls.concat(links);
        if (page === allPages - 1) complete = true;
      } catch (err) {
        // A single bad listing page shouldn't fail the whole employer run,
        // but no network fails it now: refresh.js waits and tries again.
        if (isNetworkError(err)) throw err;
        failed = true;
      }
    }
    return { urls: Array.from(new Set(urls)), complete: complete && !failed };
  }

  async fetchListings() {
    const { urls: listed, complete } = await this.walkListing(this.maxDetailFetches);
    const listedSet = new Set(listed);
    this.presence = { type: 'urls', urls: listedSet, complete };
    // New URLs first. The rest of the budget re-checks the known active
    // roles that the walk did not see, oldest check first: a closed role
    // shows the "no longer available" page (see extractAvatureJobPosting).
    const fresh = listed.filter((u) => !this.known.has(u));
    const recheck = [...this.known.entries()]
      .filter(([url, k]) => k.active && !listedSet.has(url))
      .sort(([, a], [, b]) => String(a.fetchedAt || '').localeCompare(String(b.fetchedAt || '')))
      .map(([url]) => url);
    const selected = [...fresh, ...recheck].slice(0, this.maxDetailFetches);

    const postings = [];
    let lastError = null;
    for (const url of selected) {
      await this.delay();
      try {
        const { data: html } = await this.client.get(url);
        this.fetchedUrls.push({ url, lastmod: null });
        const posting = extractAvatureJobPosting(html, url, this.listingLocations && this.listingLocations.get(url));
        if (posting) postings.push(posting);
        else this.goneUrls.push(url);
      } catch (err) {
        // A single bad detail page shouldn't fail the whole employer run.
        if (isNetworkError(err)) throw err;
        lastError = err;
      }
    }
    failIfAllFailed(selected.length, this.fetchedUrls.length, lastError);
    return postings;
  }

  extractRoles(postings) {
    return postings;
  }
}

export function extractAvatureJobPosting(html, sourceUrl, listingLocation) {
  const $ = load(html);
  let title = $('h2.article__header__text__title').first().text().trim();
  // A blank title here means the posting expired between the listing page
  // being served and this detail-page fetch (Avature drops expired postings
  // to a "Sorry, this position is no longer available" page that keeps the
  // URL's slug-derived <title> tag but empties the real content elements).
  let jsonLd = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLd) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      if (parsed && parsed['@type'] === 'JobPosting') jsonLd = parsed;
    } catch {
      // Malformed JSON-LD on a job page is a data-quality issue on the
      // employer's side, not something to crash the scrape over.
    }
  });

  // MetLife's layout: the title is in the banner (and in a minimal JSON-LD).
  if (!title) title = (jsonLd && jsonLd.title ? String(jsonLd.title) : $('h2.banner__text__title').first().text()).trim();
  if (!title) return null;

  const locations = $('.article__header--locations p.paragraph')
    .map((_, el) => $(el).text().trim())
    .get();
  const jsonLdLocality = jsonLd && jsonLd.jobLocation && jsonLd.jobLocation.address
    && jsonLd.jobLocation.address.addressLocality;
  const location = locations.length ? locations.join(' | ') : (jsonLdLocality || listingLocation || '');

  const trailingId = sourceUrl.match(/(\d{5,})\/?$/);
  const identifierValue = jsonLd && jsonLd.identifier && jsonLd.identifier.value;
  const externalJobId = identifierValue != null ? String(identifierValue) : (trailingId ? trailingId[1] : sourceUrl);

  return {
    externalJobId,
    title,
    description: (jsonLd && jsonLd.description) || detailsText($),
    location,
    url: sourceUrl,
    postedDate: (jsonLd && jsonLd.datePosted) || null,
    deadline: (jsonLd && jsonLd.validThrough) || null,
    jobType: jsonLd && Array.isArray(jsonLd.employmentType) ? (jsonLd.employmentType.filter(Boolean)[0] || null) : null,
    department: (jsonLd && jsonLd.hiringOrganization && jsonLd.hiringOrganization.name) || null,
  };
}

// The "Description and Requirements" block, for tenants whose JSON-LD has
// no description (MetLife). Empty when the page has no such block.
function detailsText($) {
  const blocks = $('article.article--details').toArray()
    .filter((el) => /description/i.test($(el).find('h2, h3').first().text()));
  return blocks.map((el) => $(el).text().replace(/\s+/g, ' ').trim()).join('\n\n');
}
