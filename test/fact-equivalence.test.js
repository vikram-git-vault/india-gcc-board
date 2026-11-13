import { normalizeForFacts, resolveFactFailures } from '../lib/fact-equivalence.js';

// Neutral example source (no owner facts).
const SOURCE = `
- Launched the data product in 2024 for eight enterprise (ACME) clients, an industry-first rollout.
- Built an assistant using Kafka and FastAPI, indexing 2,500+ enterprise documents.
- Led forty engineers across three teams.
<!-- note: 9 partners in a comment are not a source -->
`;
const block = (extra) => ({ verdict: 'block', invented: [], unsupportedFacts: [], forbidden: [], errors: [], ...extra });
const tool = (value) => ({ kind: 'tool', value });

describe('normalizeForFacts', () => {
  test('numbers as digits, no thousands comma, no comments', () => {
    expect(normalizeForFacts('Led forty-two engineers, 1,000+ docs <!-- 9 x -->')).toEqual(['led', '42', 'engineers', '1000+', 'docs']);
  });
});

describe('resolveFactFailures', () => {
  test('a count with words between the number and the noun in the source', () => {
    expect(resolveFactFailures(block({ invented: ['8 clients'] }), SOURCE)).toEqual({ resolved: true, accepted: ['8 clients'], remaining: [] });
    expect(resolveFactFailures(block({ invented: ['40 engineers'] }), SOURCE).resolved).toBe(true);
  });

  test('a list item split at a thousands comma', () => {
    const out = resolveFactFailures(block({ unsupportedFacts: [tool('indexing 2'), tool('500+ documents')] }), SOURCE);
    expect(out).toEqual({ resolved: true, accepted: ['tool: indexing 2', 'tool: 500+ documents'], remaining: [] });
  });

  test('a different number or noun stays a failure', () => {
    expect(resolveFactFailures(block({ invented: ['9 clients'] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ invented: ['8 partners'] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ invented: ['9 partners'] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ unsupportedFacts: [tool('indexing 3'), tool('500+ documents')] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ unsupportedFacts: [tool('crawling 2'), tool('500+ documents')] }), SOURCE).resolved).toBe(false);
  });

  test('a claim that is not a count, a real unknown tool, a forbidden phrase or an error stays a failure', () => {
    expect(resolveFactFailures(block({ invented: ['50%'] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ unsupportedFacts: [tool('snowpipe')] }), SOURCE).remaining).toEqual(['tool: snowpipe']);
    expect(resolveFactFailures(block({ invented: ['8 clients'], forbidden: ['rockstar'] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ invented: ['8 clients'], errors: ['bad file'] }), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(block({ unsupportedFacts: [{ kind: 'title', value: 'cto' }] }), SOURCE).resolved).toBe(false);
  });

  test('one unresolved claim fails the whole check; an empty result is not resolved', () => {
    const out = resolveFactFailures(block({ invented: ['8 clients', '9 clients'] }), SOURCE);
    expect(out).toEqual({ resolved: false, accepted: ['8 clients'], remaining: ['9 clients'] });
    expect(resolveFactFailures(block({}), SOURCE).resolved).toBe(false);
    expect(resolveFactFailures(null, SOURCE).resolved).toBe(false);
  });
});
