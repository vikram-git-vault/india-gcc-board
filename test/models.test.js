import fs from 'fs';
import path from 'path';
import { STAGES, modelFor, claudeCall, usageFromEnvelope, parseEnvelope, routeLine, summarizeUsage, CLAUDE_BIN } from '../lib/models.js';

const models = { rm: 'claude-opus-5-5', rm_effort: 'medium', scoring: 'claude-sonnet-5-5', documents: 'claude-opus-5-5' };

describe('model routing', () => {
  test.each([
    ['rm_score', 'claude-opus-5-5'],
    ['careerops_score', 'claude-sonnet-5-5'],
    ['resume_tailoring', 'claude-opus-5-5'],
    ['cover_letter', 'claude-opus-5-5'],
    ['ats_optimization', 'claude-opus-5-5'],
    ['application_package', 'claude-opus-5-5'],
  ])('%s -> %s', (stage, model) => {
    expect(modelFor(stage, models)).toBe(model);
    const call = claudeCall(stage, ['--tools', ''], models);
    expect(call.cmd).toBe(CLAUDE_BIN);
    const effort = stage === 'rm_score' ? ['--effort', 'medium'] : [];
    expect(call.args.slice(0, 5 + effort.length)).toEqual(['-p', '--model', model, ...effort, '--output-format', 'json']);
  });
  test('an unknown stage is an error, not a default model', () => {
    expect(() => modelFor('refresh', models)).toThrow('unknown model stage');
  });
  test('the default settings route scoring to Sonnet and documents to Opus', () => {
    expect(modelFor('rm_score')).toMatch(/opus/);
    expect(modelFor('careerops_score')).toMatch(/sonnet/);
    expect(modelFor('application_package')).toMatch(/opus/);
  });
  test('every stage has a model', () => {
    Object.keys(STAGES).forEach((s) => expect(modelFor(s, models)).toBeTruthy());
  });
});

describe('every Claude call goes through the router', () => {
  const root = path.resolve('.');
  const sources = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (['node_modules', '.git', '.cache', 'test', 'data', 'Resume', 'logs'].includes(e.name)) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(e.name)) sources.push(p);
  });
  walk(root);
  test.each(sources.map((s) => [path.relative(root, s)]))('%s starts no claude process itself', (file) => {
    if (file === path.join('lib', 'models.js')) return;
    const text = fs.readFileSync(file, 'utf-8');
    expect(text).not.toMatch(/(spawn|run|execFile|exec)\(\s*['"`]claude['"`]/);
    expect(text).not.toMatch(/['"`]claude['"`]\s*,\s*\[/);
  });
  test('refresh does not use the router (no Claude tokens)', () => {
    ['refresh.js', 'lib/descriptions.js', 'discover.js'].forEach((f) => {
      expect(fs.readFileSync(f, 'utf-8')).not.toMatch(/models\.js|claudeCall/);
    });
  });
});

describe('usage', () => {
  const envelope = {
    total_cost_usd: 0.25, duration_ms: 64000, num_turns: 3, session_id: 's',
    modelUsage: {
      'claude-sonnet-5-5': { inputTokens: 10, outputTokens: 2000, cacheReadInputTokens: 40000, cacheCreationInputTokens: 9000, costUSD: 0.2 },
      'claude-haiku-5-5': { inputTokens: 5, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
    },
  };
  test('sums every model of the call', () => {
    expect(usageFromEnvelope(envelope)).toEqual({
      models: ['claude-sonnet-5-5', 'claude-haiku-5-5'], input_tokens: 15, output_tokens: 2050,
      cache_read_tokens: 40000, cache_write_tokens: 9000, cost_usd: 0.25, duration_ms: 64000, turns: 3,
    });
  });
  test('parseEnvelope: JSON object or null', () => {
    expect(parseEnvelope(JSON.stringify(envelope)).session_id).toBe('s');
    expect(parseEnvelope('Killed')).toBeNull();
    expect(parseEnvelope('[1]')).toBeNull();
  });
  test('routeLine', () => {
    expect(routeLine('rm_score', 'claude-sonnet-5-5', usageFromEnvelope(envelope)))
      .toBe('rm_score -> claude-sonnet-5-5 (used: claude-sonnet-5-5, claude-haiku-5-5; 15 in, 2.0k out, 40.0k cache read, 9.0k cache write; $0.250 list; 64s)');
    expect(routeLine('rm_score', 'm', null)).toMatch(/no usage/);
  });
});

describe('summarizeUsage', () => {
  const rows = [
    { stage: 'rm_score', model: 'claude-sonnet-5-5', shadow: 0, used_models: '["claude-sonnet-5-5"]', calls: 4, ok_calls: 4, roles: 40, input_tokens: 400, output_tokens: 40000, cache_read_tokens: 100000, cache_write_tokens: 20000, cost_usd: 2, duration_ms: 240000 },
    { stage: 'rm_score', model: 'claude-opus-5-5', shadow: 1, used_models: '["claude-opus-5-5"]', calls: 1, ok_calls: 1, roles: 10, input_tokens: 100, output_tokens: 10000, cache_read_tokens: 0, cache_write_tokens: 30000, cost_usd: 1.5, duration_ms: 70000 },
    { stage: 'application_package', model: 'claude-opus-5-5', shadow: 0, used_models: '["claude-sonnet-5-5"]', calls: 1, ok_calls: 1, roles: 1, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, duration_ms: 0 },
  ];
  const s = summarizeUsage(rows);
  test('per role values for each stage and model', () => {
    const sonnet = s.stages.find((x) => x.model === 'claude-sonnet-5-5');
    expect(sonnet.per_role.tokens).toBe(4010);
    expect(sonnet.per_role.cost_usd).toBeCloseTo(0.05);
  });
  test('shadow runs are not in the totals', () => {
    expect(s.totals.calls).toBe(5);
    expect(s.totals.scoring_on_sonnet).toBe(1);
  });
  test('a call that did not use the routed model lowers compliance', () => {
    expect(s.totals.routing_compliance).toBeCloseTo(4 / 5);
  });
});
