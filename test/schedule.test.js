import { validateSchedule, cronToTime, timeToCron, defaultSchedule } from '../lib/schedule.js';

describe('validateSchedule', () => {
  test('accepts daily and manual with HH:MM', () => {
    expect(validateSchedule({ mode: 'daily', time: '6:30' })).toEqual({ ok: true, value: { mode: 'daily', time: '06:30' } });
    expect(validateSchedule({ mode: 'manual', time: '23:59' }).ok).toBe(true);
  });
  test.each([
    [{ mode: 'weekly', time: '06:00' }],
    [{ mode: 'daily', time: '24:00' }],
    [{ mode: 'daily', time: '06:60' }],
    [{ mode: 'daily', time: '6am' }],
    [null],
  ])('rejects %j', (input) => {
    expect(validateSchedule(input).ok).toBe(false);
  });
});

describe('cron conversion', () => {
  test('round trip', () => {
    expect(timeToCron('06:30')).toBe('30 6 * * *');
    expect(cronToTime('30 6 * * *')).toBe('06:30');
  });
  test('non-daily cron gives null, default falls back to 06:00', () => {
    expect(cronToTime('0 6 * * 1')).toBeNull();
    expect(defaultSchedule('0 6 * * 1')).toEqual({ mode: 'daily', time: '06:00' });
    expect(defaultSchedule(undefined)).toEqual({ mode: 'daily', time: '06:00' });
  });
});
