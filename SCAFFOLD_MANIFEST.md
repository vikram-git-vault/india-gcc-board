# File manifest

This document lists the project files and the function of each file.
It also tells which phase added each file.
Last update: 2026-10-13.

## Entry points

| File | Phase | Function |
|---|---|---|
| `refresh.js` | 0, 5, 6, 8 | The refresh. It scrapes, classifies, stores, gets descriptions and publishes. Options: `--init`, `--reclassify`, `--descriptions`, `--only=<ids>`. |
| `score.js` | 6 | The scoring tool. Options: `--status`, `--pending`, `--import`. |
| `server.js` | 3b, 7 | The server. It shows the board, gives the API and runs the refresh schedule (`/api/schedule`). |
| `discover.js` | 8 | Employer discovery. Options: `--detect <careers-url>`, `--talent500`. Manual runs only. |

## Library (`lib/`)

| File | Phase | Function |
|---|---|---|
| `lib/logger.js` | 0 | The winston logger (console and log files). |
| `lib/database.js` | 1, 5, 6 | The SQLite schema, the column migration, the role sync, the description queries and the score queries. |
| `lib/parser.js` | 1, 5 | Changes the scraper output into the `roles` schema. Applies the filters and the targeting. |
| `lib/targeting.js` | 5 | Classifies a role by its title: grade, family, tier. |
| `lib/descriptions.js` | 6 | Gets the full job description from the Workday and Oracle detail APIs. |
| `lib/scoring.js` | 6 | The rubric version, the description hash and the score validation. |
| `lib/discovery.js` | 8 | Parses sitemap job URLs; detects the ATS of a careers page. |
| `lib/schedule.js` | 7 | Validates the refresh schedule (daily at a time, or on demand only). |
| `lib/publisher.js` | 3b, 5, 6 | Writes `data/roles.json`: target roles, exception roles with fit 75 or more, and the scores. |
| `lib/security.js` | 9 | The Host check, the cross-site check and the security headers (Content-Security-Policy) for `server.js`. |
| `lib/outage.js` | 10 | Finds a platform outage (one Workday cluster or one ATS) in the failed employers of a run. |

## Scrapers (`lib/scrapers/`)

| File | Phase | Function |
|---|---|---|
| `BaseScraper.js` | 1 | robots.txt check, crawl delay, User-Agent. |
| `ScraperFactory.js` | 1 | Makes the scraper class for the `ats_type` of an employer. |
| `WorkdayScraper.js` | 1 | Workday CXS API (12 employers). |
| `OracleScraper.js` | 2 | Oracle Fusion Recruiting Cloud API (2 employers). |
| `GreenhouseScraper.js` | 2b | Greenhouse API (1 employer). |
| `AvatureScraper.js` | 2c | Avature search pages (1 employer). |
| `CustomScraper.js` | 2 | Sitemap and JobPosting data, optional Puppeteer (6 employers). |

## Configuration (`config/`)

| File | Phase | Function |
|---|---|---|
| `config/employers.json` | 0, 8 | 146 employers (57 active), the `excluded` list (3 employers) and `meta`. One employer on each line. |
| `config/filters.json` | 0 | Locations, job types, excluded keywords. |
| `config/targets.json` | 5 | The targeting rules. |
| `config/scoring-rubric.md` | 6 | The scoring rubric (version 1). It contains no personal data. |

## Frontend, tests, documents

| File | Phase | Function |
|---|---|---|
| `frontend/public/index.html` | 3b, 5, 6 | The board web page (HTML only). |
| `frontend/public/js/board.js`, `css/board.css` | 3b, 5, 6 | The script and the styles of the board. |
| `frontend/public/employers.html`, `js/employers.js`, `css/employers.css` | 8 | The employer list page. |
| `frontend/public/fonts/` | 9 | The Source Sans 3 font (SIL Open Font License, `OFL.txt`). |
| `test/targeting.test.js` | 5 | Tests for the targeting rules. |
| `test/descriptions.test.js` | 6 | Tests for the description fetcher (nock, no real requests). |
| `test/scoring.test.js` | 6 | Tests for the score validation. |
| `test/parser.test.js` | 8 | Tests for the location mapping. |
| `test/schedule.test.js` | 7 | Tests for the schedule validation. |
| `test/outage.test.js` | 10 | Tests for the platform outage check. |
| `README.md` | 0 | Overview and quick start. |
| `docs/SETUP.md` | 0 | The procedures. |
| `docs/ARCHITECTURE.md` | 0 | The design. |
| `docs/EMPLOYERS.md` | 2 | The employer directory. |

## Other files

| File | Function |
|---|---|
| `package.json` | Packages and scripts. `npm test` runs Jest with ES modules. |
| `.env.example` | The template for `.env`. |
| `.gitignore` | Files that git must not track. |
| `.githooks/` | Git hooks that stop personal data on each commit and push (`tools/check-private.js`). |

## Folders that git ignores

| Folder | Content |
|---|---|
| `data/` | `jobs.db` (the database), `roles.json` (the board data) and `schedule.json` (the refresh schedule). |
| `logs/` | The refresh logs. |
| `Resume/` | The resumes, the resume text variants and the candidate profile. Personal data. |
| `.cache/` | Temporary files, for example `.cache/scoring/pending.json` and `.cache/discovery/`. |
| `node_modules/` | The installed packages. |

> **CAUTION:** Do not commit files from `Resume/`. Do not copy personal data into a file that git tracks.

## Not implemented

- `bin/cli.js`: a command for health checks and a refresh of one employer (Phase 4).
- Alerts for repeated failures (Phase 4).
- An automatic scorer in the refresh: Ollama, Groq or the Claude API (Option A).
- Scrapers for Phenom, SuccessFactors, Eightfold, iCIMS and Taleo.
- A fix of `AvatureScraper` for HSBC.
- A worker pool for parallel scraping of different domains.
