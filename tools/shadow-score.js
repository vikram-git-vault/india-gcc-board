#!/usr/bin/env node
/**
 * tools/shadow-score.js — check run: score roles that have a stored score
 * again, with the current prompt and a chosen model, and compare. Nothing
 * is stored in role_scores; the token use goes to model_calls with
 * shadow = 1 (the Model usage page shows it as a check run).
 *
 *   node tools/shadow-score.js [--roles 50] [--model claude-sonnet-5-5]
 *                              [--effort low|medium|high|xhigh|max]
 *
 * Roles: the latest postings whose stored score is for the same
 * description and rubric. Result: how many roles get the same
 * qualification (better RM score >= tailoring.min_fit_score) as before,
 * and the score differences. The details go to .cache/shadow/.
 */
import fs from 'fs';
import path from 'path';
import { settings } from '../lib/settings.js';
import { initDb, closeDb, getScoredRoles } from '../lib/database.js';
import { rubricVersion, descriptionHash, validateScoreRecord } from '../lib/scoring.js';
import { htmlToText } from '../lib/descriptions.js';
import { writeSystemPrompt, buildRolesMessage, scoreWithClaude, extractJsonArray } from '../autoscore.js';

const OUT_DIR = path.join('.cache', 'shadow');

export function compareScores(pairs, minFit) {
  const best = (s) => Math.max(s.po_fit, s.em_fit);
  const rows = pairs.map(({ role, before, after }) => ({
    role_id: role.id, title: role.title, employer: role.employer,
    before: best(before), after: best(after),
    ats_before: Math.max(before.po_ats, before.em_ats), ats_after: Math.max(after.po_ats, after.em_ats),
    same_gate: (best(before) >= minFit) === (best(after) >= minFit),
  }));
  const n = rows.length || 1;
  const diffs = rows.map((r) => Math.abs(r.after - r.before)).sort((a, b) => a - b);
  return {
    roles: rows.length,
    same_qualification: rows.filter((r) => r.same_gate).length / n,
    qualified_before: rows.filter((r) => r.before >= minFit).length,
    qualified_after: rows.filter((r) => r.after >= minFit).length,
    mean_abs_fit_diff: diffs.reduce((a, b) => a + b, 0) / n,
    median_abs_fit_diff: diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0,
    mean_fit_shift: rows.reduce((a, r) => a + (r.after - r.before), 0) / n,
    changed_gate: rows.filter((r) => !r.same_gate),
    rows,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, d) => { const i = args.indexOf(name); return i === -1 ? d : args[i + 1]; };
  const count = Number(opt('--roles', 50));
  const model = opt('--model', settings.models.rm);
  const effort = opt('--effort', settings.models.rm_effort);
  const models = { ...settings.models, rm: model, rm_effort: effort };
  const version = rubricVersion();

  await initDb();
  const roles = (await getScoredRoles())
    .filter((r) => r.rubric_version === version && r.scored_hash === descriptionHash(r.title, r.description))
    .slice(0, count);
  if (!roles.length) throw new Error('no roles with a current score');
  const systemFile = writeSystemPrompt();
  const batchSize = settings.scoring.batch_size;
  const pairs = [];
  let rejected = 0;
  for (let i = 0; i < roles.length; i += batchSize) {
    const batch = roles.slice(i, i + batchSize).map((r) => ({
      role_id: r.id, description_hash: r.scored_hash, employer: r.employer, title: r.title, grade: r.grade,
      family: r.family, tier: r.tier, location: r.location, description_available: r.description.length >= 200,
      description: /<[a-z][^>]*>/i.test(r.description) ? htmlToText(r.description) : r.description,
    }));
    const batchNo = i / batchSize + 1;
    const records = extractJsonArray((await scoreWithClaude(systemFile, buildRolesMessage(batch), { batchNo, roles: batch.length, shadow: true, models })).result);
    const byId = new Map(roles.map((r) => [r.id, r]));
    for (const rec of records) {
      const v = validateScoreRecord(rec);
      const role = v.ok && byId.get(v.value.role_id);
      if (!role) { rejected += 1; continue; }
      pairs.push({ role, before: role, after: v.value });
    }
  }
  const result = { model, effort, rubric_version: version, rejected, ...compareScores(pairs, settings.tailoring.min_fit_score) };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `shadow-${model}-${effort}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 1));
  console.log(`${model} (effort ${effort}): ${result.roles} roles compared (${rejected} rejected). Same qualification (RM >= ${settings.tailoring.min_fit_score}): `
    + `${(result.same_qualification * 100).toFixed(1)}%. Qualified before ${result.qualified_before}, now ${result.qualified_after}. `
    + `RM difference: mean ${result.mean_abs_fit_diff.toFixed(1)}, median ${result.median_abs_fit_diff}, shift ${result.mean_fit_shift.toFixed(1)}.`);
  result.changed_gate.forEach((r) => console.log(`  gate changed: role ${r.role_id} ${r.employer}, ${r.title}: ${r.before} -> ${r.after}`));
  console.log(`Details: ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('tools/shadow-score.js')) {
  main().catch((err) => { console.error(`Check run stopped: ${err.message}`); process.exitCode = 1; }).finally(() => closeDb().catch(() => {}));
}
