# BFSI Global Job Board — Architecture

**Status:** Phase 0 (scaffold) &nbsp;|&nbsp; **Owner:** the repository owner &nbsp;|&nbsp; **Last updated:** 2026-09-13

A personal, self-hosted job aggregator that checks 34 BFSI (Banking, Financial
Services & Insurance) employer career sites once a day and surfaces
leadership-track roles based in India GCC hub cities (Bangalore, Mumbai,
Delhi-NCR, Pune, Hyderabad, Chennai).

---

## 1. System Architecture

```
                     ┌──────────────────────┐
                     │   config/*.json       │   employer list, filters
                     └──────────┬────────────┘
                                │
   06:00 IST cron / GH Action  ▼
              ┌─────────────────────────────┐
              │        refresh.js            │  orchestrator
              └───────────┬─────────────────┘
                           │
        ┌──────────────────┼───────────────────┐
        ▼                  ▼                    ▼
 ┌─────────────┐   ┌───────────────┐    ┌───────────────┐
 │  Scrapers    │   │    Parser      │    │   Logger       │
 │ (per ATS)    │──▶│ (normalize +   │    │ (winston)      │
 │ Factory-built│   │  filter roles) │    │                │
 └─────────────┘   └───────┬───────┘    └───────────────┘
                            ▼
                    ┌───────────────┐
                    │   SQLite DB    │  employers, roles,
                    │  (lib/database)│  role_marks, scrape_runs
                    └───────┬───────┘
                            ▼
                    ┌───────────────┐
                    │ Claude Artifact│  React job board UI
                    │   Publisher    │  (read-only, live search)
                    └───────────────┘
```

Each stage is independently testable: scrapers return raw HTML/JSON listings,
the parser normalizes and filters them against `config/filters.json`, and the
database layer is the only thing that touches SQLite. `refresh.js` just wires
these together in sequence and never contains scraping or parsing logic
itself.

---

## 2. Ethical Scraping Policy

This project scrapes **public career listing pages only** — no login walls,
no personal data, no resume databases.

Rules enforced by every scraper (via `BaseScraper`, Phase 1):

1. **robots.txt compliance** — each scraper fetches and honors
   `/robots.txt` for its target domain before crawling. If a career-page
   path is disallowed, the employer is marked `active: false` and skipped.
2. **Rate limiting** — minimum 5–10 second delay between requests to the
   same domain (`crawl_delay_seconds` per employer in `config/employers.json`;
   Workday/Oracle ATS pages default to 8s, harder-to-crawl custom sites to
   10s). No parallel requests to the same host.
3. **Identify ourselves** — a descriptive `User-Agent` string
   (`india-gcc-board-bot/1.0 (+github repo URL)`), no spoofing of browser
   UAs to evade detection.
4. **No ToS-prohibited targets** — Citigroup and JPMorgan Chase are
   explicitly excluded (see `config/employers.json` → `excluded`) because
   their robots.txt / terms explicitly disallow automated access to career
   pages. Any employer whose ToS is reviewed and found to prohibit scraping
   gets added to this list and flipped to `active: false`, not silently
   dropped from config.
5. **Daily cadence, not continuous polling** — one run per day at 6 AM IST.
   No retries-in-a-loop; a failed employer just gets logged and retried on
   the next day's run.
6. **Data minimization** — only role title, location, department, posting
   URL, and posted date are stored. No scraping of applicant counts,
   internal job IDs beyond what's needed to dedupe, or any personal data.

If an employer changes their site in a way that makes compliant scraping
impractical (e.g. requires login, aggressive bot detection), the correct
response is to mark them inactive, not to add stealth/evasion logic.

---

## 3. Data Schema

SQLite (`data/jobs.db`), created by `lib/database.js` (`refresh.js --init`).

### `employers`
| column | type | notes |
|---|---|---|
| id | TEXT PK | slug, matches `config/employers.json` |
| name | TEXT | display name |
| domain | TEXT | |
| careers_url | TEXT | |
| ats_type | TEXT | `workday` \| `oracle` \| `custom` |
| crawl_delay_seconds | INTEGER | |
| active | BOOLEAN | |
| updated_at | DATETIME | |

