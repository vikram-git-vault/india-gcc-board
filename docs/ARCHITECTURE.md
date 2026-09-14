# BFSI Global Job Board — Architecture

**Status:** Phase 0 (scaffold) &nbsp;|&nbsp; **Owner:** the repository owner &nbsp;|&nbsp; **Last updated:** 2026-09-13

A personal, self-hosted job aggregator that checks 34 BFSI (Banking, Financial
Services & Insurance) employer career sites and surfaces leadership-track
roles based in India GCC hub cities (Bangalore, Mumbai, Delhi-NCR, Pune,
Hyderabad, Chennai, Gurugram, Noida).

This document reconciles the project scaffold against
`BFSI_Job_Board_Architecture_Spec.md` (the source spec). **One deliberate
deviation from that spec:** the refresh cadence here is **daily at 6:00 AM
IST**, not the spec's Monday/Thursday 8:00 AM IST — a conscious choice made
2026-09-13, not an oversight. Everything else below follows the spec.

---

## 1. System Architecture

### 1.1 High-level data flow

```
Career Portal Sites (34, sitemap-first where available)
        ↓
   Scraper Service (ethical, respectful, ATS-aware)
        ↓
   Role Parser & Transformer (normalize + filter)
        ↓
   SQLite Database (employers, roles, role_marks, scrape_runs, meta)
        ↓
   Job Board Frontend (Claude Artifact, React)
        ↓
   User (browse, filter, mark)
```

### 1.2 Component breakdown

| Component | Technology | Purpose |
|---|---|---|
| **Scraper** | Node.js + axios/cheerio, puppeteer where JS rendering is required | Fetch and extract listings per ATS type |
| **Parser** | Node.js (cheerio) | Normalize raw listings into the `roles` schema |
| **Database** | SQLite (local) | Persistent role storage |
| **Frontend** | React + Claude Artifact DB capability | Job board UI, live search, user marks |
| **Scheduler** | node-cron (local) + GitHub Actions cron | Daily 6:00 AM IST refresh |
| **CLI** | Node.js CLI (`bin/cli.js`, Phase 4) | Manual trigger, health checks, single-employer re-run |

### 1.3 Data flow timeline (approximate, per daily run)

- **T+0** (06:00 IST): scheduled trigger fires
- **T+0 to T+30min**: scrape all active employers, sequential per host with per-employer crawl delay (see §2)
- **T+30 to T+35min**: parse & deduplicate roles
- **T+35 to T+40min**: sync to database
- **T+40 to T+45min**: publish to Claude Artifact
- **T+45min+**: board reflects the day's data; freshness indicator shows the new `last_run_at`

Each stage is independently testable: scrapers return raw HTML/JSON,
the parser normalizes and filters against `config/filters.json`, and the
database layer is the only thing that touches SQLite. `refresh.js` wires
these together in sequence and contains no scraping or parsing logic itself.

---

## 2. Ethical Scraping Policy

**Principle:** respect explicit site directives; scrape only what a site
invites crawlers to index. Public career listing pages only — no login
walls, no personal data, no resume databases.

| Rule | Implementation |
|---|---|
| **robots.txt** | Parsed and honored per domain before crawling; a disallowed careers path takes that employer to `active: false` |
| **Sitemaps** | Prefer `/sitemap.xml` job-listing URLs over ad-hoc HTML crawling where a site provides one — faster and more targeted |
| **Crawl delay** | 5–10 seconds between requests to the same domain (`crawl_delay_seconds` per employer); no parallel requests to the same host |
| **User-Agent** | Identifies as `india-gcc-board-bot/1.0 (+github repo URL)` — no spoofing of browser UAs to evade detection |
| **Rate limits** | Stop on `429`/`403` for that employer. Back off 1 hour within the run; if still blocked, skip and retry on the next daily cycle — never loop-retry against a blocking host |
| **Data use** | Internal personal aggregation only. No resale, no redistribution |
| **Auth** | Public pages only. No login-gated content, no application-portal scraping |
| **Data minimization** | Store only title, location, department, posting URL, posted/deadline dates, and a source job ID for dedup — no applicant counts or personal data |

