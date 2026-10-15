import {
  parsePowerSource, parseLidClosed, sleepRisk, checkSleepRisk, createSleepWatch, PAUSED_EXIT_CODE,
} from '../lib/power.js';

describe('parsePowerSource', () => {
  test('battery and mains power', () => {
    expect(parsePowerSource("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t66%; discharging")).toBe('battery');
    expect(parsePowerSource("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged")).toBe('ac');
  });
  test('unknown output', () => {
    expect(parsePowerSource('')).toBeNull();
    expect(parsePowerSource(undefined)).toBeNull();
  });
});

describe('parseLidClosed', () => {
  test('lid closed and open', () => {
    expect(parseLidClosed('      "AppleClamshellState" = Yes\n')).toBe(true);
    expect(parseLidClosed('      "AppleClamshellCausesSleep" = No\n      "AppleClamshellState" = No\n')).toBe(false);
  });
  test('no lid (desktop Mac) or unknown output', () => {
    expect(parseLidClosed('')).toBeNull();
  });
});

describe('sleepRisk', () => {
  test('only battery with a closed lid is a risk', () => {
    expect(sleepRisk({ source: 'battery', lidClosed: true })).toBe('on battery with the lid closed');
    expect(sleepRisk({ source: 'battery', lidClosed: false })).toBeNull();
    expect(sleepRisk({ source: 'ac', lidClosed: true })).toBeNull();
  });
  test('an unknown state never blocks a refresh', () => {
    expect(sleepRisk({ source: null, lidClosed: true })).toBeNull();
    expect(sleepRisk({ source: 'battery', lidClosed: null })).toBeNull();
  });
});

describe('checkSleepRisk', () => {
  test('no check on other platforms', async () => {
    await expect(checkSleepRisk('linux')).resolves.toBeNull();
  });
});

describe('createSleepWatch', () => {
  test('a large wall-clock jump between ticks is a sleep', () => {
    let t = 0;
    const watch = createSleepWatch({ tickMs: 5000, gapMs: 30000, now: () => t });
    try {
      t = 5000; watch.tick();
      t = 10000;
      expect(watch.slept()).toBe(false);
      t = 10000 + 16 * 60000; // 16 min asleep
      expect(watch.slept()).toBe(true);
      watch.reset();
      t += 5000;
      expect(watch.slept()).toBe(false);
    } finally {
      watch.stop();
    }
  });
  test('a slow tick under the gap is not a sleep', () => {
    let t = 0;
    const watch = createSleepWatch({ tickMs: 5000, gapMs: 30000, now: () => t });
    try {
      t = 30000;
      expect(watch.slept()).toBe(false);
    } finally {
      watch.stop();
    }
  });
});

test('pause exit code is EX_TEMPFAIL', () => {
  expect(PAUSED_EXIT_CODE).toBe(75);
});
