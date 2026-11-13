// Finds the owner's personal facts in text that is about to go into git
// (tools/check-private.js, the hooks in .githooks/). The facts come from the
// gitignored files only, so the committed code holds none of them:
//   - the career-ops master CV (cv.md): the name, the email addresses, the
//     phone number, the LinkedIn name and the employers ("### Employer -- City");
//   - config/private/owner.json: excluded_employers;
//   - config/private/private-terms.txt: one more word or phrase on each line
//     (award and project names, CV numbers). Lines that start with # are notes.
// With none of these files (a fresh clone) the list is empty and every check
// passes.

const MIN_LENGTH = 4;

// Files that never go into git, also with `git add -f`.
const BLOCKED_PATHS = [
  [/^Resume\//, 'the resume folder'],
  [/^config\/private\/(?!.*_example\.)/, 'a private config file (only *_example.* files are committed)'],
  [/\.(docx?|pdf|pptx?|xlsx?)$/i, 'an Office or PDF file (CVs and cover letters)'],
  [/(^|\/)\.env(\.|$)(?!example$)/, 'an environment file with secrets'],
  [/^data\/.*\.(db|sqlite3?)(-journal)?$/, 'the database'],
  [/^data\/roles\.json/, 'the board file'],
  [/^logs\/(?!\.gitkeep$).+/, 'a log file'],
];

export function blockedPath(file) {
  const hit = BLOCKED_PATHS.find(([re]) => re.test(file));
  return hit ? hit[1] : null;
}

const digits = (s) => String(s).replace(/\D/g, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// [{ term, source, kind }]. kind 'phone' matches the digits only.
export function collectTerms({ cvText = '', owner = null, termsText = '' } = {}) {
  const out = [];
  const add = (term, source, kind = 'text') => {
    const t = String(term || '').trim();
    if (kind === 'phone' ? digits(t).length >= 8 : t.length >= MIN_LENGTH) out.push({ term: t, source, kind });
  };
  const name = /^#\s*CV\s*[-–—]+\s*(.+)$/m.exec(cvText);
  if (name) add(name[1], 'cv.md name');
  (cvText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).forEach((e) => add(e, 'cv.md email'));
  const phone = /\*\*Phone:\*\*\s*([+\d][\d\s().-]{7,})/.exec(cvText);
  if (phone) add(digits(phone[1]).slice(-10), 'cv.md phone', 'phone');
  const linkedin = /linkedin\.com\/in\/([A-Za-z0-9_-]+)/i.exec(cvText);
  if (linkedin) add(`linkedin.com/in/${linkedin[1]}`, 'cv.md LinkedIn');
  for (const m of cvText.matchAll(/^###\s+(.+?)\s+[-–—]{1,2}\s+.+$/gm)) add(m[1], 'cv.md employer');
  ((owner && owner.excluded_employers) || []).forEach((e) => add(e, 'owner.json excluded_employers'));
  termsText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((l) => add(l, 'private-terms.txt'));
  const seen = new Set();
  return out.filter((t) => { const k = `${t.kind}:${t.term.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function matcher({ term, kind }) {
  if (kind === 'phone') return (text) => digits(text).includes(term);
  // Whole words only, so a short name does not match inside a longer word.
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'i');
  return (text) => re.test(text);
}

// The report never repeats the fact: the first two characters and the length.
export function maskTerm(term) {
  return `"${term.slice(0, 2)}…" (${term.length} characters)`;
}

// lines: [{ file, line, text }]. Returns [{ file, line, term, source }].
export function findLeaks(lines, terms) {
  const tests = terms.map((t) => ({ ...t, test: matcher(t) }));
  const out = [];
  for (const l of lines) {
    for (const t of tests) {
      if (t.test(l.text)) out.push({ file: l.file, line: l.line, term: t.term, source: t.source });
    }
  }
  return out;
}

// The added lines of a unified diff (git diff -U0): [{ file, line, text }].
export function addedLines(diff) {
  const out = [];
  let file = null;
  let line = 0;
  for (const raw of String(diff).split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.slice(4).replace(/^b\//, '');
    } else if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw);
      line = m ? Number(m[1]) : 0;
    } else if (file && raw.startsWith('+')) {
      out.push({ file, line, text: raw.slice(1) });
      line += 1;
    } else if (file && raw.startsWith(' ')) {
      line += 1;
    }
  }
  return out;
}