### 2.1 Site classification

**Green (34 sites):** explicit or implicit crawl permission — robots.txt
allows careers paths, no authentication required.

**Red (2 sites, excluded — see `config/employers.json` → `excluded`):**
- **Citigroup** — robots.txt: `Disallow: /search-jobs/`
- **JPMorgan Chase** — 403 authentication wall on careers pages

Any employer whose site is later found to prohibit scraping gets added to
this excluded list and flipped to `active: false` — never silently dropped
from config, and never worked around with stealth/evasion logic.

### 2.2 Per-ATS crawl strategy

**Workday** (LPL Financial, Wells Fargo, Franklin Templeton, Invesco,
Broadridge, LSEG, Northern Trust, KPMG, State Street — 9):
- Sitemap or `/careers/jobs/search-results` style listing endpoint
- Filter via query params (`?location=India` / `?country=India`)
- Crawl delay: 5s; max 2 concurrent Workday requests across the run

**Oracle** (PwC AC, EY GDS, Deloitte USI — 3):
- Career portal main page; use listing API endpoints if discoverable
- Fallback to HTML parsing; crawl delay: 5s

**Taleo** (DTCC, BNY — 2):
- Oracle Taleo career-section URLs; handle pagination
- Crawl delay: 5s

**Custom portals** (remaining 20, e.g. Goldman Sachs, Morgan Stanley, UBS,
Deutsche Bank, Barclays, Bank of America, BNP Paribas, Vanguard, Standard
Chartered, Charles Schwab, and others):
- Fetch `/sitemap.xml` where present; otherwise parse the careers page directly
- cheerio for static HTML; puppeteer only for JS-heavy SPAs
- Crawl delay: 5–10s depending on site fragility

**Payment systems** (Mastercard, Visa — a `custom`-ATS subgroup with their
own crawl profile):
- Parse `/careers` job grid/table directly
- Crawl delay: 5s

### 2.3 Monitoring & compliance logging

Every request logs a structured line (see §7.2 for the shape):

```json
{
  "timestamp": "2026-09-13T00:30:00Z",
  "site": "goldman-sachs",
  "url": "https://higher.gs.com/careers/search-jobs",
  "method": "GET",
  "statusCode": 200,
  "delay_seconds": 10,
  "roles_extracted": 42,
  "errors": null
}
```

**Alert on:** `403`/`429` responses (pause that site for the run),
robots.txt changes (log & review before next run), response time > 30s
(log warning).

---

## 3. Data Schema

SQLite (`data/jobs.db`), created by `lib/database.js` (`refresh.js --init`).

