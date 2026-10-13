import fs from 'fs';

// Title-based role targeting. Rules live in config/targets.json so they can
// be tuned without a code change; see docs/ARCHITECTURE.md for the tiers.
//
// tier:
//   target    — on the board
//   exception — on the board only with an AI fit score >= exception_min_fit_score
//   excluded  — kept in the database, never published

const TARGETS_URL = new URL('../config/targets.json', import.meta.url);

export function compileTargets(raw) {
  const re = (source) => new RegExp(source, 'i');
  return {
    // Missing or invalid: fall back to the documented 75 rather than
    // silently never hiding an exception role.
    exceptionMinFitScore: Number.isInteger(raw.exception_min_fit_score) ? raw.exception_min_fit_score : 75,
    grades: raw.grades.map((g) => ({ ...g, regex: re(g.pattern) })),
    excludeHard: re(raw.exclude_hard),
    excludeSoft: re(raw.exclude_soft),
    technologyOverride: re(raw.technology_override),
    excludeHandsOn: re(raw.exclude_hands_on),
    excludeSupport: raw.exclude_support ? re(raw.exclude_support) : null,
    supportLeaderWords: raw.support_leader ? re(raw.support_leader.pattern) : null,
    supportLeaderGrades: new Set((raw.support_leader && raw.support_leader.grades) || []),
    leadershipOverride: raw.leadership_override ? re(raw.leadership_override) : null,
    families: raw.families.map((f) => ({ ...f, regex: re(f.pattern) })),
    descriptionCheck: raw.description_check ? {
      minChars: raw.description_check.min_chars,
      it: new RegExp(raw.description_check.it_signals, 'gi'),
      nonIt: new RegExp(raw.description_check.non_it_signals, 'gi'),
    } : null,
  };
}

let cached = null;
export function loadTargets() {
  if (!cached) cached = compileTargets(JSON.parse(fs.readFileSync(TARGETS_URL, 'utf-8')));
  return cached;
}

const excluded = (grade, reason) => ({ grade, family: null, tier: 'excluded', reason });

export function classifyRole(title, targets = loadTargets()) {
  const text = String(title || '');

  const gradeRule = targets.grades.find((g) => g.regex.test(text));
  if (!gradeRule) return excluded(null, 'Grade below AVP / Senior Manager');
  const { grade } = gradeRule;
  if (gradeRule.tier === 'excluded') return excluded(grade, `Grade not targeted (${grade})`);

  if (targets.excludeHard.test(text)) {
    return excluded(grade, 'Function not targeted (non-technology or security)');
  }
  // "Risk", "Finance", "HR"... are domains, not functions, when the title also
  // names a technology function: "Director, Risk Technology" stays in.
  if (targets.excludeSoft.test(text) && !targets.technologyOverride.test(text)) {
    return excluded(grade, 'Function not targeted (non-technology)');
  }

  // Product-leadership titles and people-leader titles (engineering manager,
  // chapter lead, squad lead...) are never hands-on roles, even when they name
  // an engineering discipline ("Chapter Lead - Data Engineer").
  // Support and operations roles are in only when they are leader roles: a
  // leader word ("Engineering Manager - Application Support") or a senior grade
  // ("SVP, Production Services Infrastructure Support"). A VP-only support
  // title is usually a hands-on specialist.
  const isSupport = targets.excludeSupport && targets.excludeSupport.test(text);
  const isSupportLeader = isSupport && (
    (targets.supportLeaderWords && targets.supportLeaderWords.test(text))
    || targets.supportLeaderGrades.has(grade));
  if (isSupport && !isSupportLeader) {
    return excluded(grade, 'Hands-on individual contributor role');
  }

  const overridingFamily = targets.families.find((f) => f.overrides_hands_on && f.regex.test(text));
  const isPeopleLeader = targets.leadershipOverride && targets.leadershipOverride.test(text);
  if (!overridingFamily && !isPeopleLeader && targets.excludeHandsOn.test(text)) {
    return excluded(grade, 'Hands-on individual contributor role');
  }

  const familyRule = overridingFamily || targets.families.find((f) => f.regex.test(text));
  if (!familyRule) return excluded(grade, 'Role family not targeted');

  return {
    grade,
    family: familyRule.family,
    tier: gradeRule.tier,
    reason: gradeRule.tier === 'exception' ? `Exception grade (${grade}) — needs fit score` : 'Target grade and family',
  };
}

// Second check, on the full job description: catches titles that look like
// IT leadership but are not (hotel facilities "Engineering Manager", power
// grid engineering, clinical data standards, credit-risk quant modelling).
// Returns null when the role passes or the description is too short to judge.
export function nonItReason(description, targets = loadTargets()) {
  const check = targets.descriptionCheck;
  const text = String(description || '');
  if (!check || text.length < check.minChars) return null;
  const distinct = (re) => new Set((text.match(re) || []).map((m) => m.toLowerCase())).size;
  const it = distinct(check.it);
  const nonIt = distinct(check.nonIt);
  if (nonIt >= 3 || (nonIt >= 2 && it < 8) || it < 2) {
    return `Not an IT role (job description: ${nonIt} non-IT signals, ${it} IT signals)`;
  }
  return null;
}
