// Refresh schedule setting: "daily" at a fixed time, or "manual" (on demand
// only, from the Refresh now button). Pure helpers; server.js owns the
// cron job and the settings file.

export const MODES = ['daily', 'manual'];

// "0 6 * * *" -> "06:00"; anything else (not a plain daily cron) -> null.
export function cronToTime(expr) {
  const m = String(expr || '').trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return null;
  const [minute, hour] = [Number(m[1]), Number(m[2])];
  if (minute > 59 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function timeToCron(time) {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

// Returns { ok: true, value } with a normalized setting, or { ok: false, error }.
export function validateSchedule(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'schedule must be an object' };
  if (!MODES.includes(input.mode)) return { ok: false, error: `mode must be one of ${MODES.join(', ')}` };
  const m = String(input.time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: 'time must be HH:MM (24-hour)' };
  const time = `${m[1].padStart(2, '0')}:${m[2]}`;
  return { ok: true, value: { mode: input.mode, time } };
}

export function defaultSchedule(envCron) {
  return { mode: 'daily', time: cronToTime(envCron) || '06:00' };
}

// Minutes that `timeZone` is ahead of UTC at `date` (e.g. +330 for IST).
function zoneOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// The most recent moment (at or before `now`) when the daily refresh was due.
export function lastScheduledTime(now, time, timeZone) {
  const [hour, minute] = time.split(':').map(Number);
  const offset = zoneOffsetMinutes(now, timeZone);
  const local = new Date(now.getTime() + offset * 60000); // wall clock as UTC fields
  let due = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offset * 60000;
  if (due > now.getTime()) due -= 24 * 60 * 60000;
  return new Date(due);
}

// True when a daily refresh was due but none started since (e.g. the Mac
// was asleep at 06:00). `lastRunAt` is the latest refresh start or finish.
export function isRefreshMissed(schedule, lastRunAt, now, timeZone) {
  if (!schedule || schedule.mode !== 'daily') return false;
  const due = lastScheduledTime(now, schedule.time, timeZone);
  const last = lastRunAt ? new Date(lastRunAt) : null;
  return !last || Number.isNaN(last.getTime()) || last < due;
}