### `roles`
| column | type | notes |
|---|---|---|
| id | TEXT PK | hash of `employer_id + source_url` |
| employer_id | TEXT FK → employers.id | |
| title | TEXT | |
| location | TEXT | normalized city |
| department | TEXT | nullable |
| level | TEXT | `leadership` \| `senior_ic` |
| source_url | TEXT | canonical listing URL |
| posted_date | DATE | nullable, ATS-dependent |
| first_seen_at | DATETIME | |
| last_seen_at | DATETIME | bumped every run the role still appears |
| is_active | BOOLEAN | false once it disappears from a scrape |

### `role_marks`
User-side state (saved / applied / dismissed), kept separate from scraped
data so a re-scrape never clobbers it.

| column | type | notes |
|---|---|---|
| role_id | TEXT FK → roles.id | |
| mark | TEXT | `saved` \| `applied` \| `dismissed` |
| marked_at | DATETIME | |
| note | TEXT | nullable, free text |

### `scrape_runs`
One row per employer per run — the audit trail for the ethical-scraping
policy and for debugging.

| column | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| employer_id | TEXT FK → employers.id | |
| started_at | DATETIME | |
| status | TEXT | `ok` \| `error` |
| roles_found | INTEGER | |
| error_message | TEXT | nullable |

### `meta`
Key-value table for run-level metadata (`last_run_at`, `schema_version`,
`total_active_roles`, etc.) that the frontend reads for its header.

---

## 4. Scraper Architecture

**Factory pattern**: `lib/scrapers/ScraperFactory.js` reads `ats_type` from
an employer's config entry and instantiates the matching scraper class, all
extending a shared `BaseScraper`.

```
BaseScraper (lib/scrapers/BaseScraper.js)
 ├─ enforces robots.txt check + crawl delay + UA header
 ├─ abstract fetchListings() -> raw HTML/JSON
 └─ abstract extractRoles(raw) -> [{ title, location, url, postedDate, ... }]

WorkdayScraper   extends BaseScraper   (9 employers — shared JSON API shape)
OracleScraper    extends BaseScraper   (4 employers — Oracle Recruiting Cloud)
CustomScraper    extends BaseScraper   (21 employers — per-site CSS selectors
                                         defined in config/selectors/<id>.json)
```

Custom-ATS employers each get a small selector config rather than bespoke
code where the site is simple HTML; only genuinely divergent sites (JS-heavy
SPAs) get a dedicated subclass using Puppeteer instead of Cheerio+axios.

This is built in **Phase 1** (generic scraper + 3 pilot sites to prove the
pattern) and **Phase 2** (remaining ATS-specific scrapers).

---

## 5. Frontend Design (Phase 3)

A single-page React app published as a Claude Artifact:

- **Live search** across title/employer/department (client-side, the full
  active-roles set is small enough to ship as one JSON payload).
- **Filters**: city, ATS/employer, leadership vs senior-IC, priority
  keyword tags (from `config/filters.json`).
- **User marks**: save / applied / dismissed, persisted via the artifact's
  shared database capability so state survives across devices.
- **Freshness indicator**: last successful run timestamp and per-employer
  scrape health (from `scrape_runs`), so stale data is visible, not silent.
- Read-only with respect to scraping — the frontend never triggers a scrape;
  it only renders what `refresh.js` last published.

---

## 6. Scheduling & Deployment

Two redundant schedules, both targeting **6:00 AM IST daily**:

1. **Local cron** (MacBook) — `0 6 * * *` — useful while developing, but
   only runs when the machine is awake and online. See `docs/SETUP.md`.
2. **GitHub Actions** (`.github/workflows/refresh-schedule.yml`) — cron
   `30 0 * * *` UTC (= 6:00 AM IST, no DST in India) — the durable schedule
   that runs regardless of local machine state. Commits updated `data/`
   back to the repo and uploads logs as a build artifact.

Both invoke the same `refresh.js`, so behavior is identical regardless of
trigger source.

---

## 7. Error Handling & Monitoring

- Per-employer try/catch in `refresh.js` — one employer failing never
  aborts the run for the other 33.
