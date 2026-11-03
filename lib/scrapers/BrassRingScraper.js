import { BaseScraper } from './BaseScraper.js';

// Kenexa BrassRing career sites ("TGnewUI"; verified 2026-11-03 against
// UBS jobs.ubs.com, partner 25008, site 5012). The search page gives a
// session value and a request token in hidden inputs; the site's own
// search then POSTs to /TgNewUI/Search/Ajax/MatchedJobs, 50 jobs per page,
// with a short description. The location search matches the country
// field, so "India" works and a city name finds nothing.
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 10;
export const BRASSRING_API_PATH = '/TgNewUI/Search/Ajax/MatchedJobs';

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

// "03-Nov-2026" -> "2026-11-03"
export function brassRingDate(value) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(value || '').trim());
  return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}` : null;
}

function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export class BrassRingScraper extends BaseScraper {
  constructor(employer) {
    super(employer);
    const { brassring } = employer;
    if (!brassring || !brassring.host || !brassring.partner_id || !brassring.site_id) {
      throw new Error(`Employer "${employer.id}" is missing config.brassring.{host,partner_id,site_id}`);
    }
    this.host = brassring.host;
    this.partnerId = String(brassring.partner_id);
    this.siteId = String(brassring.site_id);
    this.location = brassring.location || 'India';
    this.maxPages = brassring.max_pages || DEFAULT_MAX_PAGES;
    this.homeUrl = `https://${this.host}/TGnewUI/Search/Home/Home?partnerid=${this.partnerId}&siteid=${this.siteId}`;
  }

  async scrape() {
    const robotsCheck = await this.checkRobotsTxt(BRASSRING_API_PATH);
    if (robotsCheck.allowed === false) throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    return super.scrape();
  }

  // The session value, request token and cookies come from the search page.
  async openSession() {
    const res = await this.client.get(this.homeUrl);
    const html = String(res.data);
    const session = /id="CookieValue" type="hidden" value="([^"]*)"/.exec(html);
    const token = /__RequestVerificationToken" type="hidden" value="([^"]*)"/.exec(html);
    if (!session || !token) throw new Error('BrassRing search page has no session value or request token');
    const cookies = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    return { session: session[1], token: token[1], cookies };
  }

  async fetchPage(sessionInfo, pageNumber) {
    const { data } = await this.client.post(`https://${this.host}${BRASSRING_API_PATH}`, {
      partnerId: this.partnerId,
      siteId: this.siteId,
      keyword: '',
      location: this.location,
      keywordCustomSolrFields: 'JobTitle,FORMTEXT2,AutoReq,Department',
      locationCustomSolrFields: 'FORMTEXT6,Location',
      linkId: '',
      Latitude: 0,
      Longitude: 0,
      facetfilterfields: { Facet: [] },
      powersearchoptions: { PowerSearchOption: [] },
      SortType: 'LastUpdated',
      pageNumber,
      encryptedSessionValue: sessionInfo.session,
    }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', RFT: sessionInfo.token, Cookie: sessionInfo.cookies },
    });
    if (!data || !data.Jobs || !Array.isArray(data.Jobs.Job)) throw new Error('unexpected BrassRing response: no Jobs');
    return { total: Number(data.JobsCount) || 0, jobs: data.Jobs.Job };
  }

  async fetchListings() {
    const sessionInfo = await this.openSession();
    await this.delay();
    const first = await this.fetchPage(sessionInfo, 1);
    const jobs = [...first.jobs];
    const allPages = Math.ceil(first.total / PAGE_SIZE);
    const pages = Math.min(allPages, this.maxPages);
    // Stopped at max_pages: roles not read are not closed.
    if (allPages > this.maxPages) this.presence = { type: 'ids', complete: false };
    for (let page = 2; page <= pages; page += 1) {
      await this.delay();
      const { jobs: more } = await this.fetchPage(sessionInfo, page);
      if (!more.length) break;
      jobs.push(...more);
    }
    return jobs;
  }

  extractRoles(jobs) {
    const seen = new Set();
    const roles = [];
    for (const job of jobs) {
      const q = Object.fromEntries((job.Questions || []).map((x) => [String(x.QuestionName).toLowerCase(), x.Value]));
      const id = String(q.reqid || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      roles.push({
        externalJobId: id,
        title: decodeEntities(q.jobtitle),
        description: decodeEntities(q.jobdescription),
        location: decodeEntities(q.formtext23) || this.location,
        url: job.Link || `${this.homeUrl}&PageType=JobDetails&jobid=${id}`,
        postedDate: brassRingDate(q.lastupdated),
        jobType: null,
        department: decodeEntities(q.department) || null,
      });
    }
    return roles;
  }
}
