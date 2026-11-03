// Keeps the career-ops tracker (data/applications.md in the career-ops
// folder) in step with the board marks: Applied, Rejected and Closed on the
// board set the status of the role's tracker row (lib/tailoring.js
// trackerStatus). career-ops' own set-status.mjs writes the row.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getTailored, getMark, setTrackerStatus } from './database.js';
import { trackerStatus } from './tailoring.js';

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEPARATOR = '|---|------|---------|------|-------|--------|-----|--------|-------|';

// career-ops merges new rows only into an existing tracker file.
export function ensureTracker(careerOpsDir) {
  const file = path.join(careerOpsDir, 'data', 'applications.md');
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Applications Tracker\n\n${HEADER}\n${SEPARATOR}\n`);
  return true;
}

function setStatus(careerOpsDir, reportNum, status) {
  return new Promise((resolve) => {
    execFile('node', ['set-status.mjs', '--report', String(Number(reportNum)), status, '--force', '--note', 'set from the job board'],
      { cwd: careerOpsDir, timeout: 60000 },
      (err, stdout, stderr) => resolve({ ok: !err, output: `${stdout}${stderr}`.trim().slice(-300) }));
  });
}

// Writes the tracker status for the role's current mark when it differs
// from the last one written. previous: the tracker status before the mark
// was removed (the marks row is gone then). Returns what it did.
export async function syncTracker(careerOpsDir, roleId, { previous = null } = {}) {
  const tailored = await getTailored(roleId);
  if (!tailored || !tailored.report_num || tailored.status === 'failed') return 'no career-ops report';
  const mark = await getMark(roleId);
  const want = trackerStatus(mark ? mark.status : null);
  const have = mark ? mark.tracker_status || 'Evaluated' : previous || 'Evaluated';
  if (want === have) return 'no change';
  const result = await setStatus(careerOpsDir, tailored.report_num, want);
  if (!result.ok) throw new Error(`set-status.mjs: ${result.output}`);
  if (mark) await setTrackerStatus(roleId, want);
  return `tracker row of report ${tailored.report_num}: ${want}`;
}
