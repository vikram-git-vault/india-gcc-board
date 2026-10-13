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
    exceptionMinFitScore: raw.exception_min_fit_score,
    grades: raw.grades.map((g) => ({ ...g, regex: re(g.pattern) })),
    excludeHard: re(raw.exclude_hard),
    excludeSoft: re(raw.exclude_soft),
    technologyOverride: re(raw.technology_override),
    excludeHandsOn: re(raw.exclude_hands_on),
    families: raw.families.map((f) => ({ ...f, regex: re(f.pattern) })),
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

  const overridingFamily = targets.families.find((f) => f.overrides_hands_on && f.regex.test(text));
  if (!overridingFamily && targets.excludeHandsOn.test(text)) {
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
