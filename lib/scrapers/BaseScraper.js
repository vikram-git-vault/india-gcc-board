import axios from 'axios';

const USER_AGENT = process.env.USER_AGENT
  || 'india-gcc-board-bot/1.0 (+https://github.com/vikram-git-vault/india-gcc-board)';

// See docs/ARCHITECTURE.md §2 and §4 — every scraper shares this base so
// robots.txt compliance, crawl delay, and UA identification are enforced
// once, not re-implemented per ATS family.
export class BaseScraper {
  constructor(employer) {
    this.employer = employer;
    this.client = axios.create({
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  async checkRobotsTxt(pathToCheck) {
    const target = new URL(this.employer.careers_url);
    const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
    try {
      const { data } = await this.client.get(robotsUrl);
      return isPathAllowed(data, pathToCheck || target.pathname);
    } catch (err) {
      // No robots.txt (404) or host unreachable here specifically — fail
      // open on the robots check itself; a genuinely unreachable host will
      // still fail loudly in fetchListings().
      return { allowed: true, reason: `robots.txt unavailable: ${err.message}` };
    }
  }

  async delay() {
    const ms = (this.employer.crawl_delay_seconds || 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchListings() {
    throw new Error('fetchListings() must be implemented by subclass');
  }

  extractRoles(_raw) {
    throw new Error('extractRoles() must be implemented by subclass');
  }

  async scrape() {
    const robotsCheck = await this.checkRobotsTxt();
    if (robotsCheck.allowed === false) {
      throw new Error(`Blocked by robots.txt (${robotsCheck.reason})`);
    }
    const raw = await this.fetchListings();
    return this.extractRoles(raw);
  }
}

function isPathAllowed(robotsTxt, pathToCheck) {
  const lines = robotsTxt.split('\n').map((l) => l.trim());
  let inWildcardGroup = false;
  const disallows = [];
  const allows = [];

  for (const line of lines) {
    if (/^user-agent:\s*\*/i.test(line)) {
      inWildcardGroup = true;
      continue;
    }
    if (/^user-agent:/i.test(line)) {
      inWildcardGroup = false;
      continue;
    }
    if (!inWildcardGroup) continue;

    const disallowMatch = line.match(/^disallow:\s*(.*)$/i);
    if (disallowMatch && disallowMatch[1]) disallows.push(disallowMatch[1].trim());

    const allowMatch = line.match(/^allow:\s*(.*)$/i);
    if (allowMatch && allowMatch[1]) allows.push(allowMatch[1].trim());
  }

  const longestMatch = (rules) => rules
    .filter((rule) => pathToCheck.startsWith(rule))
    .sort((a, b) => b.length - a.length)[0];

  const matchingDisallow = longestMatch(disallows);
  if (!matchingDisallow) return { allowed: true };

  const matchingAllow = longestMatch(allows);
  if (matchingAllow && matchingAllow.length >= matchingDisallow.length) return { allowed: true };

  return { allowed: false, reason: `Disallow: ${matchingDisallow}` };
}
