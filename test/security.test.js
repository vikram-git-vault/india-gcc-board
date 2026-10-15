import http from 'http';
import express from 'express';
import fs from 'fs';
import { hostName, hostAllowed, isCrossSite, parseAllowedHosts, requestGuard, securityHeaders } from '../lib/security.js';

describe('hostName', () => {
  test('strips the port and lowers the case', () => {
    expect(hostName('LocalHost:4000')).toBe('localhost');
    expect(hostName('127.0.0.1:4000')).toBe('127.0.0.1');
    expect(hostName('[::1]:4000')).toBe('::1');
    expect(hostName('::1')).toBe('::1');
    expect(hostName('board.tail1234.ts.net')).toBe('board.tail1234.ts.net');
    expect(hostName('')).toBe('');
    expect(hostName(undefined)).toBe('');
  });
});

describe('hostAllowed', () => {
  const allowed = parseAllowedHosts('Board.tail1234.ts.net, other.example:8080');
  test('local names and IP addresses', () => {
    for (const h of ['localhost:4000', '127.0.0.1:4000', '[::1]:4000', '192.168.68.110:4000', '100.101.102.103:4000']) {
      expect(hostAllowed(h, allowed)).toBe(true);
    }
  });
  test('names in ALLOWED_HOSTS; an entry with a port matches only that port', () => {
    expect(hostAllowed('board.tail1234.ts.net', allowed)).toBe(true);
    expect(hostAllowed('board.tail1234.ts.net:4000', allowed)).toBe(true);
    expect(hostAllowed('other.example:8080', allowed)).toBe(true);
    expect(hostAllowed('other.example:4000', allowed)).toBe(false);
  });
  test('IPv6 and odd Host values', () => {
    expect(hostAllowed('[::1]', allowed)).toBe(true);
    expect(hostAllowed('[2001:db8::1]:4000', allowed)).toBe(true);
    expect(hostAllowed('localhost.', allowed)).toBe(false);
  });
  test('DNS-rebinding names and a missing Host are rejected', () => {
    expect(hostAllowed('evil.example:4000', allowed)).toBe(false);
    expect(hostAllowed('127.0.0.1.evil.example', allowed)).toBe(false);
    expect(hostAllowed('localhost.evil.example', allowed)).toBe(false);
    expect(hostAllowed('', allowed)).toBe(false);
    expect(hostAllowed(undefined, allowed)).toBe(false);
  });
});

describe('parseAllowedHosts', () => {
  test('a pasted URL is reduced to its host and port', () => {
    expect([...parseAllowedHosts('https://Board.tail1234.ts.net/, http://x.example:8443/path?q=1, plain.example ,,')])
      .toEqual(['board.tail1234.ts.net', 'x.example:8443', 'plain.example']);
    expect(parseAllowedHosts('').size).toBe(0);
    expect(parseAllowedHosts(undefined).size).toBe(0);
  });
});

