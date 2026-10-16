import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaults, resolveSettings, loadSettings, settings } from '../lib/settings.js';

describe('resolveSettings', () => {
  test('no file: all defaults, no warnings', () => {
    expect(resolveSettings(undefined)).toEqual({ settings: defaults(), warnings: [] });
  });
  test('a valid override replaces only that property', () => {
    const { settings: s, warnings } = resolveSettings({ refresh: { scrape_concurrency: 3 } });
    expect(warnings).toEqual([]);
    expect(s.refresh.scrape_concurrency).toBe(3);
    expect(s.refresh.employer_time_limit_minutes).toBe(defaults().refresh.employer_time_limit_minutes);
  });
  test('wrong type or range: default and a warning', () => {
    const { settings: s, warnings } = resolveSettings({
      refresh: { scrape_concurrency: 40 }, scoring: { auto_score: 'off' }, logging: { level: 'loud' },
    });
    expect(s.refresh.scrape_concurrency).toBe(6);
    expect(s.scoring.auto_score).toBe(true);
    expect(s.logging.level).toBe('info');
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/refresh\.scrape_concurrency" must be an integer from 1 to 16/);
  });
  test('unknown section or property (a typing error): a warning', () => {
    const { warnings } = resolveSettings({ refrsh: {}, refresh: { scrape_concurency: 2 } });
    expect(warnings).toEqual(['unknown section "refrsh"', 'unknown property "refresh.scrape_concurency"']);
  });
  test('not an object: defaults and a warning', () => {
    expect(resolveSettings([1]).warnings).toHaveLength(1);
    expect(resolveSettings({ server: 5 }).warnings[0]).toMatch(/"server" is not an object/);
  });
});

describe('loadSettings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-'));
  test('missing file: defaults', () => {
    expect(loadSettings(path.join(dir, 'none.json'))).toEqual({ settings: defaults(), warnings: [] });
  });
  test('broken JSON: defaults and a warning', () => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{"refresh": ');
    const { settings: s, warnings } = loadSettings(file);
    expect(s).toEqual(defaults());
    expect(warnings[0]).toMatch(/cannot read config\/settings\.json/);
  });
  test('the committed config/settings.json is valid', () => {
    expect(loadSettings().warnings).toEqual([]);
    expect(Object.keys(settings)).toEqual(Object.keys(defaults()));
  });
});