### `employers`
```sql
CREATE TABLE employers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,        -- matches config/employers.json "id", e.g. "goldman-sachs"
  name TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL,
  careers_url TEXT NOT NULL,
  ats_type TEXT,                    -- 'workday' | 'oracle' | 'taleo' | 'custom'
  robots_txt_compliant BOOLEAN DEFAULT TRUE,
  crawl_delay_seconds INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT TRUE,
  last_scraped TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
The spec's PK is a bare integer; we add `slug` as a unique natural key so
scraper/config code can reference employers by the same string id used in
`config/employers.json` without a DB round trip. `roles`/`scrape_runs`
foreign keys still target the integer `id`, per spec.

### `roles`
```sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  external_job_id TEXT,             -- the site's own job ID/ref
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  country TEXT DEFAULT 'India',
  department TEXT,
  experience_level TEXT,            -- 'entry' | 'mid' | 'senior' | 'lead'
  job_type TEXT,                    -- 'full-time' | 'contract' | 'hybrid'
  salary_range TEXT,
  posted_date DATE,
  deadline DATE,
  job_url TEXT NOT NULL,
  source_updated TIMESTAMP,         -- when the site last showed this role
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(employer_id, external_job_id)
);
```

### `role_marks` (user engagement)
```sql
CREATE TABLE role_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  user_id TEXT,                     -- device-scoped id, not an account system
  status TEXT,                      -- 'interested' | 'applied' | 'rejected' | 'closed'
  marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, user_id, status)
);
```
`user_id` is a device identifier for cross-device continuity, not a login
system — this stays a single-owner tool (see §12).

### `scrape_runs` (monitoring)
```sql
CREATE TABLE scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT UNIQUE,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  total_sites_targeted INTEGER,
  sites_succeeded INTEGER,
  sites_failed INTEGER,
  total_roles_found INTEGER,
  roles_added INTEGER,
  roles_updated INTEGER,
  errors TEXT,                      -- JSON array of {employer, message}
  status TEXT                       -- 'in_progress' | 'completed' | 'failed'
);
```
One row per full daily run (aggregate), matching the spec. Per-employer
detail for that run lives in the structured request logs (§2.3/§7.2), not
as separate DB rows — keeps `scrape_runs` cheap to query for a health
dashboard while the logs remain the audit trail.

### `meta`
```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- seeded rows: last_refresh, next_refresh, total_active_roles,
-- total_employers, data_version
```

### 3.1 Indexes
```sql
CREATE INDEX idx_roles_employer ON roles(employer_id);
CREATE INDEX idx_roles_location ON roles(location);
CREATE INDEX idx_roles_posted ON roles(posted_date DESC);
CREATE INDEX idx_roles_active ON roles(is_active);
CREATE INDEX idx_role_marks_user ON role_marks(user_id);
```

---

## 4. Scraper Architecture

**Factory pattern**: `lib/scrapers/ScraperFactory.js` reads `ats_type` from
an employer's config entry and instantiates the matching scraper class, all
extending a shared `BaseScraper`.

**Design principle — one class per ATS family, parameterized per employer,
never one class per organization.** Every employer on a given ATS is served
by the *same* scraper class; what differs between LPL and Wells Fargo is
config data passed into the constructor (tenant/site slug, base URL,
selector overrides), not code. Concretely: `ScraperFactory.create(employer)`
returns `new WorkdayScraper(employer)` for every Workday employer — one
class, N configured instances. Adding employer #35 on an already-supported
ATS is a one-line addition to `config/employers.json`; it should never
require a new class or a code review of scraper logic. This is also why
`CustomScraper` uses a per-site *selector config* (`config/selectors/<id>.json`)
rather than a per-employer subclass — even the least standardized ATS
bucket stays data-driven. A dedicated subclass is only justified when a
site's fetch/parse *mechanism* fundamentally differs (e.g. needs Puppeteer
for JS rendering instead of axios+cheerio), not merely because its HTML
differs.

```
BaseScraper (lib/scrapers/BaseScraper.js)
 ├─ constructor(employerConfig) — captures per-employer params (careers_url,
 │   tenant/site slug, crawl_delay_seconds, selector overrides, ...)
 ├─ checks robots.txt, prefers sitemap.xml when present
 ├─ enforces crawl delay + UA header + 429/403 backoff (§2)
 ├─ abstract fetchListings() -> raw HTML/JSON
 └─ abstract extractRoles(raw) -> [{ title, location, url, postedDate, externalJobId, ... }]

WorkdayScraper   extends BaseScraper   (9 employers, one class)
OracleScraper    extends BaseScraper   (3 employers, one class)
TaleoScraper     extends BaseScraper   (2 employers, one class)
CustomScraper    extends BaseScraper   (20 employers, one class — per-site
                                         CSS selectors from
                                         config/selectors/<id>.json;
                                         puppeteer only for JS-heavy SPAs)
