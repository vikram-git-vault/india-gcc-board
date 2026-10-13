import crypto from 'crypto';
import fs from 'fs';

// Shared by every scorer (Claude Code now; Ollama / Groq / Claude API later):
// the rubric version, the change-detection hash, and validation of a score
// record before it reaches the database. See config/scoring-rubric.md.

const RUBRIC_URL = new URL('../config/scoring-rubric.md', import.meta.url);

export const VARIANTS = ['PO', 'EM'];
const CONFIDENCE = ['high', 'low'];

export function rubricVersion(markdown = fs.readFileSync(RUBRIC_URL, 'utf-8')) {
  const match = markdown.match(/^Rubric version:\s*(\d+)\s*$/m);
  if (!match) throw new Error('config/scoring-rubric.md has no "Rubric version: N" line');
  return Number(match[1]);
}

// A score is stale when the title or the description it was based on changes.
export function descriptionHash(title, description) {
  return crypto.createHash('sha256').update(`${title || ''}\n${description || ''}`).digest('hex').slice(0, 16);
}

function isScore(n) {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}

function stringList(value, max, field, errors) {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    errors.push(`${field} must be an array of non-empty strings`);
    return [];
  }
  if (value.length > max) errors.push(`${field} has ${value.length} items (max ${max})`);
  return value.map((v) => v.trim());
}

// Returns { ok: true, value } with a normalized record, or { ok: false, errors }.
export function validateScoreRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return { ok: false, errors: ['record is not an object'] };
  if (!Number.isInteger(record.role_id)) errors.push('role_id must be an integer');

  const scores = record.scores || {};
  for (const variant of VARIANTS) {
    const s = scores[variant];
    if (!s || !isScore(s.ats) || !isScore(s.fit)) {
      errors.push(`scores.${variant}.ats and scores.${variant}.fit must be integers 0-100`);
    }
  }
  if (!VARIANTS.includes(record.recommended)) errors.push('recommended must be "PO" or "EM"');
  if (typeof record.reason !== 'string' || !record.reason.trim()) errors.push('reason must be a non-empty string');
  else if (record.reason.trim().split(/\s+/).length > 35) errors.push('reason is longer than 35 words');
  const matched = stringList(record.matched_keywords, 10, 'matched_keywords', errors);
  const gaps = stringList(record.gaps, 3, 'gaps', errors);
  if (!CONFIDENCE.includes(record.confidence)) errors.push('confidence must be "high" or "low"');

  if (errors.length) return { ok: false, errors };

  // The rubric picks the variant with the higher fit (ties: higher ATS).
  // Enforce it so a scorer slip cannot show the wrong resume on the board.
  const [po, em] = [scores.PO, scores.EM];
  const best = po.fit !== em.fit ? (po.fit > em.fit ? 'PO' : 'EM') : (po.ats >= em.ats ? 'PO' : 'EM');
  if (record.recommended !== best) {
    return { ok: false, errors: [`recommended is ${record.recommended} but ${best} has the higher fit score`] };
  }

  return {
    ok: true,
    value: {
      role_id: record.role_id,
      po_ats: po.ats,
      po_fit: po.fit,
      em_ats: em.ats,
      em_fit: em.fit,
      recommended: best,
      ats_score: scores[best].ats,
      fit_score: scores[best].fit,
      reason: record.reason.trim(),
      matched_keywords: matched,
      gaps,
      confidence: record.confidence,
    },
  };
}