- Every run writes a `scrape_runs` row per employer (`ok` / `error` +
  message), giving a queryable history of flaky sites.
- Winston logs to console (dev) and `logs/combined.log` +
  `logs/error.log` (10MB rotation, 5 files kept) — see `lib/logger.js`.
- Optional Slack webhook notification on GitHub Actions job failure.
- A site failing scraping for **N consecutive days** (threshold TBD in
  Phase 4) should be surfaced in the frontend's health indicator rather
  than just sitting in logs no one reads.

---

## 8. Implementation Roadmap

| Phase | Scope | Key deliverables |
|---|---|---|
| **0 — Foundation** (this doc) | Architecture, config, scaffold | This file, `docs/SETUP.md`, `config/*.json`, `refresh.js` shell, logger, workflow, folder structure |
| **1 — Database + generic scraper** | Prove the pipeline end-to-end on 3 pilot sites | `lib/database.js`, `lib/parser.js`, `lib/scrapers/BaseScraper.js`, `lib/scrapers/ScraperFactory.js`, 1 Workday + 1 Oracle + 1 Custom scraper |
| **2 — ATS-specific scrapers** | Cover remaining 31 employers | Remaining Workday/Oracle scrapers, per-site selector configs for Custom-ATS sites |
| **3 — Frontend** | React job board UI | Search, filters, marks, Claude Artifact publish (`lib/publisher.js`) |
| **4 — Scheduling & hardening** | Make the daily run unattended-safe | Consecutive-failure detection, Slack alerts tuned, GitHub Actions secrets configured, cron verified on both paths |

---

## 9. Configuration File Templates

`config/employers.json` — one entry per employer:
```json
{ "id": "example-bank", "name": "Example Bank", "domain": "example.com",
  "careers_url": "https://careers.example.com", "ats_type": "workday",
  "crawl_delay_seconds": 8, "active": true }
```

`config/filters.json` — location/keyword filters (see file for full shape):
```json
{ "locations": { "primary": ["Bangalore", "Mumbai", "..."] },
  "experience_levels": { "leadership": { "keywords": ["Director", "VP", "..."] } },
  "exclude_keywords": ["Intern", "Trainee"] }
```

`.env` (from `.env.example`) — secrets and runtime tuning, never committed.

---

## 10. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 18+, ESM | matches Puppeteer/Cheerio ecosystem |
| HTTP | axios | simple, well-understood retry/timeout config |
| JS-rendered sites | puppeteer | only where Cheerio+axios can't get the data |
| HTML parsing | cheerio | fast, no headless browser overhead for static ATS pages |
| Database | sqlite3 | zero-ops, file-based, fine for single-user scale |
| Scheduling | node-cron (local) + GitHub Actions cron | redundant, matches Section 6 |
| Logging | winston | rotation, levels, structured output |
| Frontend | React, published as a Claude Artifact | no separate hosting needed |
| Testing | jest + nock | HTTP mocking for scraper tests without hitting real sites |

---

## 11. Success Metrics

- **Coverage**: 34/34 employers actively scraped (or explicitly `active:
  false` with a documented reason — never silently broken).
- **Freshness**: daily run completes before 7:00 AM IST, ≥90% of runs in a
  30-day window succeed without manual intervention.
- **Signal quality**: <10% of surfaced roles are false positives against
  the leadership/location filters (spot-checked monthly).
- **Reliability**: no single-employer scraper failure ever blocks the rest
  of the run (already enforced structurally — see Section 7).
- **Personal usefulness**: the frontend is actually checked and roles are
  actually marked saved/applied/dismissed — the real metric this project
  exists for.

---

## 12. Out of Scope (explicitly)

- No email/SMS notifications (frontend-only, checked manually).
- No multi-user support — this is a personal tool, `role_marks` has no
  user_id column by design.
- No scraping of application forms, salary negotiation data, or any
  authenticated employer-portal content.
- No circumvention of anti-bot measures (CAPTCHA solving, IP rotation,
  browser fingerprint spoofing). A site that requires this is out of scope
  per Section 2 and gets marked `active: false`.
