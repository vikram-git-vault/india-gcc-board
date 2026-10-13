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
