#!/usr/bin/env node
/**
 * tools/add-job.js — add a job by hand: a link, a file with the job text,
 * or both (the same as the board's "Add a job" form).
 *
 *   node tools/add-job.js --url <job link> [--file jd.md] [--company NAME] [--title TITLE] [--location CITY]
 *
 * The board reads a Workday link with the Workday job API, and other links
 * from the job data in the page. When it cannot, give the text with --file.
 * The command adds the role and updates the board. It does not score it:
 * run `node autoscore.js`, then `node tailor.js --role ID` (the /tailor-role
 * skill does this). A job with the same link as a board role is not added
 * again; the command prints that role.
 */
import fs from 'fs';
import { initDb, closeDb } from '../lib/database.js';
import { addManualJob } from '../lib/manual-job.js';
import { publish } from '../lib/publisher.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? '' : String(args[i + 1] || ''); };
if (!opt('--url') && !opt('--file')) {
  console.error('Usage: node tools/add-job.js --url <job link> [--file jd.md] [--company NAME] [--title TITLE] [--location CITY]');
  process.exit(1);
}

try {
  await initDb();
  const added = await addManualJob({
    url: opt('--url'),
    text: opt('--file') ? fs.readFileSync(opt('--file'), 'utf-8') : '',
    company: opt('--company'), title: opt('--title'), location: opt('--location'),
  });
  if (added.error) {
    console.log(`NOT ADDED: ${added.error}.`);
    if (added.job && (added.job.company || added.job.title)) {
      console.log(`Found in the link: ${added.job.company || 'no company'}, ${added.job.title || 'no title'}, ${added.job.location || 'no city'}`);
    }
    process.exitCode = 2;
  } else if (!added.created) {
    console.log(`ALREADY ON THE BOARD: role ${added.roleId}. Use node tools/find-role.js ${added.roleId}`);
  } else {
    await publish();
    console.log(`ADDED: role ${added.roleId}: ${added.job.company}, ${added.job.title} (${added.job.location || 'no city'}); text from ${added.via}, ${added.job.text.length} characters`);
    console.log(`Next: node autoscore.js, then node tailor.js --role ${added.roleId}`);
  }
} finally {
  await closeDb();
}