```

`lib/parser.js` normalizes whatever a scraper returns into the `roles`
schema (§3), including a `detectLevel()`-style classifier over
title+description text against `config/filters.json`'s `experience_levels`
keywords, and applies `exclude_keywords`/location filtering before a role
is considered for sync.

### 4.1 Concurrency

Scraper class structure and execution parallelism are independent concerns
— parallelism belongs in the orchestrator, not in how many classes exist.
`refresh.js` runs a **bounded worker pool** (small concurrency cap, e.g. 4–6)
across all active employers regardless of ATS type, with one constraint:
**never two in-flight requests to the same domain at once** (a per-domain
mutex/queue), since crawl-delay is a per-domain courtesy, not a global one.
This gets the speed benefit of parallel scraping without needing per-site
classes and without violating §2's rate-limit policy — a Workday employer
and a Custom employer can scrape concurrently; two Workday employers on
different tenants can too, since `crawl_delay_seconds` only serializes
requests *within* one domain.

Built in **Phase 1** (generic scraper + `BaseScraper` + 3 pilot Workday
sites, per the spec's phase-1 scope, to prove the pattern end-to-end) and
**Phase 2** (remaining ATS-specific coverage).

---

## 5. Frontend Design (Phase 3) ✅ — self-hosted (Phase 3b)

**Self-hosted via `server.js`**, not a Claude Artifact. The board was
originally published as a Claude Artifact (kept at
`https://claude.ai/code/artifact/35691137-5630-4af7-a06c-72cd225e065c` as
a historical/secondary mirror, no longer the primary), but that hosting
model had a hard limitation worth naming plainly: **there is no public
API for a plain Node script to write into a published Artifact's
database.** The `db` capability's write path only exists for a live
page-viewer's own browser or for an interactive Claude Code session's
`write_db` tool action — a `node refresh.js` run has no credentials or
endpoint to push through either way. That made "daily automated refresh"
false advertising: the scrape could run unattended, but getting the
result onto the visible board could not, without a human (or a Claude
session) in the loop every time. See git history on this file for the
full account of that model, if useful context.

Phase 3b replaces that with `server.js` (Express): a small self-hosted
server that serves the frontend (`frontend/public/index.html`) and the
scraped data (`GET /api/roles`, reading `data/roles.json`) directly, over
plain HTTP, with zero Claude dependency in the runtime loop. This is a
genuine architecture change, not a patch — see §6 for how it runs and is
reached from other devices.

**Built in vanilla JS, not React** — no bundler/build step needed for a
plain server-rendered static page; at ~600 rows, in-memory filtering and
`innerHTML` re-rendering is fast enough that a framework wouldn't change
the user experience, only the code size.

- **Live search** across title/employer (client-side, instant).
- **Filters**: experience level, city, employer, and priority-keyword
  focus area (from `config/filters.json`), all as toggleable chips,
  AND'd across facets / OR'd within one.
- **Tabs**: All / Interested / Applied / Rejected / Closed, so marked
  roles are one click away instead of buried in a filtered search.
- **User marks**: interested / applied / rejected / closed, persisted in
  the browser's `localStorage` — this is a single-user personal tool, so
  there's no need for a shared backend just to remember your own marks.
  Tradeoff: marks don't follow you across browsers/devices; see §6 for
  why that's an acceptable default for now.
- **Freshness indicator**: last-refresh relative time, active role count,
  employer coverage (fetched/tracked, with/without results this cycle),
  always visible at the top.
- **On-demand refresh**: a "Refresh now" button calls `POST /api/refresh`,
  which spawns `node refresh.js` as a background child process (guarded
  against overlapping runs) and polls `GET /api/refresh/status` until it
  finishes, then reloads the data — see §6.

---

## 6. Scheduling & Deployment (Phase 3b: local-first)

**Deliberately local-first** (decided 2026-09-14): the board runs on your
own machine, reachable from your own devices only, with a clear path to a
private hosted URL later that needs no rearchitecture — just a different
way of exposing the same unchanged server.

**`server.js`** is a long-running process that does two jobs:
1. Serves `frontend/public/` + `GET /api/roles` (reads `data/roles.json`)
   + `POST /api/refresh` (spawns `node refresh.js`, guarded against
   overlapping runs) + `GET /api/refresh/status`.
