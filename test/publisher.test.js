import fs from 'fs';
import os from 'os';
import path from 'path';
import { publish } from '../lib/publisher.js';
import { descriptionHash, rubricVersion } from '../lib/scoring.js';
import { settings } from '../lib/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-'));
const db = await import('../lib/database.js');
db.useDatabasePath(path.join(dir, 'jobs.db'));
await db.initDb();
afterAll(() => db.closeDb());

const SLUG = 'nomura'; // any active employer in config/employers.json
const today = new Date().toISOString().slice(0, 10);
const role = (id, extra = {}) => ({
  external_job_id: id, title: `Role ${id}`, description: 'x'.repeat(1200), location: 'Mumbai', country: 'India', department: null,
  experience_level: 'lead', job_type: null, salary_range: null, posted_date: today, deadline: null,
  job_url: `https://x.example.com/job/${id}`, source_updated: null, grade: 'VP', family: 'Product', tier: 'target', tier_reason: null, ...extra,
});

describe('publish: the named states on each role', () => {
  let byJob;
  beforeAll(async () => {
    await db.syncRoles(SLUG, [role('p-1'), role('p-2'), role('p-3'), role('p-4'), role('p-5')]);
    const ids = {};
    (await db.getRolesForScoring()).forEach((r) => { ids[r.title.replace('Role ', '')] = r.id; });
    // p-1: no score. p-2: RM 80, no career-ops. p-3: RM 70. p-4: ready. p-5: failed twice.
    await db.upsertScore({ role_id: ids['p-2'], po_ats: 70, po_fit: 80, em_ats: 60, em_fit: 75, recommended: 'PO', ats_score: 70, fit_score: 80, reason: 'r', matched_keywords: [], gaps: [], confidence: 'high' },
      { scorer: 'test', rubricVersion: rubricVersion(), descriptionHash: descriptionHash('Role p-2', 'x'.repeat(1200)) });
    await db.upsertScore({ role_id: ids['p-3'], po_ats: 70, po_fit: 70, em_ats: 60, em_fit: 65, recommended: 'PO', ats_score: 70, fit_score: 70, reason: 'r', matched_keywords: [], gaps: [], confidence: 'high' },
      { scorer: 'test', rubricVersion: rubricVersion(), descriptionHash: descriptionHash('Role p-3', 'x'.repeat(1200)) });
    for (const j of ['p-4', 'p-5']) {
      await db.upsertScore({ role_id: ids[j], po_ats: 70, po_fit: 82, em_ats: 60, em_fit: 77, recommended: 'PO', ats_score: 70, fit_score: 82, reason: 'r', matched_keywords: [], gaps: [], confidence: 'high' },
        { scorer: 'test', rubricVersion: rubricVersion(), descriptionHash: descriptionHash(`Role ${j}`, 'x'.repeat(1200)) });
    }
    await db.upsertTailored({ role_id: ids['p-4'], description_hash: descriptionHash('Role p-4', 'x'.repeat(1200)), status: 'ready', score: 4.3, report_num: '001', folder: '/o/A/f', cv_file: 'cv.docx', gaps: [] });
    await db.upsertTailored({ role_id: ids['p-5'], description_hash: descriptionHash('Role p-5', 'x'.repeat(1200)), status: 'failed', error: 'x', attempts: settings.tailoring.max_attempts, gaps: [] });
    const outputPath = path.join(dir, 'roles.json');
    await publish({ outputPath });
    const payload = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    byJob = {};
    payload.roles.forEach((r) => { byJob[r.title.replace('Role ', '')] = r; });
    byJob.targeting = payload.targeting;
  });

  test('score_state: waiting, scored', () => {
    expect(byJob['p-1'].score_state).toBe('waiting');
    expect(byJob['p-2'].score_state).toBe('scored');
  });
  test('tailor_state: unscored, waiting, not eligible, ready, given up', () => {
    expect(byJob['p-1'].tailor_state).toMatchObject({ state: 'unscored', next: false });
    expect(byJob['p-2'].tailor_state).toMatchObject({ state: 'waiting', next: true, text: /RM 80 passes/ });
    expect(byJob['p-3'].tailor_state).toMatchObject({ state: 'not_eligible', next: false });
    expect(byJob['p-4'].tailor_state).toMatchObject({ state: 'ready' });
    expect(byJob['p-5'].tailor_state).toMatchObject({ state: 'given_up', next: false });
    // A failed run still shows no career-ops box (as before).
    expect(byJob['p-5'].tailor).toBeNull();
  });
  test('the raw tailored_docs columns stay out of the board file', () => {
    expect(byJob['p-4']).not.toHaveProperty('t_attempts');
    expect(byJob['p-4']).not.toHaveProperty('t_rerun');
  });
  test('targeting has the career-ops threshold and the counts by state', () => {
    expect(byJob.targeting).toHaveProperty('cv_min_score');
    expect(byJob.targeting.tailor_states).toMatchObject({ unscored: 1, waiting: 1, not_eligible: 1, ready: 1, given_up: 1 });
  });
});
