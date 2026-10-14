import fs from 'fs';
import { mapLocation, matchesFilters } from '../lib/parser.js';

const filters = JSON.parse(fs.readFileSync(new URL('../config/filters.json', import.meta.url), 'utf-8'));

describe('mapLocation', () => {
  test.each([
    ['Indianapolis, IN', 'Indianapolis, IN'],
    ['Remote, Indiana', 'Remote, Indiana'],
    ['India - Hyderabad', 'Hyderabad'],
    ['Pune, Maharashtra, India', 'Pune'],
    ['India Remote', 'India'],
  ])('%s -> %s', (raw, expected) => {
    expect(mapLocation(raw, filters)).toBe(expected);
  });

  test('a multi-location list takes the first listed city, not the longest name', () => {
    expect(mapLocation('Pune, Maharashtra, India | Hyderabad, Telangana, India | Bangalore, Karnataka, India', filters)).toBe('Pune');
    expect(mapLocation('Vadodara, Gujarat, India | Chennai, Tamil Nadu, India', filters)).toBe('Chennai');
    expect(mapLocation('Thane, Maharashtra, India | Surat, India', filters)).toBe('India');
  });

  test('a multi-location Workday role takes the city from the job URL', () => {
    expect(mapLocation('2 Locations', filters, 'https://x.wd1.myworkdayjobs.com/Ext/job/Bengaluru-IND/Senior-Manager_R1')).toBe('Bengaluru');
  });

  test('a multi-location role with no India city in the URL stays unmapped', () => {
    expect(mapLocation('3 Locations', filters, 'https://x.wd1.myworkdayjobs.com/Ext/job/Austin-TX/Manager_R2')).toBe('3 Locations');
  });
});

describe('matchesFilters with US locations', () => {
  test('an Indiana role is not kept', () => {
    const location = mapLocation('Greenwood, Indiana', filters);
    expect(matchesFilters({ title: 'Assistant Manager', location }, filters)).toBe(false);
  });
});
