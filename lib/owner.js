// The owner's private CV data in config/private/ (gitignored, owner rule
// 2026-11-12: no CV facts in git): owner.json (the home city and the match
// patterns of the CV checks) and cv-rules.md (the CV rules with the real
// facts). When a private file is missing, its _example file is used, so a
// new checkout runs; `example` says so.
import fs from 'fs';

const DIR = new URL('../config/private/', import.meta.url);

function readPrivate(name) {
  const example = name.replace(/(\.\w+)$/, '_example$1');
  for (const file of [name, example]) {
    const url = new URL(file, DIR);
    if (fs.existsSync(url)) return { text: fs.readFileSync(url, 'utf-8'), example: file === example };
  }
  throw new Error(`config/private/${name} is missing (copy ${example} and write your own values)`);
}

const check = ({ name, pattern, flags = '', or_latest_bullet: orLatest = false }) => ({ name, re: new RegExp(pattern, flags), orLatest });

// owner.json, parsed: { home_city, keep, headline, accomplishments }.
export function parseOwner(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  const c = o.cv_checks || {};
  return {
    home_city: o.home_city || null,
    keep: c.keep ? new RegExp(c.keep) : null,
    headline: c.headline ? check(c.headline) : null,
    accomplishments: (c.accomplishments || []).map(check),
  };
}

let owner = null;
export function loadOwner() {
  if (!owner) {
    const { text, example } = readPrivate('owner.json');
    owner = { ...parseOwner(text), example };
  }
  return owner;
}

// The owner CV rules (cv-rules.md), added after config/tailoring-rules.md.
export function ownerRules() {
  return readPrivate('cv-rules.md');
}
