import { validateSchedule, cronToTime, timeToCron, defaultSchedule, lastScheduledTime, isRefreshMissed } from '../lib/schedule.js';

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

describe('missed refresh (Mac asleep at the scheduled time)', () => {
  const daily = { mode: 'daily', time: '06:00' };
  const IST = 'Asia/Kolkata';
  test('the most recent due time is today 06:00 IST after 06:00, yesterday before it', () => {
    expect(lastScheduledTime(new Date('2026-10-14T03:00:00Z'), '06:00', IST).toISOString()).toBe('2026-10-14T00:30:00.000Z'); // 08:30 IST
    expect(lastScheduledTime(new Date('2026-10-14T00:00:00Z'), '06:00', IST).toISOString()).toBe('2026-10-13T00:30:00.000Z'); // 05:30 IST
  });
  test('woke at 08:30 IST, last refresh was yesterday evening: missed', () => {
    expect(isRefreshMissed(daily, '2026-10-13T12:32:00Z', new Date('2026-10-14T03:00:00Z'), IST)).toBe(true);
  });
  test('refresh already ran after 06:00 today: not missed', () => {
    expect(isRefreshMissed(daily, '2026-10-14T00:31:00Z', new Date('2026-10-14T03:00:00Z'), IST)).toBe(false);
  });
  test('before today\'s 06:00 with a run after yesterday\'s 06:00: not missed', () => {
    expect(isRefreshMissed(daily, '2026-10-13T12:32:00Z', new Date('2026-10-14T00:00:00Z'), IST)).toBe(false);
  });
  test('on demand only never catches up; no previous run counts as missed', () => {
    expect(isRefreshMissed({ mode: 'manual', time: '06:00' }, null, new Date(), IST)).toBe(false);
    expect(isRefreshMissed(daily, null, new Date('2026-10-14T03:00:00Z'), IST)).toBe(true);
  });
});
