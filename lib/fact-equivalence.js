// A second reading of a failed career-ops fact check (verify-cv-facts.mjs).
// The checker already reads "six" as 6 and "1,000" as 1000. Two patterns
// still fail a true CV (2026-11-13):
//   - a count with words between the number and its noun in cv.md:
//     "eight enterprise (ACME) clients" gives the checker no claim, so a CV
//     that writes "8 enterprise clients" ("8 clients") has no source;
//   - a number with a thousands comma inside a "using ..." list: the checker
//     splits the list at commas, so "using A, B, and C, indexing 2,500+
//     documents" gives the tools "indexing 2" and "500+ documents".
// resolveFactFailures accepts a flagged claim only when cv.md says the same
// thing: the same number, the same noun within a few words, and (for a split
// list item) the other words too. Any other failure stays a failure, so this
// can only pass a CV whose every flagged claim is in cv.md.

const NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Words between a number and its noun in the source: "eight enterprise (ACME) clients".
const NOUN_WINDOW = 4;

// Lower case, numbers as digits, no thousands separators, words only.
export function normalizeForFacts(text) {
  return String(text || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .toLowerCase()
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](two|three|four|five|six|seven|eight|nine)\b/g,
      (_, tens, unit) => String(NUMBER_WORDS[tens] + NUMBER_WORDS[unit]))
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g'), (w) => String(NUMBER_WORDS[w]))
    .replace(/(\d)[,  ](?=\d{3}(?!\d))/g, '$1')
    .replace(/[^a-z0-9+%.\s-]/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// "clients" and "client", "indexing" and "indexed": the same word for this check.
const stem = (word) => word.replace(/(ing|ed|es|s)$/, '').slice(0, 6);
const sameWord = (a, b) => a === b || (a.length > 3 && b.length > 3 && stem(a) === stem(b));

// The source says the number, then the noun within NOUN_WINDOW words.
function sourceHasCount(tokens, number, noun) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].replace(/\+$/, '') !== number) continue;
    for (let j = i + 1; j <= Math.min(tokens.length - 1, i + NOUN_WINDOW + 1); j += 1) {
      if (sameWord(tokens[j], noun)) return true;
    }
  }
  return false;
}

// A count claim: "8 clients", "2500 documents", "2500+ documents".
function countOf(claim) {
  const m = /^(\d[\d.]*)\+?\s+([a-z][a-z-]*)$/.exec(normalizeForFacts(claim).join(' '));
  return m ? { number: m[1], noun: m[2] } : null;
}

// A list item rejoined at a thousands comma: every number is a count that
// the source has, and every other word is in the source.
function phraseInSource(phrase, tokens) {
  const words = normalizeForFacts(phrase);
  if (!words.some((w) => /^\d/.test(w))) return false;
  for (let i = 0; i < words.length; i += 1) {
    if (/^\d/.test(words[i])) {
      const noun = words[i + 1];
      if (!noun || !sourceHasCount(tokens, words[i].replace(/\+$/, ''), noun)) return false;
      i += 1;
    } else if (!tokens.some((t) => sameWord(t, words[i]))) {
      return false;
    }
  }
  return true;
}

// result: the checker's --json result (verify-cv-facts.mjs --json):
// { verdict, invented: [claim], unsupportedFacts: [{ kind, value }],
// forbidden, errors }. Returns { resolved, accepted: [text], remaining:
// [text] }. resolved: the checker failed only on claims that say what cv.md
// says. A forbidden phrase or an error is never resolved.
export function resolveFactFailures(result, sourceText) {
  const r = result || {};
  const tokens = normalizeForFacts(sourceText);
  const accepted = [];
  const remaining = [...(r.forbidden || []).map((f) => `forbidden: ${f}`), ...(r.errors || []).map((e) => `error: ${e}`)];
  for (const claim of r.invented || []) {
    const count = countOf(claim);
    (count && sourceHasCount(tokens, count.number, count.noun) ? accepted : remaining).push(String(claim));
  }
  const facts = r.unsupportedFacts || [];
  for (let i = 0; i < facts.length; i += 1) {
    const fact = facts[i];
    const text = `${fact.kind}: ${fact.value}`;
    const next = facts[i + 1];
    // "indexing 2" + "500+ documents": one list item that a comma split.
    if (fact.kind === 'tool' && next && next.kind === 'tool' && /\d{1,3}$/.test(fact.value) && /^\d{3}(?!\d)/.test(next.value)) {
      const phrase = `${fact.value},${next.value}`;
      (phraseInSource(phrase, tokens) ? accepted : remaining).push(text, `${next.kind}: ${next.value}`);
      i += 1;
      continue;
    }
    remaining.push(text);
  }
  return { resolved: accepted.length > 0 && remaining.length === 0, accepted, remaining };
}
