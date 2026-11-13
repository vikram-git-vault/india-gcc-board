#!/usr/bin/env node
/**
 * tools/check-private.js — stops the owner's personal facts from going into git.
 *
 *   node tools/check-private.js               the staged changes (pre-commit hook)
 *   node tools/check-private.js --message F   a commit message file (commit-msg hook)
 *   node tools/check-private.js --push REMOTE the commits that are not on REMOTE (pre-push hook)
 *   node tools/check-private.js --all         every tracked file
 *   node tools/check-private.js --history     every commit, all branches
 *
 * The facts come from the gitignored files (lib/private-check.js). The hooks
 * in .githooks/ run it; `npm install` sets core.hooksPath (the "prepare"
 * script). Exit code 1 when it finds a fact or a blocked file. A false alarm:
 * remove the line from config/private/private-terms.txt. Do not use
 * --no-verify: the pre-push hook checks the commits again.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { settings } from '../lib/settings.js';
import { expandHome } from '../lib/tailoring.js';
import { addedLines, blockedPath, collectTerms, findLeaks, maskTerm } from '../lib/private-check.js';

const read = (file) => { try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; } };
const git = (...args) => execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });

let owner = null;
try { owner = JSON.parse(read(path.join('config', 'private', 'owner.json'))); } catch { /* no owner file */ }
const terms = collectTerms({
  cvText: read(path.join(expandHome(settings.tailoring.career_ops_dir), 'cv.md')),
  owner,
  termsText: read(path.join('config', 'private', 'private-terms.txt')),
});

const args = process.argv.slice(2);
const problems = [];
const report = (where, leaks) => leaks.forEach((l) => problems.push(`${where(l)}: ${maskTerm(l.term)} from ${l.source}`));
const checkPaths = (files, where) => files.filter(Boolean).forEach((f) => {
  const why = blockedPath(f);
  if (why) problems.push(`${where}${f}: ${why}`);
});

if (args.includes('--message')) {
  const file = args[args.indexOf('--message') + 1];
  const lines = read(file).split('\n').filter((t) => !t.startsWith('#')).map((text, i) => ({ file: 'commit message', line: i + 1, text }));
  report((l) => `${l.file}:${l.line}`, findLeaks(lines, terms));
} else if (args.includes('--push')) {
  const remote = args[args.indexOf('--push') + 1] || 'origin';
  const commits = git('rev-list', 'HEAD', '--branches', '--not', `--remotes=${remote}`).split('\n').filter(Boolean);
  for (const sha of commits) {
    const short = sha.slice(0, 7);
    checkPaths(git('show', '--first-parent', '-m', '--format=', '--name-only', '--diff-filter=ACR', sha).split('\n'), `${short} `);
    report((l) => `${short} ${l.file}:${l.line}`, findLeaks(addedLines(git('show', '--first-parent', '-m', '--format=', '-U0', '--no-color', sha)), terms));
    const msg = git('log', '-1', '--format=%B', sha).split('\n').map((text, i) => ({ file: 'commit message', line: i + 1, text }));
    report((l) => `${short} ${l.file}:${l.line}`, findLeaks(msg, terms));
  }
} else if (args.includes('--all')) {
  const files = git('ls-files').split('\n').filter(Boolean);
  checkPaths(files, '');
  for (const file of files) {
    const text = read(file);
    if (text.includes('\0')) continue;
    report((l) => `${l.file}:${l.line}`, findLeaks(text.split('\n').map((t, i) => ({ file, line: i + 1, text: t })), terms));
  }
} else if (args.includes('--history')) {
  for (const t of terms) {
    const pattern = t.kind === 'phone' ? t.term.split('').join('[^0-9]{0,2}') : t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // git -G finds the candidates; findLeaks then checks whole words (a hash
    // in package-lock.json can hold the letters of a short term).
    const hits = git('log', '--all', '--format=%h', '-i', '-G', pattern).split('\n').filter(Boolean)
      .filter((sha) => findLeaks(addedLines(git('show', '--first-parent', '-m', '--format=', '-U0', '--no-color', sha)), [t]).length);
    if (hits.length) problems.push(`${maskTerm(t.term)} from ${t.source}: in ${hits.length} commit(s): ${hits.slice(0, 5).join(' ')}`);
  }
} else {
  checkPaths(git('diff', '--cached', '--name-only', '--diff-filter=ACR').split('\n'), '');
  report((l) => `${l.file}:${l.line}`, findLeaks(addedLines(git('diff', '--cached', '-U0', '--no-color')), terms));
}

if (problems.length) {
  console.error(`check-private: personal data found (${problems.length}). Nothing was committed or pushed.`);
  problems.slice(0, 50).forEach((p) => console.error(`- ${p}`));
  console.error('Remove it, then try again. A false alarm: remove that line from config/private/private-terms.txt.');
  process.exit(1);
}
if (args.includes('--all') || args.includes('--history')) console.log(`check-private: no personal data found (${terms.length} words and phrases checked).`);
