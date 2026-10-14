import { load } from 'cheerio';
import { classifyRole } from './targeting.js';

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

export function mapLocation(rawLocation, filters, jobUrl) {
  if (!rawLocation && !jobUrl) return null;
  // Longest-match-first: "India" is first in config/filters.json but a
  // role in "Pune, Maharashtra, India" should be tagged "Pune", not the
  // generic country name just because it happens to come first in the list.
  // Whole words only: "Indianapolis" and "Indiana" are not "India".
  // The country name is the last resort: "India" is longer than "Pune".
  const isCountry = (loc) => /^india$/i.test(loc);
  const known = [...(filters.locations || []), ...(filters.locations_secondary || [])]
    .sort((a, b) => (isCountry(a) - isCountry(b)) || b.length - a.length);
  const find = (text) => known.find((loc) => containsWholeWord(text, loc));
  // Multi-location lists ("Pune, … | Hyderabad, … | Bangalore, …", from
  // Eightfold, Phenom and Avature): the first listed city wins, not the
  // longest city name anywhere in the list.
  if (rawLocation && rawLocation.includes('|')) {
    for (const segment of rawLocation.split('|')) {
      const city = find(segment);
      if (city && !isCountry(city)) return city;
    }
  }
  const match = rawLocation ? find(rawLocation) : null;
  if (match) return match;
  // Workday shows "2 Locations" for multi-city roles; its job URL path
  // still names the primary city (/job/Bengaluru-IND/...).
  if (jobUrl && (!rawLocation || /^\s*\d+\s+locations?\s*$/i.test(rawLocation))) {
    const fromUrl = find(decodeURIComponent(String(jobUrl)).replace(/[-_/]+/g, ' '));
    if (fromUrl) return fromUrl;
  }
  return rawLocation ? rawLocation.trim() : null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function containsWholeWord(haystack, phrase) {
  return new RegExp(`\\b${escapeRegExp(phrase.toLowerCase())}\\b`, 'i').test(haystack);
}

export function matchesFilters(role, filters) {
  const haystack = `${role.title} ${role.description || ''}`;
  const excluded = (filters.exclude_keywords || []).some((kw) => containsWholeWord(haystack, kw));
  if (excluded) return false;

  const locations = [...(filters.locations || []), ...(filters.locations_secondary || [])];
  if (locations.length && role.location) {
    const locationMatches = locations.some((loc) => containsWholeWord(role.location, loc));
    if (!locationMatches) return false;
  }

  return true;
}

export function normalizeRole(rawRole, employer, filters) {
  const title = sanitizeText(rawRole.title);
  const description = sanitizeText(rawRole.description);
  const location = mapLocation(rawRole.location, filters, rawRole.url);

  const role = {
    external_job_id: rawRole.externalJobId,
    title,
    description,
    location,
    country: rawRole.country || 'India',
    department: rawRole.department || null,
    // Title only: descriptions almost always contain words like "lead",
    // which tagged nearly every described role as 'lead'.
    experience_level: detectLevel(title),
    job_type: rawRole.jobType || null,
    salary_range: rawRole.salaryRange || null,
    posted_date: parsePostedDate(rawRole.postedDate),
    deadline: rawRole.deadline || null,
    job_url: rawRole.url,
    source_updated: new Date().toISOString(),
  };

  const { grade, family, tier, reason } = classifyRole(title);
  Object.assign(role, { grade, family, tier, tier_reason: reason });

  return matchesFilters(role, filters) ? role : null;
}

export function parseRoles(rawListings, employer, filters) {
  return rawListings
    .map((raw) => normalizeRole(raw, employer, filters))
    .filter(Boolean);
}
