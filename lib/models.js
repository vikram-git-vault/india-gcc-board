// Model router: every Claude call of the board goes through claudeCall().
// Each call names a stage; the stage selects the model (settings.models).
// Scoring stages use models.scoring (Sonnet); the stages that write the
// application documents use models.documents (Opus). Refresh has no stage:
// it never calls Claude. See docs/ARCHITECTURE.md §17.
import { settings } from './settings.js';

export const CLAUDE_BIN = 'claude';

// stage -> settings.models key
export const STAGES = {
  // RM scoring on Opus (models.rm): Sonnet scored ~7 points lower and
  // missed qualifying roles in the check run (2026-11-04).
  rm_score: 'rm',
  careerops_score: 'scoring',
  resume_tailoring: 'documents',
  cover_letter: 'documents',
  ats_optimization: 'documents',
  // One worker makes the CV, the ATS headline and the cover letter.
  application_package: 'documents',
};

// stage -> settings.models key of its effort level (claude --effort).
// A stage without one uses the Claude Code default.
export const EFFORT = {
  rm_score: 'rm_effort',
};

export function effortFor(stage, models = settings.models) {
  return EFFORT[stage] ? models[EFFORT[stage]] || null : null;
}

export function modelFor(stage, models = settings.models) {
  const key = STAGES[stage];
  if (!key) throw new Error(`unknown model stage "${stage}"`);
  return models[key];
}

// The command for one headless call. The JSON reply carries the token use
// of each model (usageFromEnvelope).
export function claudeCall(stage, args = [], models = settings.models) {
  const effort = effortFor(stage, models);
  return {
    cmd: CLAUDE_BIN,
    args: ['-p', '--model', modelFor(stage, models), ...(effort ? ['--effort', effort] : []), '--output-format', 'json', ...args],
  };
}

// Token use of one reply (claude -p --output-format json). Claude Code can
// use more than one model in a call; the totals include all of them.
export function usageFromEnvelope(envelope) {
  const per = (envelope && envelope.modelUsage) || {};
  const sum = (key) => Object.values(per).reduce((n, m) => n + (Number(m[key]) || 0), 0);
  return {
    models: Object.keys(per),
    input_tokens: sum('inputTokens'),
    output_tokens: sum('outputTokens'),
    cache_read_tokens: sum('cacheReadInputTokens'),
    cache_write_tokens: sum('cacheCreationInputTokens'),
    // The list-price value. With a Claude subscription nothing is billed
    // per call; the value compares the use of the stages.
    cost_usd: Number(envelope && envelope.total_cost_usd) || sum('costUSD'),
    duration_ms: Number(envelope && envelope.duration_ms) || null,
    turns: Number(envelope && envelope.num_turns) || null,
  };
}

// The reply envelope from stdout, or null (a stopped or failed call).
export function parseEnvelope(stdout) {
  try {
    const value = JSON.parse(String(stdout || '').trim());
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// The routing log line of one call.
export function routeLine(stage, model, usage) {
  if (!usage) return `${stage} -> ${model}: no usage (the call did not finish)`;
  const used = usage.models.length ? usage.models.join(', ') : 'unknown';
  return `${stage} -> ${model} (used: ${used}; ${k(usage.input_tokens)} in, ${k(usage.output_tokens)} out, `
    + `${k(usage.cache_read_tokens)} cache read, ${k(usage.cache_write_tokens)} cache write; $${usage.cost_usd.toFixed(3)} list`
    + `${usage.duration_ms ? `; ${Math.round(usage.duration_ms / 1000)}s` : ''})`;
}

// The usage page and report (server.js /api/usage, tools/usage-report.js):
// rows of getModelUsage().byStage, combined for each stage and model.
// compliant: calls in which Claude Code used the model the router asked
// for. per_role: the average for one role, to compare models and prompts.
export function summarizeUsage(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.stage}|${r.model}|${r.shadow ? 1 : 0}`;
    const g = groups.get(key) || {
      stage: r.stage, model: r.model, shadow: !!r.shadow, calls: 0, ok_calls: 0, roles: 0, compliant: 0,
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, duration_ms: 0,
    };
    let used = [];
    try { used = JSON.parse(r.used_models || '[]'); } catch { /* old row */ }
    if (used.includes(r.model)) g.compliant += r.calls;
    for (const f of ['calls', 'ok_calls', 'roles', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'duration_ms']) {
      g[f] += Number(r[f]) || 0;
    }
    groups.set(key, g);
  }
  const stages = [...groups.values()].map((g) => {
    const tokens = g.input_tokens + g.output_tokens + g.cache_read_tokens + g.cache_write_tokens;
    const n = g.roles || 1;
    return {
      ...g,
      tokens,
      per_role: { tokens: Math.round(tokens / n), cost_usd: g.cost_usd / n, seconds: g.duration_ms / 1000 / n },
    };
  });
  const live = stages.filter((s) => !s.shadow);
  const sum = (list, f) => list.reduce((n, s) => n + s[f], 0);
  const scoring = live.filter((s) => ['rm', 'scoring'].includes(STAGES[s.stage]));
  const scoringOnSonnet = sum(scoring.filter((s) => /sonnet/.test(s.model)), 'calls');
  return {
    stages,
    totals: {
      calls: sum(live, 'calls'), tokens: sum(live, 'tokens'), cost_usd: sum(live, 'cost_usd'),
      routing_compliance: sum(live, 'calls') ? sum(live, 'compliant') / sum(live, 'calls') : null,
      scoring_on_sonnet: sum(scoring, 'calls') ? scoringOnSonnet / sum(scoring, 'calls') : null,
    },
  };
}