2. Schedules the same refresh **in-process** via `node-cron`
   (`REFRESH_CRON` env var, default `0 6 * * *` in `TZ`, default
   `Asia/Kolkata`) — no separate OS-level cron/launchd job needed.

Run it: `npm run serve` (binds `0.0.0.0` by default — already reachable
from other devices on the same network, not just `localhost`).

**Reaching it from your other devices — two tiers, same server:**

1. **Same Wi-Fi / LAN**: open `http://<this-machine's-LAN-IP>:4000` from
   your phone or another computer on the same network. Zero setup beyond
   running the server.
2. **From anywhere, still private to only your own devices**:
   [Tailscale](https://tailscale.com) (free for personal use) — install it
   on this machine and on each device that should reach the board; it
   creates a private mesh network between just those devices (not a
   public exposure of any kind), and the board becomes reachable at your
   Tailscale hostname from anywhere with internet, not just the same Wi-Fi.

**Later, if/when you want an unlisted URL others could use** (no
Tailscale install required on their end): run
[`cloudflared`](https://github.com/cloudflare/cloudflared) (free,
open-source) pointed at the same local port —
`cloudflared tunnel --url http://localhost:4000` — which hands back a
public-but-unlisted HTTPS URL. This requires **zero changes to `server.js`
or the frontend**; it's the same process, just reached a different way.
That's the "minimal effort to go from local to private URL" property this
architecture was chosen for.

**GitHub Actions** (`.github/workflows/refresh-schedule.yml`) still exists
in the repo but is not part of this local-first setup — it predates this
model (references a Claude Artifact publish step that no longer applies)
and is left as a starting point for a possible future fully-cloud-hosted
phase, not something to enable now.

**The original Claude Artifact** (`https://claude.ai/code/artifact/35691137-5630-4af7-a06c-72cd225e065c`)
still exists as a secondary/historical mirror but is no longer kept in
sync automatically or treated as the primary board.

---

## 7. Error Handling & Monitoring

### 7.1 Error categories & actions

| Error type | Example | Action |
|---|---|---|
| Site down | 503 | Log, skip, retry next daily cycle |
| Rate limited | 429 | Back off 1hr within run; skip to next employer; retry next cycle |
| Auth required | 403 | Skip site, alert |
| Parse failure | HTML structure changed | Log sample, flag for manual review |
| DB error | Connection/write failure | Rollback, alert operator |
| Network | Timeout > 30s | Retry up to 2 times, then skip |

### 7.2 Structured log schema

```json
{
  "timestamp": "2026-09-13T00:45:12Z",
  "run_id": "refresh_20260913_0600",
  "level": "INFO",
  "component": "scraper",
  "employer": "goldman-sachs",
  "event": "roles_extracted",
  "count": 42,
  "duration_ms": 3200,
  "status": "success"
}
```

Written via `lib/logger.js` (winston) to console (dev), `logs/combined.log`,
and `logs/error.log` (10MB rotation, 5 files kept).

### 7.3 Health checks

**Daily:** active-role count should hold steady or increase; `last_refresh`
should be < 24h old; alert if more than 5 employers failed in one run.

**Weekly:** review parse errors and flag ATS structure changes; verify
robots.txt compliance hasn't drifted for any active employer.

---

## 8. Implementation Roadmap

| Phase | Scope | Key deliverables |
|---|---|---|
| **0 — Foundation** (this doc) | Architecture, config, scaffold | This file, `docs/SETUP.md`, `config/*.json`, `refresh.js` shell, logger, workflow, folder structure |
| **1 — Database + generic scraper** ✅ | Prove the pipeline end-to-end on 3 pilot Workday employers (per spec §8) | `lib/database.js`, `lib/parser.js`, `lib/scrapers/BaseScraper.js`, `lib/scrapers/ScraperFactory.js`, `WorkdayScraper.js` configured for LPL Financial / Wells Fargo / Invesco — 106 real roles verified end-to-end |
| **2 — ATS-specific scrapers** ✅ | Cover as many of the remaining employers as could be verified live | `OracleScraper`, `CustomScraper` (sitemap + JSON-LD/Microdata + `<title>`/URL fallbacks, optional Puppeteer render mode), `GreenhouseScraper`, 12 Workday employers found by direct verification. **21/33 employers active, 586 real India-based roles** as of 2026-09-14 (Phase 2b). See §8.1 for what didn't make it in and why. |
| **3 — Frontend** ✅ | Job board UI (built vanilla JS, not React — see §5) | Search, filters, marks — originally live via Claude Artifact `db`; superseded by 3b |
| **3b — Self-hosted, local-first** ✅ | Remove the Claude-session dependency from the runtime loop entirely — see §5/§6 | `server.js` (Express + in-process `node-cron`), `frontend/public/index.html` (fetches `/api/roles`, marks in `localStorage`), `lib/publisher.js` writes `data/roles.json`. Reachable from other devices via LAN or Tailscale now; `cloudflared` tunnel is a zero-code-change path to an unlisted URL later. |
| **4 — Hardening** | Make the daily run more resilient | Consecutive-failure detection, notifications, GitHub Actions revisited only if/when a fully cloud-hosted phase is wanted |

### 8.1 Phase 2 / 2b notes: what verification actually found

The source spec's Workday/Oracle/Taleo classification was wrong often
enough (Franklin Templeton, PwC AC, EY GDS, Marsh & McLennan misfiled as
Workday/Oracle when they're Phenom/SuccessFactors; Bank of
America/Barclays/Visa/AIG/CME Group misfiled as "custom" when they're
Workday; Bridgewater misfiled as "custom" when it's Greenhouse) that
**every employer's real platform was checked against its live site**
rather than trusted — see `config/employers.json`'s per-employer `note`
fields for what was found, dated by which pass found it. Design decisions
that came out of this:

- **No dedicated Taleo/Phenom/SuccessFactors/iCIMS scraper classes.**
  "Oracle" in this codebase specifically means Oracle Fusion Recruiting
  Cloud (its public, unauthenticated `recruitingCEJobRequisitions` REST
  API) — no employer was found running genuine legacy Taleo. Phenom,
  SuccessFactors, and unidentified platforms are all served by one
  `CustomScraper` via sitemap.xml + schema.org `JobPosting` structured
  data, because that convention turned out to be shared across vendors
  while each vendor's private search API is not. **Greenhouse got its own
  type** (`GreenhouseScraper`) despite the same reasoning, because its
  `boards-api.greenhouse.io` is itself a clean, public, documented REST
  API — closer in kind to Oracle Fusion than to the sitemap-scraping
  vendors.
- **`CustomScraper` grew a render mode and a fallback chain, both found
  necessary by testing, not designed upfront.** `custom.render: true`
  switches detail-page fetching to a headless browser (Puppeteer) for
  tenants that render job content entirely client-side (Standard
  Chartered's SuccessFactors instance — EY GDS's SuccessFactors instance,
  by contrast, is server-rendered; same vendor, different deployment).
  Separately, when structured data is present but incomplete — Standard
  Chartered's Microdata tags only `description`, not title or location —
  extraction falls back to the page's `<title>` tag for the title and a
  known city name in the URL for location, in that order, only filling
  gaps the stronger source left.
- **Three bugs only surfaced by testing against live sites, not sample
  data:** a location pre-filter that hard-filtered to zero candidates for
  platforms whose URL slugs don't embed a city name (fixed: rank instead
  of filter); a JSON-LD-only extractor that silently found nothing on
  Microdata tenants (fixed: try both); and `exclude_keywords`/location
  matching via plain `.includes()`, which matched "Intern" inside
  "international" and let "India" win over "Pune" in a first-match scan
  (fixed: word-boundary regex, longest-match-first for location).
- **A confirmed platform is not always a green light.** Charles Schwab
  turned out to be iCIMS, but its robots.txt disallows crawling
  *everything* (`Disallow: /` for `User-agent: *`), not just careers —
  moved to `excluded` outright rather than left "pending," since building
  a scraper for it would mean ignoring what its own robots.txt says.
  Blackstone's apparent "Workday" signal was actually a Cloudflare
  bot-challenge page mentioning the word incidentally, confirmed even via
  a real headless browser — genuinely bot-protected, not a flaky static
  fetch, so it's a stop per §12, not a "try harder" TODO.

**Remaining inactive employers (11 of 33)**: confirmed bot-protected (UBS,
BNP Paribas, Blackstone — not something to work around); and platforms
that render real content even under a full headless browser but match no
known ATS vendor, so are presumed proprietary in-house builds (Vanguard,
Goldman Sachs, Morgan Stanley, Deutsche Bank, Citadel) or are still
unidentified after repeated false-positive vendor-string matches (KPMG,
Zurich, ICE). Each has a dated `note` in config explaining which.

### 8.1.1 Phase 2c: Deloitte USI, and a robots.txt parser bug

Deloitte USI's own real career site turned out to be
`usijobs.deloitte.com/en_US/careersUSI` — a distinctly-branded hostname on
the same Avature tenant as `deloitteus.avature.net`, not a separate
platform. It genuinely has no job-search sitemap (its generic
`sitemap.xml` is a one-entry favicon stub), so a new `AvatureScraper`
class was built around the only real enumeration surface: the
server-rendered, paginated search-results HTML
(`?jobRecordsPerPage=10&jobOffset=N`). Detail pages do carry schema.org
`JobPosting` JSON-LD, but multi-location postings — the norm on this
tenant — leave `jobLocation` empty; the real per-city list lives in a
separate `.article__header--locations` HTML block that JSON-LD doesn't
cover, so the scraper reads that directly rather than trusting JSON-LD
location.

Wiring this up surfaced a real bug in `BaseScraper`'s robots.txt parser:
it matched rules with plain `pathToCheck.startsWith(rule)`, treating `*`
as a literal character instead of the wildcard the robots.txt spec
defines it as. Deloitte's robots.txt allows every locale-prefixed careers
path via `Allow: /*/careers`, but the literal-string check never matched
it, so the file's catch-all `Disallow: /` silently won and every such
path read as blocked when it wasn't. Fixed by compiling each rule to a
real regex (`*` → `.*`, trailing `$` → an end anchor) — verified against
Deloitte USI (now correctly `allowed: true`) and re-checked against every
other active employer's robots.txt to confirm none flipped the other way.

---

### 8.2 Manually-tracked employers

Not every employer that matters belongs in the automated pipeline. Two
distinct reasons an employer ends up here instead of `active: true`:

**Policy stop — will not be automated, by design (6):** the employer's own
site says not to. Robots.txt disallowing everything, or a hard bot-wall,
is a clear signal, and evading it (rotating IPs, spoofing headers, solving
challenges) is exactly what §12 rules out. Checking these by hand — a
human visiting a public page isn't what robots.txt governs — is the
correct alternative, not a scraper workaround.

| Employer | Reason | Job board (check manually) |
|---|---|---|
| Citigroup | robots.txt: `Disallow: /search-jobs/` | https://jobs.citi.com/search-jobs |
| JPMorgan Chase | 403 authentication wall | https://www.jpmorganchase.com/careers |
| Charles Schwab | robots.txt: `Disallow: /` for every user-agent | https://schwabjobs.com |
| UBS | 403, confirmed bot-protected | https://jobs.ubs.com |
| BNP Paribas | 403, confirmed bot-protected | https://group.bnpparibas/en/careers |
| Blackstone | Cloudflare challenge page, confirmed even via headless browser | https://www.blackstone.com/careers |

**Backlog — not yet automated, no policy blocker (8):** these employers
don't forbid crawling; they just don't fit `CustomScraper`'s sitemap +
structured-data convention yet, or their real platform hasn't been
identified. Candidates for a future phase (dedicated CSS-selector
scrapers per docs/ARCHITECTURE.md §4's "genuinely bespoke" carve-out),
worth checking by hand in the meantime. (Deloitte USI was in this table
until 2026-09-14 — see §8.1.1 for the `AvatureScraper` that moved it to
active.)

| Employer | Status | Job board (check manually) |
|---|---|---|
| Vanguard | Real content, no known ATS vendor — likely proprietary | https://www.vanguard.in/ |
| Goldman Sachs | Real content, no known ATS vendor — likely proprietary | https://higher.gs.com/roles |
| Morgan Stanley | Real content, no known ATS vendor — likely proprietary | https://www.morganstanley.com/careers/students-graduates/experienced-professionals |
| Deutsche Bank | Real content, no known ATS vendor — likely proprietary | https://careers.db.com/search-results |
| Citadel | Real content, no known ATS vendor — likely proprietary | https://www.citadel.com/careers/open-opportunities/ |
| KPMG | Marketing site only; real ATS URL not found | https://www.kpmguscareers.com/ |
| Zurich Insurance | Real URL not yet found; India ops may sit under a separate JV (Zurich Kotak) | https://www.zurich.com/careers |
| ICE | Real platform not identified (two false-positive vendor matches so far) | https://careers.ice.com |

See `config/employers.json`'s per-employer `note` field for the full,
dated finding behind each row above.

## 9. Configuration File Templates

`config/employers.json` — one entry per employer:
```json
{ "id": "example-bank", "name": "Example Bank", "domain": "example.com",
  "careers_url": "https://careers.example.com", "ats_type": "workday",
  "crawl_delay_seconds": 5, "active": true }
```

`config/filters.json`:
```json
{ "locations": ["India", "Bangalore", "Mumbai", "..."],
  "job_types": ["Full-time", "Contract", "Hybrid"],
  "experience_levels": ["Entry", "Mid", "Senior", "Lead"],
  "exclude_keywords": ["Intern", "Trainee", "freelance"] }
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
| Scheduling | node-cron (local) + GitHub Actions cron | redundant, matches §6 |
| Logging | winston | rotation, levels, structured output |
| Frontend | React, published as a Claude Artifact | no separate hosting needed |
| Testing | jest + nock | HTTP mocking for scraper tests without hitting real sites |

---

## 11. Success Metrics

- **Coverage**: 34/34 employers actively scraped, or explicitly
  `active: false` with a documented reason.
- **Compliance**: 0 robots.txt violations, 0 sustained rate-limit blocks.
- **Freshness**: daily run completes before 7:00 AM IST; surfaced roles
  posted within the last 7 days where the source site provides a date.
- **Reliability**: ≥90% of daily runs in a 30-day window complete without
  manual intervention (looser than the spec's "100%" given a daily,
  unattended cadence has more surface area for transient site issues than
  the spec's twice-weekly run).
- **Signal quality**: <10% of surfaced roles are false positives against
  the `experience_level`/location filters (spot-checked monthly).
- **Personal usefulness**: the frontend is actually checked and roles are
  actually marked — the real metric this project exists for. (The spec's
  "342 live roles" launch target is not carried over here — it's not a
  number this scaffold can verify yet; a real target should come from
  Phase 1 pilot-scrape data, not be assumed upfront.)

---

## 12. Out of Scope (explicitly)

- No email/SMS notifications (frontend-only, checked manually).
- No multi-user accounts — `role_marks.user_id` is a device identifier for
  cross-device continuity on one person's own devices, not an auth system.
- No scraping of application forms, salary negotiation data, or any
  authenticated employer-portal content.
- No circumvention of anti-bot measures (CAPTCHA solving, IP rotation,
  browser fingerprint spoofing). A site that requires this is out of scope
  per §2 and gets marked `active: false`.
- No cloud/Postgres deployment for now — single-user, file-based SQLite is
  sufficient; revisit only if usage patterns change.
