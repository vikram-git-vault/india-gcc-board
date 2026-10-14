import nock from 'nock';
import { BaseScraper } from '../lib/scrapers/BaseScraper.js';

const employer = { id: 'x', name: 'X', careers_url: 'https://jobs.example.com/careers', crawl_delay_seconds: 0.01 };

afterEach(() => nock.cleanAll());

describe('BaseScraper.cancel', () => {
  test('requests work before cancel', async () => {
    nock('https://jobs.example.com').get('/a').reply(200, 'ok');
    const s = new BaseScraper(employer);
    await expect(s.client.get('https://jobs.example.com/a')).resolves.toMatchObject({ data: 'ok' });
  });
  test('after cancel, requests and crawl delays throw and nothing is sent', async () => {
    const scope = nock('https://jobs.example.com').get('/b').reply(200, 'ok');
    const s = new BaseScraper(employer);
    s.cancel();
    await expect(s.client.get('https://jobs.example.com/b')).rejects.toThrow('time limit');
    await expect(s.delay()).rejects.toThrow('time limit');
    expect(scope.isDone()).toBe(false);
  });
});
