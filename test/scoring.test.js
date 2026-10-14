import { validateScoreRecord, descriptionHash, rubricVersion } from '../lib/scoring.js';

const good = () => ({
  role_id: 7,
  scores: { PO: { ats: 70, fit: 82 }, EM: { ats: 64, fit: 71 } },
  recommended: 'PO',
  reason: 'Data product ownership in custody matches; role is VP grade.',
  matched_keywords: ['Snowflake', 'data products'],
  gaps: ['Kafka'],
  confidence: 'high',
});

describe('validateScoreRecord', () => {
  test('a valid record normalizes to the recommended variant scores', () => {
    const r = validateScoreRecord(good());
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ role_id: 7, recommended: 'PO', ats_score: 70, fit_score: 82, po_fit: 82, em_fit: 71 });
  });

  test('recommended must be the variant with the higher fit', () => {
    const r = validateScoreRecord({ ...good(), recommended: 'EM' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/PO has the higher fit/);
  });

  test('a keyword or gap longer than 120 characters is rejected', () => {
    const r = validateScoreRecord({ ...good(), gaps: ['x'.repeat(121)] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/longer than 120/);
    expect(validateScoreRecord({ ...good(), matched_keywords: ['y'.repeat(120)] }).ok).toBe(true);
  });

  test('equal fit: the higher ATS wins', () => {
    const rec = { ...good(), scores: { PO: { ats: 60, fit: 80 }, EM: { ats: 65, fit: 80 } }, recommended: 'EM' };
    expect(validateScoreRecord(rec).ok).toBe(true);
  });

  test.each([
    ['score above 100', (r) => { r.scores.PO.fit = 101; }],
    ['non-integer score', (r) => { r.scores.EM.ats = 55.5; }],
    ['missing variant', (r) => { delete r.scores.EM; }],
    ['bad recommended', (r) => { r.recommended = 'XX'; }],
    ['empty reason', (r) => { r.reason = '  '; }],
    ['too many gaps', (r) => { r.gaps = ['a', 'b', 'c', 'd']; }],
    ['gaps not strings', (r) => { r.gaps = [1]; }],
    ['bad confidence', (r) => { r.confidence = 'medium'; }],
    ['string role_id', (r) => { r.role_id = '7'; }],
  ])('rejects %s', (_name, mutate) => {
    const rec = good();
    mutate(rec);
    expect(validateScoreRecord(rec).ok).toBe(false);
  });

  test('rejects non-objects', () => {
    expect(validateScoreRecord(null).ok).toBe(false);
  });
});

describe('descriptionHash', () => {
  test('changes when the description changes', () => {
    expect(descriptionHash('T', 'a')).not.toBe(descriptionHash('T', 'b'));
    expect(descriptionHash('T', 'a')).toBe(descriptionHash('T', 'a'));
  });
});

describe('rubricVersion', () => {
  test('reads the committed rubric', () => {
    expect(rubricVersion()).toBe(1);
  });
  test('throws without a version line', () => {
    expect(() => rubricVersion('# no version')).toThrow();
  });
});
