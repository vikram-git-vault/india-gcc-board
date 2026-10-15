// Request checks for server.js. The board has no login, so these checks
// stop two attacks that come from web pages open in your browser:
//
// - DNS rebinding: a hostile domain name that points to 127.0.0.1 lets its
//   page read the API. The browser then sends the hostile name in the Host
//   header, so hostAllowed() rejects the request.
// - Cross-site requests (CSRF): a hostile page can send a form POST to
//   localhost:4000, for example to start a refresh. The browser then sends
//   an Origin header from another site, so isCrossSite() rejects it.
//
// Requests without browser headers (curl, scripts on this computer) pass
// the cross-site check; they still need an allowed Host header.
import net from 'net';
import helmet from 'helmet';

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// "board.example.ts.net, https://other.example:8443/x" ->
// Set { 'board.example.ts.net', 'other.example:8443' }. An entry keeps its
// port when it has one; a full URL is reduced to its host and port.
export function parseAllowedHosts(value) {
  return new Set(String(value || '').split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, ''))
    .filter(Boolean));
}

// True when the host (with or without a port) is in ALLOWED_HOSTS. An
// entry without a port matches any port; an entry with a port matches
// only that port.
export function inAllowedHosts(host, allowedHosts) {
  const value = String(host || '').trim().toLowerCase();
  return allowedHosts.has(value) || allowedHosts.has(hostName(value));
}

// The host name without the port, in lower case: "[::1]:4000" -> "::1".
export function hostName(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) return value.slice(1, value.indexOf(']') > 0 ? value.indexOf(']') : undefined);
  const colon = value.indexOf(':');
  // Two or more colons and no brackets: a bare IPv6 address.
  if (colon >= 0 && value.indexOf(':', colon + 1) >= 0) return value;
  return colon >= 0 ? value.slice(0, colon) : value;
}

// An IP address in the Host header cannot come from DNS rebinding (the
// attack needs a domain name), so LAN and Tailscale addresses are allowed.
export function hostAllowed(hostHeader, allowedHosts = new Set()) {
  const name = hostName(hostHeader);
  if (!name) return false;
  return LOCAL_NAMES.has(name) || net.isIP(name) !== 0 || inAllowedHosts(hostHeader, allowedHosts);
}

// True when a browser sent a state-changing request from another site.
export function isCrossSite(method, headers, allowedHosts = new Set()) {
  if (SAFE_METHODS.has(String(method).toUpperCase())) return false;
  const origin = headers.origin;
  if (origin) {
    if (origin === 'null') return true;
    let url;
    try { url = new URL(origin); } catch { return true; }
    if (url.host.toLowerCase() === String(headers.host || '').toLowerCase()) return false;
    // A proxy (tailscale serve, cloudflared) can change the Host header;
    // its public name in ALLOWED_HOSTS is then the expected origin. Only
    // https, or http on the default port, so another service on the same
    // machine (another port) does not pass.
    if (url.port && !allowedHosts.has(url.host.toLowerCase())) return true;
    return !inAllowedHosts(url.host, allowedHosts);
  }
  const site = headers['sec-fetch-site'];
  return site === 'cross-site' || site === 'same-site';
}

export function requestGuard({ allowedHosts = new Set(), logger = null } = {}) {
  return (req, res, next) => {
    if (!hostAllowed(req.headers.host, allowedHosts)) {
      if (logger) logger.warn(`Rejected a request with Host "${String(req.headers.host).slice(0, 100)}" (not allowed; see ALLOWED_HOSTS)`);
      res.status(403).json({ error: 'Host not allowed. Add this host name to ALLOWED_HOSTS in .env.' });
      return;
    }
    if (isCrossSite(req.method, req.headers, allowedHosts)) {
      if (logger) logger.warn(`Rejected a cross-site ${req.method} ${req.path} from origin "${String(req.headers.origin || req.headers['sec-fetch-site']).slice(0, 100)}"`);
      res.status(403).json({ error: 'Cross-site request rejected.' });
      return;
    }
    next();
  };
}

// Security headers. The pages load scripts, styles and the font only from
// this server (frontend/public/js, css and fonts), so the Content-Security-
// Policy allows nothing else. No upgrade-insecure-requests and no HSTS:
// the board is served over plain http on localhost and on the LAN.
export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  fontSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
    // Same rule as frame-ancestors 'none', for older browsers.
    xFrameOptions: { action: 'deny' },
    strictTransportSecurity: false,
  });
}
