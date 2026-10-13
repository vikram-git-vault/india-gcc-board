# File manifest

This document lists the project files and the function of each file.
It also tells which phase added each file.
Last update: 2026-10-13.

## Entry points

| File | Phase | Function |
|---|---|---|
| `refresh.js` | 0, 5, 6 | The refresh. It scrapes, classifies, stores, gets descriptions and publishes. Options: `--init`, `--reclassify`, `--descriptions`. |
| `score.js` | 6 | The scoring tool. Options: `--status`, `--pending`, `--import`. |
| `server.js` | 3b | The server. It shows the board, gives the API and runs the daily refresh. |

## Library (`lib/`)

| File | Phase | Function |
|---|---|---|
| `lib/logger.js` | 0 | The winston logger (console and log files). |
| `lib/database.js` | 1, 5, 6 | The SQLite schema, the column migration, the role sync, the description queries and the score queries. |
| `lib/parser.js` | 1, 5 | Changes the scraper output into the `roles` schema. Applies the filters and the targeting. |
| `lib/targeting.js` | 5 | Classifies a role by its title: grade, family, tier. |
| `lib/descriptions.js` | 6 | Gets the full job description from the Workday and Oracle detail APIs. |
| `lib/scoring.js` | 6 | The rubric version, the description hash and the score validation. |
| `lib/publisher.js` | 3b, 5, 6 | Writes `data/roles.json`: target roles, exception roles with fit 75 or more, and the scores. |

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
| `config/employers.json` | 0 | 33 employers, the `excluded` list (3 employers) and `meta`. |
| `config/filters.json` | 0 | Locations, job types, excluded keywords. |
| `config/targets.json` | 5 | The targeting rules. |
| `config/scoring-rubric.md` | 6 | The scoring rubric (version 1). It contains no personal data. |

## Frontend, tests, documents

| File | Phase | Function |
|---|---|---|
| `frontend/public/index.html` | 3b, 5, 6 | The board web page. |
| `test/targeting.test.js` | 5 | Tests for the targeting rules. |
| `test/descriptions.test.js` | 6 | Tests for the description fetcher (nock, no real requests). |
| `test/scoring.test.js` | 6 | Tests for the score validation. |
| `README.md` | 0 | Overview and quick start. |
| `docs/SETUP.md` | 0 | The procedures. |
| `docs/ARCHITECTURE.md` | 0 | The design. |
| `docs/EMPLOYERS.md` | 2 | The employer directory. |
| `docs/BUILD_LOG.md` | 3b | The frameworks and the concepts. |

## Other files

| File | Function |
|---|---|
| `package.json` | Packages and scripts. `npm test` runs Jest with ES modules. |
| `.env.example` | The template for `.env`. |
| `.gitignore` | Files that git must not track. |
| `.github/workflows/refresh-schedule.yml` | A workflow from an earlier cloud setup. Its schedule is in a comment. Do not enable the schedule. |

## Folders that git ignores

| Folder | Content |
|---|---|
| `data/` | `jobs.db` (the database) and `roles.json` (the board data). |
| `logs/` | The refresh logs. |
| `Resume/` | The resumes, the resume text variants and the candidate profile. Personal data. |
| `.cache/` | Temporary files, for example `.cache/scoring/pending.json`. |
| `node_modules/` | The installed packages. |

> **CAUTION:** Do not commit files from `Resume/`. Do not copy personal data into a file that git tracks.

## Not implemented

- `bin/cli.js`: a command for health checks and a refresh of one employer (Phase 4).
- Alerts for repeated failures (Phase 4).
- An automatic scorer in the refresh: Ollama, Groq or the Claude API (Option A).
- A worker pool for parallel scraping of different domains.
