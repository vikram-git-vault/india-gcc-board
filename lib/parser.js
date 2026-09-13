import { load } from 'cheerio';

const LEVEL_PATTERNS = [
  { level: 'lead', pattern: /\b(director|vice president|\bvp\b|head of|managing director|principal|lead)\b/i },
  { level: 'senior', pattern: /\b(senior|\bsr\.?\b|staff|architect)\b/i },
  { level: 'mid', pattern: /\b(mid-level|experienced|specialist)\b/i },
];

export function detectLevel(text) {
  for (const { level, pattern } of LEVEL_PATTERNS) {
    if (pattern.test(text)) return level;
  }
  return 'entry';
}

export function sanitizeText(html) {
  if (!html) return '';
  const $ = load(html);
  return $.text().replace(/\s+/g, ' ').trim();
}

export function parsePostedDate(raw) {
  if (!raw) return null;
  const text = String(raw).toLowerCase();
  const now = new Date();

  if (text.includes('today')) return now.toISOString().slice(0, 10);
  if (text.includes('yesterday')) {
    now.setDate(now.getDate() - 1);
    return now.toISOString().slice(0, 10);
  }
  const days = text.match(/(\d+)\+?\s*day/);
  if (days) {
    now.setDate(now.getDate() - parseInt(days[1], 10));
    return now.toISOString().slice(0, 10);
  }
  const months = text.match(/(\d+)\+?\s*month/);
  if (months) {
    now.setMonth(now.getMonth() - parseInt(months[1], 10));
    return now.toISOString().slice(0, 10);
  }
  const isoLike = Date.parse(raw);
  return Number.isNaN(isoLike) ? null : new Date(isoLike).toISOString().slice(0, 10);
}

export function mapLocation(rawLocation, filters) {
  if (!rawLocation) return null;
  const known = [...(filters.locations || []), ...(filters.locations_secondary || [])];
  const match = known.find((loc) => rawLocation.toLowerCase().includes(loc.toLowerCase()));
  return match || rawLocation.trim();
}

export function matchesFilters(role, filters) {
  const haystack = `${role.title} ${role.description || ''}`.toLowerCase();
  const excluded = (filters.exclude_keywords || []).some((kw) => haystack.includes(kw.toLowerCase()));
  if (excluded) return false;

  const locations = [...(filters.locations || []), ...(filters.locations_secondary || [])].map((l) => l.toLowerCase());
  if (locations.length && role.location) {
    const locationMatches = locations.some((loc) => role.location.toLowerCase().includes(loc));
    if (!locationMatches) return false;
  }

  return true;
}

export function normalizeRole(rawRole, employer, filters) {
  const title = sanitizeText(rawRole.title);
  const description = sanitizeText(rawRole.description);
  const location = mapLocation(rawRole.location, filters);

  const role = {
    external_job_id: rawRole.externalJobId,
    title,
    description,
    location,
    country: rawRole.country || 'India',
    department: rawRole.department || null,
    experience_level: detectLevel(`${title} ${description}`),
    job_type: rawRole.jobType || null,
    salary_range: rawRole.salaryRange || null,
    posted_date: parsePostedDate(rawRole.postedDate),
    deadline: rawRole.deadline || null,
    job_url: rawRole.url,
    source_updated: new Date().toISOString(),
  };

  return matchesFilters(role, filters) ? role : null;
}

export function parseRoles(rawListings, employer, filters) {
  return rawListings
    .map((raw) => normalizeRole(raw, employer, filters))
    .filter(Boolean);
}
