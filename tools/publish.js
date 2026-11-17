#!/usr/bin/env node
/**
 * tools/publish.js — write data/roles.json again from the database.
 *
 *   node tools/publish.js
 *
 * Use it when tools/board-status.js says that the board file does not match
 * the database. The refresh, the scoring and the tailoring runs publish
 * automatically; this command only repairs the file. It does not scrape,
 * score or call Claude.
 */
import { initDb, closeDb } from '../lib/database.js';
import { publish } from '../lib/publisher.js';

// The schema first: a new column (for example tailored_docs.cv_warning)
// must be there before the publisher reads it.
await initDb();
const { rolesWritten, outputPath } = await publish();
console.log(`Wrote ${rolesWritten} roles to ${outputPath}.`);
await closeDb();
