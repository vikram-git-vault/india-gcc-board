import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  newCheckpoint, loadCheckpoint, saveCheckpoint, resumableCheckpoint, recordEmployer, pendingEmployers, summarizeCheckpoint,
} from '../lib/checkpoint.js';

const employers = [
  { id: 'a', name: 'Alpha', active: true },
  { id: 'b', name: 'Beta', active: true },
  { id: 'c', name: 'Gamma', active: true },
  { id: 'd', name: 'Delta', active: false },
];
const start = '2026-10-14T00:30:00.000Z';

describe('save and load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
  const file = path.join(dir, 'refresh-checkpoint.json');

  test('round trip, no temporary file left', () => {
    const cp = recordEmployer(newCheckpoint('run1', start), 'a', { status: 'ok', count: 3 }, new Date(start));
    saveCheckpoint(cp, file);
    expect(loadCheckpoint(file)).toEqual(cp);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  test('missing or damaged file gives null', () => {
    expect(loadCheckpoint(path.join(dir, 'none.json'))).toBeNull();
    fs.writeFileSync(file, '{"run_id": "x", "employ');
    expect(loadCheckpoint(file)).toBeNull();
    fs.writeFileSync(file, '{"run_id": "x"}');
    expect(loadCheckpoint(file)).toBeNull();
  });
});

describe('resumableCheckpoint', () => {
  const cp = newCheckpoint('run1', start);
  test('unfinished and recent: resume', () => {
    expect(resumableCheckpoint(cp, new Date('2026-10-14T03:00:00Z'))).toBe(cp);
  });
  test('older than 12 hours, finished, from the future or missing: start fresh', () => {
    expect(resumableCheckpoint(cp, new Date('2026-10-14T12:31:00Z'))).toBeNull();
    expect(resumableCheckpoint({ ...cp, completed_at: '2026-10-14T01:00:00Z' }, new Date('2026-10-14T02:00:00Z'))).toBeNull();
    expect(resumableCheckpoint(cp, new Date('2026-10-14T00:00:00Z'))).toBeNull();
    expect(resumableCheckpoint(null)).toBeNull();
  });
});

describe('pendingEmployers', () => {
  test('skips ok employers; failed and unfinished ones run again; inactive never', () => {
    const cp = newCheckpoint('run1', start);
    recordEmployer(cp, 'a', { status: 'ok', count: 2 });
    recordEmployer(cp, 'b', { status: 'error', error: 'timeout' });
    expect(pendingEmployers(cp, employers).map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('summarizeCheckpoint', () => {
  test('partial run', () => {
    const cp = newCheckpoint('run1', start);
    recordEmployer(cp, 'a', { status: 'ok', count: 2 });
    recordEmployer(cp, 'b', { status: 'error', error: 'timeout' });
    expect(summarizeCheckpoint(cp, employers)).toEqual({
      complete: false, started_at: start, completed_at: null, total: 3, refreshed: 1, failed: ['Beta'],
    });
  });
  test('complete run; employers no longer active do not count', () => {
    const cp = newCheckpoint('run1', start);
    ['a', 'b', 'c', 'd'].forEach((id) => recordEmployer(cp, id, { status: 'ok', count: 1 }));
    cp.completed_at = '2026-10-14T01:30:00.000Z';
    expect(summarizeCheckpoint(cp, employers)).toMatchObject({ complete: true, total: 3, refreshed: 3, failed: [] });
  });
  test('no checkpoint', () => {
    expect(summarizeCheckpoint(null, employers)).toBeNull();
  });
});
