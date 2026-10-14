import { isPathAllowed } from '../lib/scrapers/BaseScraper.js';

const robots = (lines) => ['User-agent: *', ...lines].join('\n');

describe('isPathAllowed', () => {
  test('"?" is literal: Disallow /jobs?* blocks query URLs, not /job/', () => {
    const txt = robots(['Allow: /', 'Disallow: /jobs?*']);
    expect(isPathAllowed(txt, '/job/senior-engineer-in-pune-india-jid-1').allowed).toBe(true);
    expect(isPathAllowed(txt, '/jobs?page=2').allowed).toBe(false);
    expect(isPathAllowed(txt, '/jobs').allowed).toBe(true);
  });
  test('"*" wildcard and "$" anchor', () => {
    const txt = robots(['Disallow: /', 'Allow: /*/careers', 'Disallow: */px-widgets', 'Allow: /$']);
    expect(isPathAllowed(txt, '/en_US/careers').allowed).toBe(true);
    expect(isPathAllowed(txt, '/other').allowed).toBe(false);
    expect(isPathAllowed(robots(['Disallow: */px-widgets']), '/widgets').allowed).toBe(true);
    expect(isPathAllowed(robots(['Disallow: */px-widgets']), '/global/en/px-widgets').allowed).toBe(false);
  });
  test('longest match wins: Allow /api/apply over Disallow /', () => {
    const txt = robots(['Disallow: /', 'Allow: /careers', 'Allow: /api/apply']);
    expect(isPathAllowed(txt, '/api/apply/v2/jobs').allowed).toBe(true);
    expect(isPathAllowed(txt, '/api/pcsx/search').allowed).toBe(false);
  });
});
