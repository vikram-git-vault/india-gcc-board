import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import axios from 'axios';
import { execFile } from 'child_process';
import { publish } from '../lib/publisher.js';
import { saveCheckpoint, CHECKPOINT_PATH } from '../lib/checkpoint.js';
import { createLogger } from '../lib/logger.js';

// test/setup/live-guard.cjs: a test may write only inside os.tmpdir().
const BOARD_FILE = path.join('data', 'roles.json');
const LIVE_FILES = [BOARD_FILE, CHECKPOINT_PATH, path.join('data', 'jobs.db'), path.join('logs', 'combined.log')];
const fingerprint = () => LIVE_FILES.map((f) => { try { const s = fs.statSync(f); return `${f}:${s.size}:${s.mtimeMs}`; } catch { return `${f}:none`; } });
let before;
beforeAll(() => { before = fingerprint(); });
afterAll(() => { expect(fingerprint()).toEqual(before); });

describe('live-guard', () => {
  test('the publisher with its default path cannot replace the live board file (2026-11-13)', async () => {
    await expect(publish()).rejects.toMatchObject({ code: 'ELIVEGUARD' });
  });

  test('the default checkpoint path is blocked; a temporary path works', () => {
    expect(() => saveCheckpoint({ employers: {} })).toThrow(/live-guard/);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')), 'cp.json');
    saveCheckpoint({ employers: {} }, file);
    expect(fs.existsSync(file)).toBe(true);
  });

  test('sync, callback, promise and stream writes outside the temporary folder fail', async () => {
    const target = path.join('data', 'guard-test.tmp');
    expect(() => fs.writeFileSync(target, 'x')).toThrow(/live-guard/);
    expect(() => fs.mkdirSync(path.join('data', 'guard-dir'))).toThrow(/live-guard/);
    expect(() => fs.renameSync(path.join(os.tmpdir(), 'nothing'), target)).toThrow(/live-guard/);
    expect(() => fs.openSync(target, 'a')).toThrow(/live-guard/);
    expect(() => fs.createWriteStream(target)).toThrow(/live-guard/);
    await expect(fsp.writeFile(target, 'x')).rejects.toMatchObject({ code: 'ELIVEGUARD' });
    await expect(new Promise((resolve) => fs.appendFile(target, 'x', resolve))).resolves.toMatchObject({ code: 'ELIVEGUARD' });
    expect(fs.existsSync(target)).toBe(false);
  });

  test('reading a live file is allowed', () => {
    expect(() => fs.readFileSync('package.json', 'utf-8')).not.toThrow();
    expect(() => fs.closeSync(fs.openSync('package.json', 'r'))).not.toThrow();
  });

  test('a write open of a live SQLite file fails; read-only and temporary files work', (done) => {
    expect(() => new sqlite3.Database(path.join('data', 'jobs.db'))).toThrow(/live-guard/);
    const tmp = new sqlite3.Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')), 'x.db'));
    expect(tmp).toBeInstanceOf(sqlite3.Database);
    const ro = new sqlite3.Database('package.json', sqlite3.OPEN_READONLY, () => {
      ro.close();
      tmp.close(done);
    });
  });

  test('child processes are blocked', () => {
    expect(() => execFile('node', ['refresh.js'])).toThrow(/child process/);
  });

  test('a request to a real site fails when nock has no reply for it', async () => {
    await expect(axios.get('https://jobs.example.org/careers', { timeout: 2000 })).rejects.toMatchObject({ code: 'ENETUNREACH' });
  });

  test('the logger writes no log files under Jest', () => {
    const logger = createLogger('guard-test');
    expect(logger.transports.map((t) => t.name)).toEqual(['console']);
  });
});
