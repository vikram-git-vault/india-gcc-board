import fs from 'fs';
import { mapLocation, matchesFilters, parsePostedDate } from '../lib/parser.js';

describe('parsePostedDate', () => {
  test('a date without a time keeps its calendar day in any time zone', () => {
    expect(parsePostedDate('October 13, 2026')).toBe('2026-10-13');
    expect(parsePostedDate('2026-10-13')).toBe('2026-10-13');
    expect(parsePostedDate('2026-10-01T00:00:00.000+0000')).toBe('2026-10-01');
  });
});

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

  test('office codes map to the city', () => {
    expect(mapLocation('Ind – Blr Sez 1 (3Rd, 6Th & 7Th Floor)', filters)).toBe('Bengaluru');
    expect(mapLocation('Ind – Pune Sez 1 (All Floors Except 9Th And 10Th)', filters)).toBe('Pune');
    expect(mapLocation('USA - IN (Remote)', filters)).toBe('USA - IN (Remote)');
    expect(mapLocation('RMZ Ecoworld - Campus 6A', filters)).toBe('Bengaluru');
    expect(mapLocation('COMMERZ III, OBEROI GARDEN CITY', filters)).toBe('Mumbai');
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
