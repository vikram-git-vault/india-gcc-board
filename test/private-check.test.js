import { addedLines, blockedPath, collectTerms, findLeaks, maskTerm } from '../lib/private-check.js';

// Made-up owner facts (no real data).
const CV = `# CV -- Jane Q Example

**Location:** Pune, India
**Email:** jane.q@example.net
**Phone:** +91 98765 43210
**LinkedIn:** linkedin.com/in/janeqx

## Work Experience

### Acme Holdings -- Pune

### Globex Systems -- Pune
`;
const terms = collectTerms({ cvText: CV, owner: { excluded_employers: ['Acme'] }, termsText: '# a note\nProject Bluebird\nab\n' });
const lines = (...texts) => texts.map((text, i) => ({ file: 'f.js', line: i + 1, text }));

describe('collectTerms', () => {
  test('the name, email, phone, LinkedIn, employers and the private list; no notes or short words', () => {
    expect(terms.map((t) => t.term)).toEqual([
      'Jane Q Example', 'jane.q@example.net', '9876543210', 'linkedin.com/in/janeqx',
      'Acme Holdings', 'Globex Systems', 'Acme', 'Project Bluebird',
    ]);
  });
  test('no private files: no terms, so every check passes', () => {
    expect(collectTerms({})).toEqual([]);
    expect(findLeaks(lines('anything'), collectTerms({}))).toEqual([]);
  });
});

describe('findLeaks', () => {
  test('finds each fact, in any case, and the phone with other spacing', () => {
    const out = findLeaks(lines('by JANE Q EXAMPLE', 'call 98765-43210', 'see project bluebird', 'worked at Acme.'), terms);
    expect(out.map((l) => [l.line, l.source])).toEqual([
      [1, 'cv.md name'], [2, 'cv.md phone'], [3, 'private-terms.txt'], [4, 'owner.json excluded_employers'],
    ]);
  });
  test('whole words only: no match inside a longer word or a hash', () => {
    expect(findLeaks(lines('const acmeLoader = 1;', 'sha512-xAcmex==', 'Pune is a hub city'), terms)).toEqual([]);
  });
  test('the report does not repeat the fact', () => {
    expect(maskTerm('Project Bluebird')).toBe('"Pr…" (16 characters)');
  });
});

describe('blockedPath', () => {
  test('private files are blocked; code, examples and placeholders are not', () => {
    ['Resume/cv.md', 'config/private/owner.json', 'config/private/private-terms.txt', 'out/cv.docx', 'a/b.pdf',
      '.env', '.env.local', 'data/jobs.db', 'data/roles.json', 'logs/combined.log'].forEach((f) => expect(blockedPath(f)).toBeTruthy());
    ['lib/a.js', 'config/private/owner_example.json', 'config/private/private-terms_example.txt', '.env.example', 'logs/.gitkeep', 'data/.gitkeep']
      .forEach((f) => expect(blockedPath(f)).toBeNull());
  });
});

describe('addedLines', () => {
  test('the added lines with their file and line number', () => {
    const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -3,0 +4,2 @@', '+one', '+two',
      '--- a/y.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n');
    expect(addedLines(diff)).toEqual([{ file: 'x.js', line: 4, text: 'one' }, { file: 'x.js', line: 5, text: 'two' }]);
  });
});
