// Power state on macOS. caffeinate keeps the Mac awake on mains power or
// with the lid open, but a MacBook on battery with a closed lid sleeps
// anyway (a maintenance wake lasts a few seconds). A refresh in that state
// fails employers on timeouts, so the server waits and refresh.js pauses
// until the Mac can stay awake. On other platforms the Mac checks do
// nothing and a refresh always runs.
import { execFile } from 'child_process';

// `pmset -g batt` first line: "Now drawing from 'Battery Power'" or "'AC Power'".
export function parsePowerSource(output) {
  const m = String(output || '').match(/Now drawing from '([^']+)'/);
  if (!m) return null;
  return /battery/i.test(m[1]) ? 'battery' : 'ac';
}

// `ioreg -r -k AppleClamshellState -d 1`: "AppleClamshellState" = Yes|No.
export function parseLidClosed(output) {
  const m = String(output || '').match(/"AppleClamshellState"\s*=\s*(Yes|No)/);
  return m ? m[1] === 'Yes' : null;
}

// The reason a refresh cannot run now, or null when it can.
export function sleepRisk({ source, lidClosed }) {
  return source === 'battery' && lidClosed === true ? 'on battery with the lid closed' : null;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

// Resolves to null (the Mac can stay awake) or a reason string. When a
// check fails, it resolves to null: an unknown state never blocks a refresh.
export async function checkSleepRisk(platform = process.platform) {
  if (platform !== 'darwin') return null;
  const [batt, lid] = await Promise.all([
    run('pmset', ['-g', 'batt']),
    run('ioreg', ['-r', '-k', 'AppleClamshellState', '-d', '1']),
  ]);
  return sleepRisk({ source: parsePowerSource(batt), lidClosed: parseLidClosed(lid) });
}

// Sleep detector: a timer ticks every `tickMs`; when the wall clock moves
// on by much more than one tick, the computer slept between the ticks.
// slept() tells if a sleep happened since the last reset().
// sleptSince(t) tells if a sleep ended after time t (for parallel
// employers, each with its own start time).
export function createSleepWatch({ tickMs = 5000, gapMs = 30000, now = () => Date.now() } = {}) {
  let last = now();
  let sleptSinceReset = false;
  let lastWake = null;
  const tick = () => {
    const t = now();
    if (t - last > tickMs + gapMs) { sleptSinceReset = true; lastWake = t; }
    last = t;
  };
  const timer = setInterval(tick, tickMs);
  if (timer.unref) timer.unref();
  return {
    tick,
    slept: () => { tick(); return sleptSinceReset; },
    sleptSince: (t) => { tick(); return lastWake !== null && lastWake > t; },
    reset: () => { tick(); sleptSinceReset = false; },
    stop: () => clearInterval(timer),
  };
}

// refresh.js exits with this code when it pauses for sleep; server.js
// then resumes the run when the Mac can stay awake (sysexits EX_TEMPFAIL).
export const PAUSED_EXIT_CODE = 75;
