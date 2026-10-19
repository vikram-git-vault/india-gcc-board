// Network loss during a refresh. After a wake or a Wi-Fi change, the Mac
// can be without a network for some minutes: every request then fails at
// once (DNS: ENOTFOUND, or EADDRNOTAVAIL when the local address went away).
// On 2026-10-18 this failed 86 employers in 1.4 s. refresh.js waits for the
// network and tries those employers again; server.js starts no scheduled
// run without a network. See docs/ARCHITECTURE.md §4.1.
import net from 'net';
import { settings } from './settings.js';

// Error codes that tell "this computer has no network", not "this site
// has a problem". ECONNRESET, ETIMEDOUT and HTTP errors are per site.
export const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EADDRNOTAVAIL', 'ENETUNREACH', 'ENETDOWN']);

// The same in a message, also from a browser page (Puppeteer: net::ERR_...).
const CODE_IN_MESSAGE = /\b(ENOTFOUND|EAI_AGAIN|EADDRNOTAVAIL|ENETUNREACH|ENETDOWN|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE)\b/;

export function isNetworkError(err) {
  if (!err) return false;
  if (NETWORK_ERROR_CODES.has(err.code)) return true;
  if (err.cause && NETWORK_ERROR_CODES.has(err.cause.code)) return true;
  return CODE_IN_MESSAGE.test(String(err.message || ''));
}

// True when a TCP connection to host:443 opens (this needs DNS and a
// route). An answer from the DNS cache alone is not sufficient.
export function checkOnline({ host = settings.scraping.network_check_host, port = 443, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// Checks every intervalMs until check() is true (resolves true) or maxWaitMs
// passes (resolves false). onWait(minutesWaited) is called after each
// failed check.
export async function waitForNetwork({
  check = checkOnline,
  intervalMs = settings.refresh.network_check_seconds * 1000,
  maxWaitMs = settings.refresh.network_wait_minutes * 60 * 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onWait = () => {},
} = {}) {
  let waited = 0;
  for (;;) {
    if (await check()) return true;
    if (waited >= maxWaitMs) return false;
    await sleep(intervalMs);
    waited += intervalMs;
    onWait(Math.floor(waited / 60000));
  }
}

// One wait for all parallel employers: the first employer that sees the
// network down starts the wait, the others join it. lost is true after a
// wait that ended without a network.
export function createNetworkGate(options = {}) {
  let waiting = null;
  const gate = {
    lost: false,
    get waiting() { return waiting !== null; },
    // Resolves true when the network is back (or was never down).
    wait() {
      if (gate.lost) return Promise.resolve(false);
      if (!waiting) {
        waiting = waitForNetwork(options).then((back) => {
          waiting = null;
          if (!back) gate.lost = true;
          return back;
        });
      }
      return waiting;
    },
    // For a new employer: wait only when a wait is already in progress.
    async ready() {
      if (waiting) return waiting;
      return !gate.lost;
    },
  };
  return gate;
}

// refresh.js exits with this code when the network did not come back;
// server.js continues the run (--resume) when the network is back
// (sysexits EX_UNAVAILABLE).
export const NETWORK_EXIT_CODE = 69;