describe('isCrossSite', () => {
  const allowed = parseAllowedHosts('board.tail1234.ts.net');
  test('GET, HEAD and OPTIONS always pass', () => {
    expect(isCrossSite('GET', { host: 'localhost:4000', origin: 'https://evil.example' })).toBe(false);
    expect(isCrossSite('HEAD', { host: 'localhost:4000', 'sec-fetch-site': 'cross-site' })).toBe(false);
  });
  test('same origin passes', () => {
    expect(isCrossSite('POST', { host: 'localhost:4000', origin: 'http://localhost:4000' })).toBe(false);
    expect(isCrossSite('PUT', { host: '192.168.68.110:4000', origin: 'http://192.168.68.110:4000' })).toBe(false);
  });
  test('another site, another port and an opaque origin are rejected', () => {
    expect(isCrossSite('POST', { host: 'localhost:4000', origin: 'https://evil.example' })).toBe(true);
    expect(isCrossSite('POST', { host: 'localhost:4000', origin: 'http://localhost:3000' })).toBe(true);
    expect(isCrossSite('POST', { host: 'localhost:4000', origin: 'null' })).toBe(true);
    expect(isCrossSite('POST', { host: 'localhost:4000', origin: 'not a url' })).toBe(true);
  });
  test('a proxy that changes the Host passes when its name is allowed', () => {
    expect(isCrossSite('POST', { host: '127.0.0.1:4000', origin: 'https://board.tail1234.ts.net' }, allowed)).toBe(false);
    expect(isCrossSite('POST', { host: '127.0.0.1:4000', origin: 'https://board.tail1234.ts.net' })).toBe(true);
  });
  test('another port on an allowed name is rejected', () => {
    expect(isCrossSite('POST', { host: '127.0.0.1:4000', origin: 'http://board.tail1234.ts.net:8080' }, allowed)).toBe(true);
    expect(isCrossSite('POST', { host: '127.0.0.1:4000', origin: 'https://x.example:8443' }, parseAllowedHosts('x.example:8443'))).toBe(false);
  });
  test('IPv6 same origin passes', () => {
    expect(isCrossSite('PUT', { host: '[::1]:4000', origin: 'http://[::1]:4000' })).toBe(false);
  });
  test('without Origin: Sec-Fetch-Site decides; no browser headers pass', () => {
    expect(isCrossSite('POST', { host: 'localhost:4000', 'sec-fetch-site': 'cross-site' })).toBe(true);
    expect(isCrossSite('POST', { host: 'localhost:4000', 'sec-fetch-site': 'same-site' })).toBe(true);
    expect(isCrossSite('POST', { host: 'localhost:4000', 'sec-fetch-site': 'same-origin' })).toBe(false);
    expect(isCrossSite('POST', { host: 'localhost:4000' })).toBe(false);
  });
});

describe('requestGuard in an Express app', () => {
  let server;
  let port;
  const warnings = [];
  beforeAll((done) => {
    const app = express();
    app.use(requestGuard({ allowedHosts: parseAllowedHosts('board.tail1234.ts.net'), logger: { warn: (m) => warnings.push(m) } }));
    app.use(securityHeaders());
    app.get('/api/roles', (_req, res) => res.json({ ok: true }));
    app.post('/api/refresh', (_req, res) => res.status(202).json({ started: true }));
    app.put('/api/schedule', (_req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; done(); });
  });
  afterAll((done) => { server.close(done); });

  const send = (method, path, headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });

  test('the board on localhost works', async () => {
    expect((await send('GET', '/api/roles', { Host: `localhost:${port}` })).status).toBe(200);
    expect((await send('POST', '/api/refresh', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status).toBe(202);
  });
  test('a same-origin PUT works and a cross-site PUT is rejected', async () => {
    expect((await send('PUT', '/api/schedule', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status).toBe(200);
    const r = await send('PUT', '/api/schedule', { Host: `localhost:${port}`, Origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/Cross-site/);
  });
  test('curl-style POST without browser headers works', async () => {
    expect((await send('POST', '/api/refresh', { Host: `127.0.0.1:${port}` })).status).toBe(202);
  });
  test('DNS rebinding is rejected', async () => {
    const r = await send('GET', '/api/roles', { Host: `evil.example:${port}` });
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/ALLOWED_HOSTS/);
  });
  test('a cross-site form POST is rejected', async () => {
    const r = await send('POST', '/api/refresh', { Host: `localhost:${port}`, Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(r.status).toBe(403);
    expect(warnings.some((w) => /cross-site POST \/api\/refresh/.test(w))).toBe(true);
  });

  test('security headers and a strict CSP', async () => {
    const r = await send('GET', '/api/roles', { Host: `localhost:${port}` });
    const csp = r.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeUndefined();
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
});

// The CSP has no 'unsafe-inline': inline code in the pages would not run.
describe('frontend has no inline script or style', () => {
  const dir = new URL('../frontend/public/', import.meta.url);
  const files = ['index.html', 'employers.html', 'js/board.js', 'js/employers.js'];
  test.each(files)('%s', (file) => {
    const text = fs.readFileSync(new URL(file, dir), 'utf-8');
    expect(text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(text).not.toMatch(/<style[\s>]/i);
    expect(text).not.toMatch(/\sstyle=/i);
    expect(text).not.toMatch(/\son[a-z]+=["']/i);
    expect(text).not.toMatch(/javascript:/i);
  });
});
