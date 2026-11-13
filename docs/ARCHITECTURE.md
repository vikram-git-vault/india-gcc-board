# India GCC Board: architecture

**Status:** Phases 0 to 3b and 5 to 8 are complete. | **Owner:** the repository owner | **Last update:** 2026-11-13

India GCC Board is a personal job board. It runs on your own computer.
It checks the career sites of 161 employers: BFSI (banking, financial services and insurance) employers and employers in other industries.
It keeps the leadership roles in India GCC hub cities: Bengaluru, Mumbai, Delhi NCR, Pune, Hyderabad, Chennai, Gurugram and Noida.
It shows only the roles that match a target profile, and it scores each role against the master CV, as a product owner and as an engineering leader.

**Terms that this document uses:**

| Term | Meaning |
|---|---|
| Role | One job opening on an employer career site. |
| Shortlisted role | A role with the tier "target" or "exception". |
| Refresh | One run of `refresh.js`: scrape, classify, store, get descriptions, publish. |
| Career site | The public job pages of an employer. |
| Board | The web page that `server.js` shows. |

This document starts from the source specification `BFSI_Job_Board_Architecture_Spec.md`.
This document is different from the specification in one item: the refresh occurs each day at 06:00 IST.
The specification gives Monday and Thursday at 08:00 IST. This change was a decision on 2026-09-13.

---

## 1. System architecture

Two interactive diagrams show this section. Open them in a browser:

- [`diagrams/architecture.html`](diagrams/architecture.html): the components and the connections between them.
- [`diagrams/dataflow.html`](diagrams/dataflow.html): the data flow, from the career sites to the board.

Each box in the diagrams has links to the source lines at commit `f06d0c0`.

### 1.1 Data flow

```
Career sites (92 automated employers)
        ↓
Scrapers (one class for each ATS type; robots.txt, crawl delay)
        ↓
Parser (normalize, filter by location and keywords)
        ↓
Targeting (grade, family, tier from the title: config/targets.json)
        ↓
SQLite database (employers, roles, role_scores, scrape_runs, meta)
        ↓
Descriptions (full job description for target and exception roles)
        ↓
Scoring (ATS and fit scores against the master CV, PO and EM: score.js)
        ↓
Publisher (data/roles.json: target roles, and exception roles with fit 75 or more)
        ↓
server.js (board web page and API)
        ↓
User (search, filter, sort by score, mark roles)
```

### 1.2 Components

| Component | Technology | Function |
|---|---|---|
| Scraper | Node.js, axios, cheerio. Puppeteer only for pages that need JavaScript. | Gets the role lists from each ATS. |
| Parser | Node.js, cheerio | Changes the raw data into the `roles` schema. Applies `config/filters.json`. |
| Targeting | `lib/targeting.js`, `config/targets.json` | Gives each role a grade, a family and a tier from its title. |
| Descriptions | `lib/descriptions.js` | Gets the full job description of each shortlisted role from the ATS detail API. |
| Scoring | `score.js`, `lib/scoring.js`, `config/scoring-rubric.md` | Exports the roles that need a score. Validates and stores the scores. |
| Database | SQLite (`data/jobs.db`) | Stores the employers, the roles and the scores. |
| Publisher | `lib/publisher.js` | Writes `data/roles.json` for the board. |
| Server | Express, node-cron (`server.js`) | Shows the board and the API. Runs the daily refresh. |
| Frontend | Static HTML, CSS and JavaScript (`frontend/public/`: `index.html`, `js/board.js`, `css/board.css`) | The board: search, filters, scores, marks. |

### 1.3 Refresh timeline (approximate)

1. **06:00 IST:** the scheduler starts the refresh.
2. **06:00 to 06:15:** the scrapers get the roles of all active employers, 6 employers at the same time (refer to section 4.1).
3. **For each employer:** the parser normalizes and filters the roles, and the targeting rules classify each role. The refresh then writes the roles of that employer to the database. It writes `data/roles.json` not more than one time in 30 seconds. Thus the board shows the new roles while the refresh continues.
4. **06:15:** the refresh starts the next stage.
5. **06:15 to 06:20:** the refresh gets the new job descriptions (approximately 5 seconds for each role).
6. **06:20:** the publisher writes `data/roles.json`. The board shows the new data.

Scoring is a separate step. Refer to section 13.

Each stage has its own module and its own tests. `refresh.js` connects the stages in sequence. It does not contain scraping or parsing logic.

---

## 2. Scraping policy

**Rule:** obey the directives of each site. Scrape only the public career pages that a site lets crawlers index.
Do not scrape pages behind a login. Do not collect personal data. Do not scrape resume databases.

| Rule | Implementation |
|---|---|
| robots.txt | The scrapers read robots.txt for each domain before they crawl. If robots.txt disallows the careers path, the employer becomes `active: false`. The description fetcher checks robots.txt for the detail API path. |
| Sitemaps | The scrapers use `/sitemap.xml` job URLs when a site has them. |
| Crawl delay | 5 to 10 seconds between requests to the same domain (`crawl_delay_seconds` for each employer). The refresh does not send parallel requests to one host. |
| User-Agent | `india-gcc-board-bot/1.0 (+github repository URL)`. The scrapers do not use a browser User-Agent to hide. |
| Blocks | When an employer site answers 429 or 403, the refresh records an error and continues with the next employer. The next daily refresh tries again. The refresh does not repeat requests to a host that blocks it. |
| Data use | Use the data only for your personal search. Do not sell the data. Do not give the data to other persons. |
| Authentication | Scrape only public pages. |
| Terms of use | Read the terms of use of a site before you add it. If the terms prohibit automated access, do not scrape the site, also when robots.txt permits it. |
| Job aggregators | Do not scrape roles from job aggregators (for example LinkedIn, Naukri, Indeed, Talent500). Get each role from the career site of the employer. |
| Talent500 | The terms of use of Talent500 (6 February 2025) prohibit crawling and automated access. The owner decided to use its jobs sitemap for company discovery only (refer to section 15). This is a manual run, not part of the refresh. |
| Data minimization | The database stores the title, the location, the department, the URL, the dates, the job description and the source job ID. It does not store applicant data. |

### 2.1 Site classification

- **Automated (106 employers):** robots.txt permits the careers paths, and the site does not need a login.
- **Excluded by policy (0 employers):** the list is empty since 2026-11-03. Citigroup, JPMorgan Chase and Charles Schwab were in this list. Their real job systems permit crawlers (refer to section 8.2.1).
- **Inactive (55 employers):** bot protection, no scraper yet for their ATS, or no India roles on their site. Refer to section 8.2 and `docs/EMPLOYERS.md`.

If a site later prohibits scraping, add the employer to the `excluded` list and set `active: false`.
Do not remove the employer from the configuration. Do not write logic that evades a block.

### 2.2 Scraper strategy for each ATS type

| ATS type | Active employers | Method |
|---|---|---|
| Workday | 56 | The public CXS JSON search API (`/wday/cxs/<tenant>/<site>/jobs`), with the search text "India" when the site is not specific to India. Workday gives `total` only on the first page. The next pages show `total: 0`. Thus the scraper keeps the total of the first page. Before 2026-11-03, it used the 0 and stopped each employer at 40 roles. |
| Oracle Fusion Recruiting Cloud | 5 | The public REST API `recruitingCEJobRequisitions`, with the location filter `India` on the server. |
| Greenhouse | 3 | The public API `boards-api.greenhouse.io`. |
| Avature | 2 | The server-rendered search result pages, and the location block on each detail page. `custom.search_params` adds a server filter (MetLife: `semanticSearch=India`). When the list has no total, the scraper reads pages until a page is empty. When a detail page has no title, location or description block, the scraper uses the banner title, the location on the list card and the "Description" block. |
| Phenom | 8 | `POST /widgets` with `ddoKey` `refineSearch` and the country filter `India`, 50 jobs on each page. This is the call that the search page of the site makes. The descriptions stage uses `ddoKey` `jobDetail`. robots.txt on Phenom sites blocks `*/px-widgets`, `*/apply` and `*/jobcart`, but not `/widgets`. Each employer has its own `lang`, `country` and URL `path` in its `phenom` block. Read these values from the home page of the site. |
| Eightfold | 4 | Two APIs. HSBC uses `/api/apply/v2/jobs`. PayPal, NAB and HP use `/api/pcsx/search` (`eightfold.api: "pcsx"`), because there the older API answers 403. Both take `domain` and `location=India`, with 10 positions on each page. The descriptions stage uses `/api/apply/v2/jobs/<id>` or `/api/pcsx/position_details`. |
| Jibe | 8 | `GET /api/jobs?location=India`, 100 jobs on each page, with the full description. Jibe is a front end for iCIMS (AMD, Gallagher, Aon, ICE, Schneider Electric, DocuSign, Publicis). The location filter removes the jobs outside India. |
| BrassRing | 1 | The search page gives a session value and a request token in hidden inputs. Then `POST /TgNewUI/Search/Ajax/MatchedJobs` with the location `India`, 50 jobs on each page, with a short description. The location search uses the country field, thus a city name finds no job (UBS). |
| Amazon | 1 | `GET /en/search.json` with `normalized_country_code[]=IND`, 100 jobs on each page, with the description and the qualifications. |
| Custom | 18 | `sitemap.xml` and schema.org `JobPosting` data (JSON-LD, also inside `@graph`, or Microdata). Puppeteer for tenants that need JavaScript (`custom.render: true`). The scraper reads first the job URLs that contain an Indian city name. It does not read a known page again unless the sitemap `lastmod` is newer (refer to section 3). Radancy sites (Moody's, Intuit), SuccessFactors career sites (ANZ, Nomura) and sites with a vacancy sitemap (Experian, Wise) use this method. |

For the list of employers for each ATS type, refer to `docs/EMPLOYERS.md`.

The reason for each inactive employer is in its `note` in `config/employers.json`. The main reasons are:

- The site refuses automated requests (HTTP 403, timeouts, a Cloudflare challenge). Examples: The Standard, Alvarez & Marsal, Citadel, Envestnet, BNP Paribas, American Express.

> **NOTE:** A 403 on the corporate careers page does not always block the job system. On 2026-11-03, a check found an open job system behind 8 "blocked" employers (refer to section 8.2.1). Before you set an employer to inactive, open the careers page with a normal browser and find the link to the real ATS.
- robots.txt blocks the job API or the whole host. Examples: American Airlines (`/services/`), Swiss Re (`Disallow: /`), the SmartRecruiters API host.
- The site has no India roles, or posts its India roles on a different site. Examples: Under Armour, Principal, T. Rowe Price, Lloyds.
- The configured address no longer exists (HTTP 404). Examples: Morgan Stanley, Deutsche Bank.
- The site needs its own scraper. Examples: Goldman Sachs, Atlassian, Deutsche Börse, Google, Apple.

### 2.2.1 robots.txt rules

`isPathAllowed()` in `lib/scrapers/BaseScraper.js` reads the rules for `User-agent: *`. The longest rule that matches wins. `*` matches any characters, and `$` marks the end of the path. All other characters are literal, also `?`. Before 2026-10-14, `?` was not literal. Thus the rule `Disallow: /jobs?*` also blocked `/job/`.

### 2.3 Logs

The logger writes structured lines. Refer to section 7.2 for the format.

Look for these events:

- 403 or 429 responses (the refresh stops requests to that employer for that run).
- Changes to robots.txt (examine them before the next run).
- Responses that take more than 30 seconds.
- An employer for which most description fetches report a closed role, or all fail (refer to section 13.2).

---

## 3. Data schema

`lib/database.js` makes the SQLite database `data/jobs.db` (`node refresh.js --init`).
The same command adds new columns to an existing database. It does not delete data.

### `employers`

```sql
CREATE TABLE employers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,        -- the "id" in config/employers.json, for example "bny"
  name TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL,
  careers_url TEXT NOT NULL,
  ats_type TEXT,                    -- 'workday' | 'oracle' | 'greenhouse' | 'avature' | 'custom' | 'manual'
  robots_txt_compliant BOOLEAN DEFAULT 1,
  crawl_delay_seconds INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT 1,
  last_scraped TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

The specification uses only an integer key. This schema adds `slug` as a unique key.
The code can then refer to an employer with the same text ID as `config/employers.json`.
The foreign keys in `roles` and `scrape_runs` use the integer `id`.

A manual job (section 3.0.2) from a company that is not in `config/employers.json` gets an employer row with the slug `manual-<name>` and `ats_type` 'manual'. The refresh reads its employers from `config/employers.json` only, so it never scrapes this row.

### `roles`

```sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  external_job_id TEXT,             -- the job ID on the employer site
  title TEXT NOT NULL,
  description TEXT,                 -- the text from the scraper (often empty)
  location TEXT,
  country TEXT DEFAULT 'India',
  department TEXT,
  experience_level TEXT,            -- 'entry' | 'mid' | 'senior' | 'lead', from the title only
  job_type TEXT,
  salary_range TEXT,
  posted_date DATE,
  deadline DATE,                    -- the closing date (JSON-LD validThrough, Oracle PostingEndDate)
  job_url TEXT NOT NULL,
  source_updated TIMESTAMP,
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1,
  -- targeting (section 11)
  grade TEXT,                       -- for example 'VP', 'Director', 'AVP'
  family TEXT,                      -- for example 'Product'
  tier TEXT,                        -- 'target' | 'exception' | 'excluded'
  tier_reason TEXT,
  -- descriptions (section 13.2)
  full_description TEXT,            -- from the ATS detail API; syncRoles does not write it
  description_status TEXT,          -- 'ok' | 'gone' | 'error' | 'skipped'
  description_error TEXT,
  description_fetched_at TIMESTAMP,
  changed_date DATE,                -- the last day that the title or the text changed (the CV gate)
  source TEXT,                      -- 'manual': the owner added the role; NULL: scraped
  UNIQUE(employer_id, external_job_id)
);
```

The key of a role is the employer and the job ID (`external_job_id`). `syncRoles` in `lib/database.js` sets a role to inactive only for one of these reasons:

- The closing date (`deadline`) is before today (UTC).
- The job ID is no longer on the employer site. The scraper must read the full list to know this (refer to section 3.0.1).
- The scraper read the detail page, and the page shows that the role is closed.

A role that a run did not read stays active. When a role is on the site again, it becomes active again. A role with a past closing date does not become active again.

#### 3.0.1 The full list for each scraper type

| Scraper | Full list | Result |
|---|---|---|
| Workday, Oracle, Greenhouse | All pages of the API search | A job ID that is not in the list becomes inactive. |
| Eightfold, Phenom, Jibe, Amazon, BrassRing | All pages, if the total is not more than `max_pages` | Not more than `max_pages`: as for Workday. More than `max_pages`: no role becomes inactive because it is not in the list. |
| Custom (sitemap) | The job URLs in the sitemap | A stored role whose URL is not in the sitemap becomes inactive. A stored role whose URL is in the sitemap stays active, or becomes active again. |
| Avature | The search pages, only when the scraper reads all of them | The scraper stops when it has `max_detail_fetches` new URLs. Then no role becomes inactive because it is not in the list. The scraper uses the remaining fetches to read the known roles again, the oldest first. A page with no title is a closed role. |

> **NOTE:** An empty sitemap list does not make roles inactive. An empty list usually shows a broken sitemap or URL pattern, not closed roles.

#### 3.0.2 Manual jobs

The owner can add a job that the board did not scrape: with the **Add a job** form on the board (`POST /api/manual-jobs`), or with `node tools/add-job.js` (the `/tailor-role` skill). `lib/manual-job.js` does these steps:

1. If a role has the same link (a query or a last "/" is not part of the compare), it uses that role. It does not add a second role.
2. If the owner gave no job text, it reads the link. For a Workday link, it uses the Workday job API. For other links, it reads the schema.org `JobPosting` data in the page. If it gets less than 500 characters, the owner must paste the text. LinkedIn, Naukri and pages with a login always need the pasted text.
3. It adds the role with `source` 'manual', `tier` 'target', the posted date of today, and the text in `full_description`.

The server reads only public internet addresses. It refuses loopback, private and link-local addresses, also after a redirect.

Rules for a manual role:

- The refresh never closes it, never classifies it again and never fetches its description again. A scrape of the same job ID changes nothing. The owner closes it with the **Closed** mark.
- The board always shows it. The exception and employer minimum scores do not hide it.
- It gets the same RM scoring, career-ops evaluation, CV gate and fact checks as a scraped role. The scoring starts when the owner adds it. If the board is busy, it starts when the work in progress ends.
- The 3-day CV limit (`tailoring.max_age_days`) does not apply.
- When it fails the gate, the board shows **Make CV anyway** (`POST /api/roles/:id/make-cv`, `tailor.js --role ID --force-cv`).

The owner made these decisions on 2026-11-12.

### `source_urls`

```sql
CREATE TABLE source_urls (
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  url TEXT NOT NULL,
  lastmod TEXT,                     -- the sitemap lastmod when the scraper read the page
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employer_id, url)
);
```

This table records each detail page that `CustomScraper` or `AvatureScraper` read, with or without a role. A role outside India is not stored in `roles`. Without this table, the scraper reads its page again in each run.

Before each employer, `refresh.js` gives the scraper the known URLs (`getKnownUrls`). The scraper reads these pages in this sequence, up to `max_detail_fetches`:

1. The pages that it did not read before.
2. The known pages with a sitemap `lastmod` that is newer than the last read.

The scraper does not read a known page again if its `lastmod` did not change. Thus the coverage of a large employer increases in each run.

### `role_scores`

```sql
CREATE TABLE role_scores (
  role_id INTEGER PRIMARY KEY REFERENCES roles(id),
  po_ats INTEGER NOT NULL,          -- Product Owner resume: ATS score
  po_fit INTEGER NOT NULL,          -- Product Owner resume: fit score
  em_ats INTEGER NOT NULL,          -- Engineering Leader resume: ATS score
  em_fit INTEGER NOT NULL,          -- Engineering Leader resume: fit score
  recommended TEXT NOT NULL,        -- 'PO' | 'EM'
  ats_score INTEGER NOT NULL,       -- the scores of the recommended resume
  fit_score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  matched_keywords TEXT NOT NULL,   -- JSON array
  gaps TEXT NOT NULL,               -- JSON array
  confidence TEXT NOT NULL,         -- 'high' | 'low'
  scorer TEXT NOT NULL,             -- for example 'claude-code'
  rubric_version INTEGER NOT NULL,
  description_hash TEXT NOT NULL,   -- the title and description that the score used
  scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `tailored_docs`

```sql
CREATE TABLE tailored_docs (
  role_id INTEGER PRIMARY KEY REFERENCES roles(id),
  description_hash TEXT NOT NULL,   -- the title and description that career-ops used
  status TEXT NOT NULL,             -- 'ready' | 'evaluated' | 'failed'
  score REAL,                       -- the career-ops score, 1 to 5
  decision TEXT,                    -- for example 'Apply' or 'Consider'
  report_num TEXT,                  -- the career-ops report number
  folder TEXT,                      -- the folder of the Word files
  cv_file TEXT,                     -- the Word CV file name, or NULL
  cover_file TEXT,                  -- the Word cover letter file name, or NULL
  gaps TEXT NOT NULL DEFAULT '[]',  -- JSON array: job requirements that are not in the master CV
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,  -- failed runs with the same description
  rerun INTEGER NOT NULL DEFAULT 0,     -- 1: send again in the next run (the owner added a skill)
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

`tailor.js` writes this table. Refer to section 16.

### `role_marks`

```sql
CREATE TABLE role_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  user_id TEXT,
  status TEXT,                      -- 'interested' | 'applied' | 'rejected' | 'closed'
  marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, user_id, status)
);
```

> **NOTE:** The board does not use this table. The board keeps the marks in the `marks` table. Refer to section 5.

### `marks`

```sql
CREATE TABLE marks (
  role_id INTEGER PRIMARY KEY REFERENCES roles(id),
  status TEXT NOT NULL,          -- 'interested' | 'applied' | 'rejected' | 'closed'
  marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tracker_status TEXT            -- the career-ops tracker status that the last sync wrote
);
```

One row for each marked role. Refer to section 5 and section 16.6.

### `gap_answers`

```sql
CREATE TABLE gap_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  gap TEXT NOT NULL,             -- the gap from the career-ops report
  answer TEXT NOT NULL,          -- the owner's words, also added to cv.md
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Refer to section 16.3.

### `scrape_runs`

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

The refresh writes one row for each full run. The logs keep the details for each employer.

### `meta`

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- rows: last_refresh, total_active_roles, total_employers, data_version
```

### 3.1 Indexes

```sql
CREATE INDEX idx_roles_employer ON roles(employer_id);
CREATE INDEX idx_roles_location ON roles(location);
CREATE INDEX idx_roles_posted ON roles(posted_date DESC);
CREATE INDEX idx_roles_active ON roles(is_active);
CREATE INDEX idx_roles_tier ON roles(tier);
CREATE INDEX idx_role_marks_user ON role_marks(user_id);
```

---

## 4. Scraper architecture

`lib/scrapers/ScraperFactory.js` reads `ats_type` from the employer configuration.
It makes an object of the related scraper class. All scraper classes extend `BaseScraper`.

**Design rule:** use one class for each ATS type. Do not make one class for each employer.
The configuration in `config/employers.json` gives the differences between employers (tenant, site, sitemap URL).
To add an employer on a supported ATS, add one entry to `config/employers.json`. Do not add a class.
Make a new class only when the fetch method or the parse method is different (for example, Avature).

```
BaseScraper (lib/scrapers/BaseScraper.js)
 ├─ constructor(employer): keeps the configuration of the employer
 ├─ checkRobotsTxt(): reads robots.txt and applies the * and $ rules
 ├─ delay(): the crawl delay of the employer
 ├─ fetchListings(): abstract; gets the raw data
 └─ extractRoles(raw): abstract; returns [{ title, location, url, postedDate, externalJobId, ... }]

WorkdayScraper    (56 employers)
OracleScraper     (5 employers)
GreenhouseScraper (3 employers)
AvatureScraper    (2 employers)
EightfoldScraper  (4 employers)
PhenomScraper     (8 employers)
JibeScraper       (8 employers)
AmazonJobsScraper (1 employer)
BrassRingScraper  (1 employer; UBS)
CustomScraper     (18 employers; sitemap and JobPosting data; optional Puppeteer)
```

`lib/parser.js` changes the scraper output into the `roles` schema. It does these steps:

1. It removes HTML from the title and the description.
2. It finds the city. When two city names match, the parser selects the longer name.
3. It sets `experience_level` from the title only.
4. It classifies the role with `lib/targeting.js` (section 11).
5. It applies `exclude_keywords` and the location list in `config/filters.json`. It uses whole-word matches.

### 4.1 Concurrency

The refresh scrapes not more than 6 employers at the same time (`lib/pool.js`). `refresh.scrape_concurrency` in `config/settings.json` changes the number (1 to 16).

- Each active employer has its own host. Thus each host gets one request at a time, with the crawl delay of the employer between requests.
- The refresh starts the slowest employers first. It uses the time of each employer in the last run (`seconds` in the checkpoint). For an employer with no time, it uses an estimate: `max_detail_fetches` multiplied by the crawl delay, plus 2 seconds for each page.
- The refresh writes each employer to the database when it finishes. It writes `data/roles.json` not more than one time in 30 seconds, and one time at the end of the scrape stage.
- If the Mac can sleep (refer to section 6), the refresh starts no new employer. The employers in progress finish. Then the refresh pauses.
- If an employer fails and the Mac slept after the employer started, the refresh tries that employer one more time.
- If an employer fails because the computer has no network, the refresh waits for the network (refer to section 4.2).

### 4.2 Network loss

After a wake or a Wi-Fi change, the Mac can be without a network for some minutes. On 2026-10-18, the network stopped 2 minutes into a catch-up run. Each request failed immediately, and 86 employers failed in 1.4 seconds. The run completed with exit code 0, so the server did not try it again.

`lib/network.js` prevents this:

- **Network errors.** These error codes show that the computer has no network: `ENOTFOUND`, `EAI_AGAIN`, `EADDRNOTAVAIL`, `ENETUNREACH`, `ENETDOWN`, and the browser errors `net::ERR_NAME_NOT_RESOLVED`, `ERR_INTERNET_DISCONNECTED`, `ERR_NETWORK_CHANGED` and `ERR_ADDRESS_UNREACHABLE`. HTTP errors, `ECONNRESET` and `ETIMEDOUT` are problems of one site.
- **Network check.** The check opens a TCP connection to `scraping.network_check_host` (`github.com`) on port 443. The check needs DNS and a route.
- **Wait and try again.** When an employer fails with a network error, the refresh does the network check. If there is no network, the refresh starts no new employer. It does the check every 30 seconds (`refresh.network_check_seconds`). When the network is back, it tries each employer that failed again. All employers share one wait.
- **Pause.** If the network is not back after 15 minutes (`refresh.network_wait_minutes`), the refresh saves the checkpoint and stops with exit code 69. The server sets `paused` in `GET /api/refresh/status`. At each catch-up check, the server continues the run with `--resume` when there is a network.
- **Start.** A scheduled, catch-up, retry or resumed run does not start without a network. A **Refresh now** click always starts.
- **Detail pages.** In the sitemap and Avature scrapers, a network error stops the employer immediately, so that the refresh can wait and try again. If every detail page of an employer fails for another reason, the employer fails. Before this change, the result was "0 roles" and the employer counted as a success.
- **Too many failures.** If more than 50% of the employers fail (`refresh.max_failed_percent`), the run is not complete. The refresh does not write `completed_at` or `last_refresh`, and it stops with exit code 1. The summary starts with "Refresh NOT complete". The server tries the run again after 10 minutes with `--resume`, and the retry scrapes only the failed employers. The roles from the employers that succeeded stay in the database and on the board.

The first full run with 6 employers at the same time (2026-10-16, on a copy of the database) took 14 minutes for 92 employers. The run before it took 96 minutes. The total work of the employers was 83 minutes in both runs. Nomura was the longest employer (9.5 minutes).

> **NOTE:** If two employers use the same host in the future, set a lower `refresh.scrape_concurrency` or give them a larger crawl delay. The pool does not limit requests for each host.

---

## 5. Frontend

`server.js` shows the board. The board is not a Claude Artifact now.

The first version of the board was a Claude Artifact.
A Node.js script cannot write to the database of a published Artifact. Because of this, the daily refresh did not update the board without a person or a Claude session.
Phase 3b replaced the Artifact with `server.js`. The old Artifact is a historical copy. It does not update.

The board is static HTML and JavaScript. It does not use React or a build step.
The board has fewer than 100 shortlisted roles. Because of this, the browser filters the roles quickly.

The board has these functions:

- **Layout:** a navy header with the status, the search and the sort. A filter column on the left. One role in each row. The page is up to 1440 pixels wide. On a phone, the filters are in a **Filters** panel.
- **Scores:** each role shows two score blocks: **ATS score** and **RM score** (recruiter match; the `fit` value in the data). Green is 75 or more. Saffron is 50 to 74. Grey is less than 50.
- **Recommended resume:** each role shows the resume to send (Product Owner or Engineering Leader).
- **Why this score:** a panel shows the reason, the matched keywords, the gaps, and the scores for both resumes.
- **Sort:** best RM score (the default), best ATS score, newest, employer, title.
- **Filters:** RM score band, grade, role family, city, posting date, employer. The filters use AND between groups and OR in one group. The posting date filter is different: you select one band at a time (within 1 day, 3 days, 5 days, 1 week, 2 weeks or 1 month, more than a month, or date unknown). The "within" bands include the newer roles. Each band shows its number of roles.
- **Search:** by title or employer.
- **Tabs:** Open, Interested, Applied, Rejected, Closed. The Open tab shows all roles, but not the roles with the mark Applied or Rejected. These roles show only in their own tab. When you remove the mark, the role goes back to the Open tab.
- **Marks:** Interested, Applied, Rejected, Closed. The server keeps the marks in the `marks` table (`GET /api/marks`, `PUT /api/roles/:id/mark`). All browsers and devices show the same marks. The browser keeps a copy in `localStorage`. The first time that a browser opens the board, it sends its old marks (from before the server kept them) to the server.
- **Status bar:** the status bar shows these items:
  - The time of the last refresh.
  - The number of shortlisted roles.
  - The number of scored roles and hidden exception roles.
  - The employer coverage.
- **Auto refresh:** a control in the header. Select **Daily at** a time, or **On demand only**. Refer to section 6.
- **Refresh now:** this button starts `node refresh.js` on the server. The board checks `GET /api/refresh/status` until the refresh is complete. Then it loads the new data.

---

## 6. Scheduling and deployment

The board runs on your own computer. Only your own devices can open it. This was a decision on 2026-09-14.

`server.js` is a long-running process. It does two tasks:

1. It shows `frontend/public/`, and it gives these API endpoints:
   - `GET /api/roles`: reads `data/roles.json`.
   - `POST /api/refresh`: starts `node refresh.js`. A lock prevents two refreshes at the same time.
   - `GET /api/refresh/status`: the state of the refresh.
2. It runs the refresh schedule with `node-cron`. The schedule has two modes: `daily` at a time, or `manual` (on demand only).
   - `GET /api/schedule` gives the current schedule.
   - `PUT /api/schedule` changes the schedule. `lib/schedule.js` validates the data. The server saves it in `data/schedule.json` and replaces the cron job immediately.
   - When `data/schedule.json` does not exist, `schedule.refresh_cron` in `config/settings.json` gives the daily time (default `0 6 * * *`). `schedule.timezone` sets the time zone (default `Asia/Kolkata`).
3. It catches up a missed daily refresh. `node-cron` does not run a missed time again after the computer wakes. Thus the server checks every 5 minutes and 30 seconds after it starts. `isRefreshMissed()` in `lib/schedule.js` compares the most recent due time with the latest refresh time. If the refresh is missed, the server starts it. The server makes one attempt for each due time.
4. It records the progress of a refresh. `refresh.js` sends a message to the server through the Node IPC channel at each step (`lib/progress.js`). The steps are: each employer, each description, the classification and the publication. The server keeps the last message in `progress` in `GET /api/refresh/status` and writes one log line each minute. When you run `node refresh.js` by hand, there is no IPC channel and the script does not send messages.
5. It continues a refresh that stopped. Refer to section 6.1.
6. It keeps the Mac awake during the full cycle: the refresh and then the automatic scoring. On macOS, the server starts one `caffeinate -i -s -w <server-pid>` when the refresh starts. It stops `caffeinate` when the cycle ends. The cycle ends after the scoring, or when the refresh pauses or fails. When automatic scoring is off, the cycle ends after the refresh. Then the Mac can sleep again. A MacBook with a closed lid on battery power can still sleep.
   - Before this change, the server started one `caffeinate` for the refresh and one more for `autoscore.js`. The first `caffeinate` stopped with the refresh, before the second one held the Mac. On battery power, the Mac went to sleep in that gap (2026-10-25 and 2026-10-28). The Claude call then did not complete, and the 15-minute time limit stopped it.
   - `autoscore.js` finds a sleep during a Claude call (`createSleepWatch` in `lib/power.js`) and writes "the Mac slept during the Claude call" to the log. When the time limit stops a call, `autoscore.js` sends the same batch one more time.
   - `caffeinate` cannot keep a MacBook awake on battery power with a closed lid. Thus `lib/power.js` reads the power source (`pmset -g batt`) and the lid state (`ioreg -k AppleClamshellState`). If the two checks fail, the refresh runs.
   - A scheduled, catch-up or retry refresh does not start on battery power with a closed lid. The server tries again at each catch-up check. A **Refresh now** click always starts.
   - The server starts `refresh.js` with `--pause-on-sleep`. Before it starts each employer, `refresh.js` does the power check. On battery power with a closed lid, it starts no new employer. When the employers in progress finish, it saves the checkpoint and stops with exit code 75. The server sets `paused` in `GET /api/refresh/status`. At each catch-up check, the server continues the run with `--resume` when the Mac can stay awake.
   - If an employer fails and the computer slept during that employer, `refresh.js` tries that employer again one time. A timer ticks every 5 seconds. A gap of more than 35 seconds between two ticks shows a sleep.
7. It limits the time for each employer. If one employer takes more than 20 minutes, the refresh records an error and continues with the next employer. `refresh.employer_time_limit_minutes` in `config/settings.json` changes the limit. After the limit, the scraper starts no new requests (`cancel()` in `lib/scrapers/BaseScraper.js`). A request that is in progress can continue for not more than 30 seconds. The next resumed run or the next full run scrapes the employer again.

### 6.1 Refresh checkpoint

The refresh saves each employer to the database immediately after it scrapes that employer. `data/refresh-checkpoint.json` records the run and the result of each employer: `ok` or `error` (`lib/checkpoint.js`). The refresh writes this file to a temporary file first and then renames it. Thus a stop never leaves half a file.

- **Resume.** With `--resume`, `refresh.js` continues the run in the checkpoint, if these two conditions are true:
  - The run did not complete.
  - The run started less than 12 hours before.

  The refresh skips the employers with the result `ok`. It scrapes the employers with the result `error` again. The employer that was in progress when the run stopped starts again from its first role. If the conditions are not true, a new run starts.
- **Which runs resume.** The server adds `--resume` to the scheduled run, to the catch-up run and to the retry run. **Refresh now** and `node refresh.js` always start a new, full run. `node refresh.js --only=...` does not read or write the checkpoint.
- **Retry.** If an error or a signal stops a refresh early, the server starts it again one time after 10 minutes. The retry run uses `--resume`. The server does not try a failed retry run again. A run that completes with some failed employers does not stop with an error. The next scheduled run scrapes these employers again. A run with more than 50% failed employers stops with an error (refer to section 4.2).
- **Completion.** Before the last publication step, the refresh writes `completed_at` in the checkpoint. If the publication fails, the refresh removes `completed_at` again. Thus the retry continues the run and does not scrape all employers again.
- **Run record.** The `scrape_runs` row of a resumed run includes the employers from before the stop. If a resumed run records the same `run_id` again, the new row replaces the old row. A complete run also sets `last_refresh` in `meta`. An `--only` run does not change `last_refresh`.
- **The board.** The publisher adds `meta.refresh` to `data/roles.json`: `complete`, `total`, `refreshed`, `failed` and the times. The "Updated" text on the board always shows the end of the last complete run. Point to it, or tap it, to open the refresh status panel. The panel shows the status: complete or partial. It also shows the finished, pending and failed employers, and the number of scored roles. When the data is partial, the board also shows a **Partial** label. While a refresh runs, the label shows the progress, for example **Refreshing 14 of 56**. The footer shows the current step. Each 15 seconds, the board reads `GET /api/refresh/status`. When the scrape completes a new employer, the board loads the roles again, not more than one time each minute.
- **The board file.** The publisher writes `data/roles.json` to a temporary file first and then renames it. Thus the board never reads half a file during a refresh.

By default, the server listens on `127.0.0.1`. Thus only this computer can open the board. To open the board from other devices, refer to `docs/SETUP.md`, sections 7 and 8:

- **Same Wi-Fi network:** set `server.host` to `0.0.0.0` in `config/settings.json`, then open `http://<LAN-IP>:4000`.
- **Other networks:** Tailscale (a private network between your devices).
- **An unlisted URL:** `cloudflared tunnel --url http://localhost:4000`. Add the tunnel host name to `ALLOWED_HOSTS`.

**Request checks (`lib/security.js`).** The board has no login. Thus, before each route, the server does two checks:

- **Host check.** The `Host` header must be `localhost`, an IP address, or a name in `ALLOWED_HOSTS`. This stops DNS rebinding: a hostile domain name that points to `127.0.0.1` cannot read the API.
- **Cross-site check.** For `POST` and `PUT`, the `Origin` header must be the board itself or a name in `ALLOWED_HOSTS`. Without `Origin`, the server rejects `Sec-Fetch-Site: cross-site` and `same-site`. This stops a hostile web page from starting a refresh or changing the schedule. A request without browser headers, for example from `curl`, passes this check.

The server answers `403` to a rejected request and writes a warning to the log.

**Security headers (`helmet`).** The server sends a Content-Security-Policy. The policy lets the pages load scripts, styles, fonts and data only from the server itself. Thus the board does not run inline scripts, and an injected script cannot run. The pages keep their scripts in `frontend/public/js/`, their styles in `frontend/public/css/` and the Source Sans 3 font in `frontend/public/fonts/`. The board sends no requests to Google or to other sites. The policy does not let other sites show the board in a frame. The server does not send `X-Powered-By`.

The project has no GitHub workflow. The workflow of an earlier cloud setup was removed on 2026-11-13.

---

## 7. Errors and monitoring

### 7.1 Error types

| Error type | Example | Action |
|---|---|---|
| Site not available | 503 | Record the error. Continue with the next employer. Try again at the next refresh. |
| Rate limit | 429 | Record the error. Continue with the next employer. Try again at the next refresh. |
| Access refused | 403 | Record the error. Examine the site. If the block continues, set the employer to `active: false`. |
| Parse failure | The HTML structure changed | Record a sample. Examine the scraper. |
| Database error | A write failure | The reclassify step uses a transaction and rolls back. Other steps stop the refresh. |
| Network | Timeout after 30 seconds | Record the error. Continue with the next employer. |
| Closed role | Workday 403 with errorCode S22, or 404; Oracle returns no items | Set the role to inactive. |

### 7.2 Log format

```json
{
  "timestamp": "2026-09-13T00:45:12Z",
  "run_id": "refresh_20260913_0600",
  "level": "INFO",
  "component": "scraper",
  "employer": "bny",
  "event": "roles_extracted",
  "count": 42,
  "duration_ms": 3200,
  "status": "success"
}
```

`lib/logger.js` (winston) writes to the console, to `logs/combined.log` and to `logs/error.log`.
Each log file has a maximum size of 10 MB. The logger keeps 5 files.

At the end of a complete refresh, `refresh.js` writes a summary (`formatRefreshSummary` in `lib/progress.js`):

```
=== Refresh complete in 16 min: 90 of 92 employers succeeded, 2 failed ===
  Failed: Chubb (Request failed with status code 503); BNY (Request failed with status code 503)
  Roles: 5845 matching roles read, 383 new, 5462 seen again, 336 closed (left the site), 0 closed (closing date passed)
  Descriptions: 19 fetched, 0 closed postings, 0 errors, 0 skipped
  Classified: 8687 roles, 447 target, 73 exception, 8167 excluded
  Board: 244 roles in data/roles.json
  Slowest employers: Nomura 9 min 32 s, Experian 5 min 53 s, Intuit 5 min 21 s
```

The time starts when the run started. For a resumed run, the time includes the pause, and the counts include the employers that were saved before the pause.

The summary is in `logs/refresh.log` and `logs/combined.log`. `refresh.js` also sends the summary to the server through the IPC channel (`reportSummary`). The server writes it after the line "Refresh finished", so `pm2 logs` also shows it.

When nothing more runs, the server writes one last line, for example:

```
=== Refresh and scoring complete; server idle (next refresh daily at 06:00 Asia/Kolkata) ===
```

The line comes after the scoring, or after the refresh when no scoring follows. It also tells about a failed scoring, a pause or a retry, for example `=== Refresh stopped before the end; server idle (retry in 10 min) ===`.

### 7.3 Health checks

**Each day:**

- `last_refresh` is less than 24 hours old.
- The number of active roles is stable or increases.
- Fewer than 5 employers fail in one refresh.
- `node score.js --status` shows 0 new roles after you score.

**Each week:**

- Examine the parse errors and the description errors.
- Make sure that robots.txt still permits the paths for each active employer.

---

## 8. Implementation phases

| Phase | Scope | Deliverables |
|---|---|---|
| 0: Foundation | Architecture, configuration, scaffold | This document, `docs/SETUP.md`, `config/*.json`, `refresh.js`, logger, folder structure |
| 1: Database and generic scraper | Prove the pipeline on 3 Workday employers | `lib/database.js`, `lib/parser.js`, `BaseScraper`, `ScraperFactory`, `WorkdayScraper`. 106 roles verified. |
| 2: ATS-specific scrapers | All employers that live tests could verify | `OracleScraper`, `CustomScraper`, `GreenhouseScraper`, `AvatureScraper`. 22 employers active. Refer to section 8.1. |
| 3: Frontend | Job board | Search, filters, marks. Phase 3b replaces the hosting. |
| 3b: Self-hosted, local-first | No Claude session in the daily operation | `server.js`, `frontend/public/index.html`, `data/roles.json` |
| 4: Hardening | A more reliable daily refresh | Not started. Alerts for repeated failures, notifications. |
| 5: Role targeting | Show only roles that match the target profile | `config/targets.json`, `lib/targeting.js`, `refresh.js --reclassify`. Refer to section 11. |
| 6: Descriptions and AI scoring | ATS and fit scores on each role | `lib/descriptions.js`, `score.js`, `lib/scoring.js`, `config/scoring-rubric.md`, the score UI. Refer to sections 12 and 13. |
| 7: Board redesign and schedule | A wider board and a schedule control | One role in each row, ATS score and RM score blocks, the **Auto refresh** control (`lib/schedule.js`, `/api/schedule`). |
| 8: Employer discovery | More employers, also in other industries | `discover.js`, `lib/discovery.js`, `refresh.js --only`. 113 employers added. Refer to section 15. |

### 8.1 Phase 2 findings

The ATS types in the source specification were often wrong. For example:

- Franklin Templeton, PwC AC, EY GDS and Marsh & McLennan use Phenom or SuccessFactors, not Workday or Oracle.
- Bank of America, Barclays, Visa, AIG and CME Group use Workday, not a custom site.
- Bridgewater uses Greenhouse.

Because of this, the team examined the live site of each employer. The `note` field of each employer in `config/employers.json` gives the finding and its date.

These design decisions came from the findings:

- **No Taleo, Phenom, SuccessFactors or iCIMS classes.** "Oracle" in this project means Oracle Fusion Recruiting Cloud and its public REST API. No employer uses old Taleo. `CustomScraper` serves Phenom, SuccessFactors and other sites through `sitemap.xml` and schema.org `JobPosting` data. Many vendors use this convention. Greenhouse has its own class because its API is public and documented.
- **CustomScraper has a render mode and fallbacks.** `custom.render: true` uses Puppeteer for tenants that make the content with JavaScript (Standard Chartered). When the structured data has no title or location, the scraper uses the page `<title>` and a city name in the URL.
- **Live tests found three bugs:**
  1. A location filter removed all roles on sites whose URLs have no city name. The fix ranks the URLs and does not filter them.
  2. A JSON-LD-only parser found no data on Microdata sites. The fix reads both formats.
  3. Keyword matches with `.includes()` found "Intern" in "international", and the parser applied "India" before "Pune". The fix uses whole-word matches and the longest city name.
- **A known ATS does not always mean that the employer permits scraping.** Charles Schwab uses iCIMS, but its robots.txt disallows all paths. Because of this, Charles Schwab is in the excluded list. (On 2026-11-03, Charles Schwab moved to the board through its schwabjobs.com sitemap. Refer to section 8.2.1.) Blackstone shows a Cloudflare challenge page, also in a headless browser. Blackstone is bot-protected. Refer to section 14.

Inactive employers (11): UBS, BNP Paribas and Blackstone are bot-protected. Vanguard, Goldman Sachs, Morgan Stanley, Deutsche Bank and Citadel probably use their own systems. The platforms of KPMG, Zurich and ICE are not known.

### 8.1.1 Phase 2c: Deloitte USI and a robots.txt bug

The career site of Deloitte USI is `usijobs.deloitte.com/en_US/careersUSI`. It is on the Avature tenant `deloitteus.avature.net`.
It has no job sitemap. Because of this, `AvatureScraper` reads the server-rendered search pages (`?jobRecordsPerPage=10&jobOffset=N`).
The JSON-LD on a detail page often has no location when the role has many cities. Because of this, the scraper reads the `.article__header--locations` block.

This work found a bug in the robots.txt parser of `BaseScraper`.
The parser used `startsWith()`. It did not treat `*` as a wildcard. Because of this, `Allow: /*/careers` did not match, and `Disallow: /` blocked all paths.
The fix changes each rule to a regular expression: `*` becomes `.*`, and a `$` at the end becomes an end anchor.
The team checked the robots.txt of each active employer again after the fix.

### 8.2 Employers that you must check manually

**Policy stop (6). Do not automate these employers.** A Cloudflare challenge or another bot wall blocks the crawler.
Do not try to go around a block (refer to section 14). A person can visit the public pages.
On 2026-11-03, the owner chose a manual check for the first four employers. The link opens the India search of the site.

| Employer | Reason | Career site |
|---|---|---|
| The Standard | Cloudflare blocks the Darwinbox job API. The portal shows a stub page to the crawler. | https://stancorpglobal.darwinbox.in/ms/candidatev2/main/careers/allJobs |
| Alvarez & Marsal | Cloudflare challenge, also in a headless browser | https://careers.alvarezandmarsal.com/search/jobs/in/country/india |
| Citadel | Cloudflare challenge, also in a headless browser (Citadel Securities, Gurugram) | https://www.citadelsecurities.com/careers/open-opportunities?location-filter=gurugram |
| Envestnet | Cloudflare challenge, also in a headless browser | https://careers.envestnet.com/search/jobs/in/country/india |
| BNP Paribas | 403, bot protection | https://group.bnpparibas/en/careers |
| Blackstone | Cloudflare challenge page, also in a headless browser | https://www.blackstone.com/careers |

#### 8.2.1 Blocked employers with an open job system (2026-11-03)

The owner asked for access to all blocked sites. A check with a normal browser found an open job system for 8 of them. The crawler keeps its own user agent and obeys robots.txt.

| Employer | Earlier block | Open job system |
|---|---|---|
| Citigroup | robots.txt blocks `/search-jobs/` | The sitemap and the `/job/` pages (custom) |
| Charles Schwab | The iCIMS host blocks all paths | schwabjobs.com sitemap (custom) |
| JPMorgan Chase | 403 login wall on the old careers site | Oracle site `CX_1001` |
| Nestlé | 403 on nestle.in | jobdetails.nestle.com sitemap (custom) |
| Microchip | 403 on careers.microchip.com | Workday `microchiphr/wd5/External` |
| Nokia | 403 on nokia.com | Oracle site `CX_1` |
| UBS | 403 on the jobs.ubs.com root page | BrassRing at `jobs.ubs.com/TGnewUI` |
| Global Payments | Cloudflare challenge on jobs.globalpayments.com | Workday `tsys/wd1/TSYS` |

Inspire Brands permits crawlers on careers.inspirebrands.com, but that site has no India roles.

**Backlog (6). No policy block.** These sites do not match the `CustomScraper` method, or their platform is not known.
A future phase can add a scraper with CSS selectors for each site (refer to section 4).

| Employer | Status | Career site |
|---|---|---|
| Goldman Sachs | Content is available. No known ATS. Probably a proprietary system. | https://higher.gs.com/roles |
| Morgan Stanley | Content is available. No known ATS. Probably a proprietary system. | https://www.morganstanley.com/careers/students-graduates/experienced-professionals |
| Deutsche Bank | Content is available. No known ATS. Probably a proprietary system. | https://careers.db.com/search-results |
| KPMG | Marketing site only. The ATS URL is not known. | https://www.kpmguscareers.com/ |
| Zurich Insurance | The URL is not known. The India operations can be in a joint venture (Zurich Kotak). | https://www.zurich.com/careers |
| ICE | The platform is not known. Two vendor matches were false. | https://careers.ice.com |

---

## 9. Configuration files

| File | Content |
|---|---|
| `config/employers.json` | One entry for each employer, the `excluded` list and `meta`. |
| `config/filters.json` | The location lists, the job types and `exclude_keywords`. |
| `config/targets.json` | The targeting rules (section 11). |
| `config/scoring-rubric.md` | The scoring rubric and its version (section 12). |
| `config/settings.json` | All settings that git can keep, for example the port, the schedule and the refresh limits. `lib/settings.js` gives the default for each property. Refer to `docs/SETUP.md`, section 2. |
| `.env` | Only secrets and private host names (`ALLOWED_HOSTS`, `SLACK_WEBHOOK`). Git ignores this file. Copy it from `.env.example`. |

Example entry in `config/employers.json`:

```json
{ "id": "example-bank", "name": "Example Bank", "domain": "example.com",
  "careers_url": "https://careers.example.com", "ats_type": "workday",
  "workday": { "tenant": "example", "cluster": "wd1", "site": "Careers" },
  "crawl_delay_seconds": 5, "active": true }
```

---

## 10. Technology

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 18 or later, ES modules | It works with Puppeteer and cheerio. |
| HTTP | axios | It has a simple timeout configuration. |
| Sites that need JavaScript | puppeteer | The scrapers use it only when axios and cheerio cannot get the data. |
| HTML parsing | cheerio | It is fast, and it does not need a browser. |
| Database | sqlite3 | The database is one file and needs no server. This is correct for one user. |
| Server | Express | It is small and well known. |
| Scheduling | node-cron in `server.js` | No separate operating-system job. |
| Logging | winston | It has levels, structured output and file rotation. |
| Frontend | Static HTML and JavaScript | It needs no build step. |
| Tests | Jest and nock | nock gives fake HTTP responses. The tests do not send requests to real sites. The test guard (section 19) makes sure of this. |

---

## 11. Role targeting

`lib/targeting.js` classifies each role from its title only. The rules are in `config/targets.json`. You can change the rules without a code change.
After you change the rules, run `node refresh.js --reclassify`. This command applies the rules to all stored roles. It does not scrape.

First, the classifier changes each underscore in the title to a separator. Some titles use underscores, for example "Program Manager_Vice President_Delivery" (Morgan Stanley).

The classifier does these steps in this sequence:

1. **Grade.** The first grade pattern that matches gives the grade and the tier.
   - Target: SVP, Associate Director, Director (also Senior, Executive and Group Director), VP, Head.
   - Exception: AVP (also Assistant and Associate Vice President), Senior Manager.
   - Target, lead role with no grade: a title with no bank grade that names a lead role. The lead roles are:
     - Product and program roles: product owner, product manager, product lead, program manager (also "programme manager"). The rule also includes "Technical Product Manager" and "Technical Product Owner".
     - Engineering leader roles: engineering manager, development manager, delivery manager, delivery lead, engineering lead, chapter lead, squad lead, tribe lead. Some employers (for example Visa, Invesco, Mastercard) do not put a bank grade in the title.
   - Excluded: a lead-role title that has a marker of a lower grade (Specialist, Associate, Analyst, Junior, Assistant, Intern, Trainee, Apprentice).
   - Excluded: a lead-role title with the level I or II (`junior_level_suffix`). Examples: "Program Manager II", "Product Manager-II", "Program Manager (II)". The owner made this decision on 2026-10-14. A regulation or a phase name is not a level. Thus "Solvency II", "Basel II", "MiFID II", "Phase II" and "Tier II" stay.
   - Excluded: a lead-role title that an employer rule (`employer_rules`) matches. The classifier gets the employer id from the scraper and from the database. The rule does not apply to a title with a grade (for example Head or Director). At Amazon, some titles are an individual contributor level: Program Manager, Product Manager and Technical Program Manager. The rule excludes them when the title does not have "Senior", "Sr." or "Principal". The rule also matches up to three words before the title, for example "WHS Program Manager".
   - Excluded: Managing Director, EVP and C-level titles, and titles with no target grade.
2. **Hard exclusion.** Functions that are not targets: for example legal, audit, sourcing, consulting, advisory, security.
3. **Soft exclusion.** Domain words: for example risk, finance, treasury, HR, sales. These exclude the role only when the title does not also name a technology function (technology, engineering, platform, IT, software, data, product management, program management). Because of this, "Director, Risk Technology" stays.
4. **Hands-on exclusion.** Individual contributor titles: for example engineer, developer, architect, analyst, specialist. This step does not exclude a product-leadership title (for example "Product Management", "Product Owner"). It also does not exclude a people-leader title (`leadership_override`: for example "Engineering Manager", "Chapter Lead - Data Engineer"). "Tech Lead" and "Lead Software Engineer" are hands-on titles.
   A support or operations title (`exclude_support`) is excluded only when it is not a leader role. A leader role has a leader word (manager, head, lead, leader) or the grade SVP, Director, Associate Director or Head. For example, "Engineering Manager - Application Support" is a target. The classifier excludes "VP, Production Services Application Support".
5. **Family.** The first family pattern that matches: Product; AI / Data leadership; Engineering leadership; Delivery / Program / Transformation. The classifier excludes a role that has no family.

6. **Description check.** After the refresh gets the job descriptions, it checks the full text of each target role and exception role (`description_check` in `config/targets.json`). The check counts distinct IT signals, for example software, cloud, platform, API and agile. It also counts distinct non-IT signals, for example HVAC, HVDC, substation, clinical and CDISC. The check excludes the role in these conditions:
   - The description has 3 or more non-IT signals.
   - The description has 2 or more non-IT signals and fewer than 8 IT signals.
   - The description has fewer than 2 IT signals.

   The check does not judge a description with fewer than 500 characters.

The grade patterns use `(^|[^a-z])AVP([^a-z]|$)` and not `\bAVP\b`. Some titles put an underscore next to the grade (for example "AVP_ Data Products"), and an underscore is a word character in a regular expression.

The database keeps all roles, also the excluded roles. Only target roles and exception roles of active employers go to `data/roles.json`.
`test/targeting.test.js` has 111 real and constructed titles.

---

## 12. Scoring

### 12.1 Rubric

`config/scoring-rubric.md` defines the scores. It has a version number. A change to the rubric must increase the version. Then all scores become stale.

- **ATS score (0–100):** required skills and keywords (40), title and function match (20), must-have requirements (20), years of experience (10), domain words (10).
- **Fit score (0–100):** grade and scope (25), leadership type (20), domain (20), technology (20), location and practical fit (15).
- **Calibration:** 85–100 strong match; 75–84 good match (the minimum for an exception role); 50–74 partial match; 0–49 weak match.

The scorer scores each role against the master CV (`cv.md` in the career-ops folder), two times: as PO (Product Owner, the product facts of the CV) and as EM (Engineering Leader, the engineering facts of the CV). The career-ops evaluation and the tailored CV use the same file. Thus all scores come from the same facts. The owner made this decision on 2026-11-05 (rubric version 2). Before, the scorer used two separate resume files.
The recommended resume is the variant with the higher fit score. When the fit scores are equal, the higher ATS score decides.

### 12.2 Personal data

The scorer uses these files in `Resume/`:

- `cv.md` in the career-ops folder (the master CV). The scorer gets it without the contact lines (email, phone, LinkedIn) and without the HTML comments (`scoringCv()` in `autoscore.js`). `cv.md` does not change: career-ops and the tailored CV keep the contact details.
- `candidate_profile.txt` in `Resume/` (current grade and scope, home city, city preferences, domain list)

> **CAUTION:** These files contain personal data. Git ignores `Resume/`. The rubric in `config/` is generic and contains no personal data. Do not copy resume text into a file that git tracks.

### 12.3 The scoring procedure

`score.js` has these commands:

| Command | Function |
|---|---|
| `node score.js --status` | Shows the number of shortlisted roles, scored roles, new roles and stale roles. |
| `node score.js --pending [--out FILE] [--limit N]` | Writes the roles that need a score, with their descriptions and a `description_hash`, to `.cache/scoring/pending.json`. |
| `node score.js --import FILE [--scorer NAME]` | Validates each score, stores the valid scores, rejects the others with a reason, and writes `data/roles.json`. |

A score is stale when the title, the description or the rubric version changes. `lib/scoring.js` makes a hash of the title and the description.

`validateScoreRecord()` rejects a score in these conditions:

- A score is not an integer from 0 to 100.
- The master CV or the candidate profile is missing.
- The recommended resume does not have the higher fit score.
- The reason is empty or longer than 35 words.
- There are more than 10 matched keywords or more than 3 gaps.
- The confidence is not "high" or "low".

`score.js --import` also rejects a score in these conditions:

- The role is not an active target role or exception role.
- The file has the same `role_id` two times. Import keeps the first record.
- The `description_hash` in the record is missing, or it is not equal to the current hash. This occurs when a refresh changes the description after `--pending`. Export the role again and score it again.

### 12.4 The scorer

The scorer is Claude Code. It needs no API key. It uses the Claude Code login on the computer. There are two ways to start it:

- **Automatic.** After each successful refresh, `server.js` starts `autoscore.js`. Set `scoring.auto_score` to `false` in `config/settings.json` to stop this.
- **By hand.** You ask Claude Code to score the new roles, or you run `node autoscore.js`. Refer to `docs/SETUP.md`, section 6.

`autoscore.js` does these steps for each batch of 10 roles. It does not score more than 50 roles in one run.

1. It runs `score.js --pending`.
2. It sends the rubric, the candidate profile, the master CV and the roles to `claude -p`. The model router (section 17) selects the model: `models.rm` (Opus) with the effort level `models.rm_effort` (medium). The rubric, the profile and the master CV are the system prompt (`.cache/autoscore/scoring-system.md`). This text is the same for each batch, thus Claude reads it from the prompt cache after the first batch. The roles are the user message.
3. It writes the reply to `.cache/autoscore/` and runs `score.js --import` with the scorer name `claude-code-auto`.

Some rules prevent repeated work:

- One run sends each role only one time.
- `autoscore.js` sends the counts to the server through the Node IPC channel (`lib/progress.js`): the roles to score, the roles done, the scores stored and the scores rejected. It also sends the model that did the scores. It reads the model from `modelUsage` in the reply of `claude -p`. The server writes these counts to the log after each batch and one time each minute. When the scores stop, the server writes a summary. `GET /api/refresh/status` gives the counts in `scoringProgress`.
- `score.js --import` can reject the score of a role two times. Then `autoscore.js` does not send that role again until its description changes. `.cache/autoscore/attempts.json` records the attempts.
- If two batches in sequence store no score, the run stops. The roles stay without a score, and the next refresh tries again.
- When a refresh starts, the server stops the scorer and its `claude` process. The refresh and the scorer both write the database and `data/roles.json`. After the refresh, the server starts the scorer again.

`score.js --import` also rejects a matched keyword or a gap that is longer than 120 characters.

The job description is external data. The scorer uses it only as evidence. The scorer does not obey text in a job description.
`autoscore.js` starts Claude Code with all tools off (`--tools ""`) and with no MCP servers (`--strict-mcp-config`). Thus text in a job description cannot make Claude Code read a file, write a file or run a command.
The resume text goes to Claude in the request. It does not go into a file that git tracks.

Other providers (a local model with Ollama, Groq or the Claude API) are possible. They must use the same rubric and the same `score.js --import` validation.

### 12.5 The exception rule

The publisher hides an exception role when its fit score is less than `exception_min_fit_score` (75) in `config/targets.json`.
An exception role with no score stays on the board until it gets a score.
A stale score stays on the board with the label "score out of date". A stale score cannot hide an exception role.

An employer can also have its own minimum fit score (`employer_min_fit_score` in `config/targets.json`). The publisher hides each scored role of that employer that has a lower fit score. The rule applies to all grades. Amazon has the minimum 65, because most of its roles are a partial match. This keeps approximately 25 Amazon roles. The owner made this decision on 2026-10-14. The board header shows the number of hidden roles.

---

## 13. Job descriptions

### 13.1 Why

The Workday and Oracle list APIs give only the title. A score needs the full description.
Because of this, `lib/descriptions.js` gets the description of each target role and each exception role from the ATS detail API.

| ATS | Detail request | Closed role |
|---|---|---|
| Workday | `GET https://<tenant>.<cluster>.myworkdayjobs.com/wday/cxs/<tenant>/<site><externalPath>`; text from `jobPostingInfo.jobDescription` | 404, or 403 with `errorCode` `S22` |
| Oracle | `GET https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?finder=ById;Id="<id>",siteNumber=<site>`; text from the description, responsibilities and qualifications fields | An empty `items` list |

The other ATS types already give the full description in the scrape.

### 13.2 Rules

- The fetcher reads robots.txt for the detail path of each host. A disallowed path gives the status `skipped`.
- The fetcher waits for the crawl delay of the employer after each request.
- A closed role becomes inactive at once.
- An employer can have 4 or more roles that need a description in one run. If more than half of these roles report closed, the refresh does not trust the result. It records an error and keeps the roles active.
- `syncRoles` does not write `full_description`. A new scrape does not remove it.
- The refresh gets a description again in these conditions:
  - `ok`, after 14 days (the employer can change the text).
  - `error`, after 20 hours.
  - `skipped`, after 7 days.
  - `gone`, when a later scrape makes the role active again.
- The maximum length of a stored description is 50,000 characters.

The first run on 2026-10-13 got 36 descriptions, found 21 closed roles, and had 0 errors.

---

## 14. Out of scope

- No email or SMS notifications. You check the board.
- No accounts for many users. `role_marks.user_id` is for one person's devices only.
- No scraping of application forms, salary data or pages behind a login.
- No evasion of bot protection (no CAPTCHA solving, no IP rotation, no browser fingerprint changes, no headless browser that acts as a person to pass a bot check). Set such a site to `active: false`. On 2026-11-03, the owner asked to work around crawler blocks. The open job systems in section 8.2.1 made a bypass unnecessary for 8 employers. For the 4 employers behind Cloudflare, the owner chose a manual check (section 8.2).
- No cloud database. One SQLite file is sufficient for one user.

---

## 15. Employer discovery

`discover.js` helps to add employers. It has two commands. Both are manual runs. The refresh does not use them.

| Command | Function |
|---|---|
| `node discover.js --detect <careers-url> ...` | Reads robots.txt and one careers page for each URL. Finds the ATS from the links in the page. Writes the result to `.cache/discovery/detect-results.json`. |
| `node discover.js --talent500` | Reads the Talent500 jobs sitemap (no job pages). Applies `config/targets.json` to the job titles in the URLs. Writes a list of companies with matching roles to `.cache/discovery/talent500-companies.json`. |

> **CAUTION:** The terms of use of Talent500 prohibit automated access. The owner of this project decided to run `--talent500` for company discovery only. Do not use it to collect roles. Do not run it in a schedule.

To add an employer, do these steps:

1. Run `node discover.js --detect` with the careers page of the company.
2. If the ATS is Workday, Oracle, Greenhouse or Avature, make sure that a search for "India" gives India roles.
3. Add the entry to `config/employers.json`. Write the finding and the date in the `note` field. Keep the existing format: one employer on each line.
4. Run `node refresh.js --only=<employer-id>` to scrape only the new employer.
5. Regenerate `docs/EMPLOYERS.md`.

`detectAts()` in `lib/discovery.js` knows these signatures: Workday, Oracle, Greenhouse, Avature, Lever, SmartRecruiters, Eightfold, SuccessFactors, iCIMS, Phenom, Taleo.

The discovery on 2026-10-13 added 113 employers: 35 active and 78 inactive. Some employers are excluded on purpose.

---

## 16. Tailored resumes (career-ops)

The board sends the roles with the best match to career-ops (https://github.com/career-ops-hq/career-ops, MIT license). career-ops evaluates each role and writes a tailored CV and cover letter. The board makes Word files from them. The owner opens the posting and applies by hand. Nothing applies automatically.

### 16.0 The board window

The board works on the roles that are `board.max_age_days` (30) days old or less. The age comes from the posted date. When a role has no posted date, the age comes from the day that the board first found it (`scraped_at`). The owner made this decision on 2026-11-05.

- RM scoring (`score.js --pending`) and the career-ops evaluation (`selectForTailoring()`) send only roles in the window. An older role keeps the scores that it has. A rubric change does not score it again.
- The board hides an older role, except a role that the owner marked and a role with a tailored CV. The chip **Show roles older than 30 days** shows the hidden roles. The posted band "More than a month" also shows them.
- The database keeps all roles. A refresh still closes a role when its posting is gone. Thus no purge is necessary, and a role that is still on the employer site is not added again as a new role.
- `tailor.js --role ID` (also the re-tailor after a confirmed gap) is not limited by the window.

### 16.1 The sequence

After a successful refresh, the server starts `autoscore.js`. When the scoring stops, the server starts `tailor.js`. `tailor.js` does these steps for each role, one role at a time:

1. It selects the active roles whose better RM score (PO or EM resume) is `tailoring.min_fit_score` (75) or more. The newest role goes first. The age of a role comes from the posted date. When a role has no posted date, the age comes from the day that the board first found it (`scraped_at`). `--since DATE` sends only the roles of that date or later. It skips a role that career-ops evaluated with the same description. It sends a failed role again, but not more than `tailoring.max_attempts` (2) times for the same description.
2. It writes the job description from the database to `jds/board-<role id>.md` in the career-ops folder. career-ops does not open the employer site.
3. It starts one career-ops worker (`claude -p`) with the batch prompt of career-ops, the owner profile and `config/tailoring-rules.md`. The first message asks for the evaluation only, on `models.scoring` (Sonnet).
4. The worker gives a score from 1 to 5 and writes a report and a tracker line. It does not write a CV in the first message.
5. The qualification gate: the better RM score is `tailoring.min_fit_score` (75) or more AND the career-ops score is `auto_pdf_score_threshold` in the career-ops profile (4.0) or more. If the role passes and is `tailoring.max_age_days` (3) days old or less, `tailor.js` sends a second message in the **same session** (`claude -p --resume`), on `models.documents` (Opus). The second message asks for the CV payload and the cover letter payload (JSON), with Step 4 of `config/tailoring-rules.md`. The second model has all of the evaluation in its context: each file that the worker read and each text that it wrote. Thus it uses the same evidence, keywords, plan and gaps as the evaluation. The CV rules and the fact checks are the same as before the change. An older role that passes the gate keeps its evaluation and gets no Word CV. `--role ID` always makes the CV. The owner made this decision on 2026-11-04.

   The age for the CV is the later of two dates: the posted date (or `scraped_at`), and `roles.changed_date`. The refresh and the description fetch set `changed_date` to today when the title or the text that career-ops reads changes. The first fetch of the full text is not a change. Each new CV goes into a new folder (the folder name has the date; a second CV on the same day gets `_2`). An evaluation that makes no CV keeps the link to the last CV in `tailored_docs`. The owner made these decisions on 2026-11-12.
6. After the second message, `tailor.js` deletes the session file (`~/.claude/projects/<folder>/<id>.jsonl`), because it contains the CV text. It changes the PDF column of the tracker line to ✅. It compares the payloads with the length rules (`checkDocLimits()` in `lib/tailoring.js`) and writes a warning to the log for each rule that is not met.
7. `tools/build-cv-docx.py` and `tools/build-cover-docx.py` make the Word files from the payloads. The templates are the owner's own Word files in `Resume/templates/` (git ignores them).
8. `tailor.js` runs the career-ops fact check (`verify-cv-facts.mjs`) on the text of each Word file. If the check fails, `tailor.js` does these steps:
   1. It reads the result of the check again (`--json`). `lib/fact-equivalence.js` compares each flagged claim with `cv.md`. A count passes when `cv.md` has the same number and the same noun, with at most 4 words between them ("8 clients" and "eight enterprise (ACME) clients"). A list item that the checker split at a thousands comma passes when `cv.md` has the same words and the same count ("indexing 2" and "500+ documents"). If all flagged claims pass, the file stays. A forbidden phrase, an error or any other claim always fails.
   2. If the Word CV still fails, `tailor.js` sends one repair message in the evaluation session. The message gives the checker output and the payload path. The worker changes only the flagged sentences. Then `tailor.js` makes the Word CV again and runs the check again.
   3. If the check fails again, `tailor.js` deletes the file and its empty folder, and records the failure.

   The career-ops HTML of Step 18 does not show the headline, the domain expertise and the accomplishments. Thus Step 4 item 4a in `config/tailoring-rules.md` tells the worker to check that text itself. The owner made these decisions on 2026-11-13, after two CVs failed on accomplishment text.
9. It writes the result to `tailored_docs` and writes `data/roles.json` again.

A Claude usage limit in the second message stops the run. The role does not count as failed, and the next run sends it again from the start.

`node tailor.js --role ID[,ID] --trial DIR` is a check run. The Word files go to `DIR`. The board database, the board and the career-ops tracker do not change. Use it to compare new files with the files that the board made before.

One role takes approximately 3 minutes. One run sends not more than `tailoring.max_roles_per_run` (40) roles. When a refresh starts, the server stops `tailor.js` and its worker.

### 16.2 The files

The Word files go to `<tailoring.output_dir>/<Company>/<YYYY-MM-DD>_<Role>_<job id>/`. The job id is the employer's id of the job (for example `R_2584204_1`). Two roles with the same title on the same day thus get different folders. If a role has no employer job id, the board role id is used. Folders made before 2026-11-06 do not have the job id.

| File | Contents |
|---|---|
| `<Full_Name>_Resume.docx` | The tailored CV |
| `<Full_Name>_Cover_Letter.docx` | The tailored cover letter |
| `job_description.md` | The job description that career-ops used |
| `evaluation.md` | The career-ops report |

`<Full_Name>` is `candidate.full_name` from the career-ops profile. Folder and file names have no spaces. The board shows the links **Resume (Word)**, **Cover letter (Word)**, **career-ops report** and **Folder**. A click sends `POST /api/roles/:id/tailored/cv|cover|report|folder/open`. The server opens the file where it is, with the macOS `open` command: a Word file opens in Word, so changes stay in the OneDrive folder. **Folder** opens the folder in Finder. The server accepts this request only from the computer that runs the board (a loopback address). On another device the server refuses it, and the board downloads the file with `GET /api/roles/:id/tailored/cv|cover|report`. Both routes use a file only if `tailored_docs` names it and the file is in `tailoring.output_dir`.

### 16.3 The CV rules

- **Facts.** The master CV (`cv.md` in the career-ops folder) is the only source of facts. The owner's own resumes supplied all of its facts. The worker can use the words of the job description for a real fact. It must not add a skill, a number or a title.
- **Gaps.** A job requirement with no support in the master CV is a gap. The CV does not show it. The report lists it, and the board shows it in "Why this score", with the button **I have done this**. The owner writes the experience in their own words (10 to 800 characters, one paragraph). `POST /api/roles/:id/gaps` then does these steps:
  1. It adds the text to the end of `cv.md`, in the section "Additional Experience (confirmed by the owner)". A comment line before the text gives the date, the gap and the employer.
  2. It records the answer in `gap_answers`. The board shows it under "Added to your master CV".
  3. It sets `tailored_docs.rerun`. If no refresh, scoring or tailoring runs, the server starts `tailor.js --role <id>` immediately. If not, the next run sends the role again.

  All later CVs can use the new fact. The career-ops fact check also accepts it, because it reads all of `cv.md`.
- **Headline.** The line below the name has the job title of the posting, then 4 to 6 search keywords from the job description, for example `SOFTWARE ENGINEERING DIRECTOR | CLOUD MODERNIZATION | ...`. The job title must agree with the owner's real level. The owner CV rules give the level. The master CV must support each keyword.
- **Length.** Not more than 3 pages. `build-cv-docx.py` calculates the number of lines. Its calibration comes from the page counts that Word saved in the owner's resumes: 160 lines are approximately 3 pages. Above 160 lines, it removes the least relevant items: first an accomplishment, then the last bullets of the latest role and of the older roles, then skill groups. It does not remove a role. It does not remove an item that matches `cv_checks.keep` in `config/private/owner.json` (the owner's must-have items).
- **Format.** Word (`.docx`). The owner makes a PDF when necessary.
- **Role lens.** Each tailored CV is a Product CV or an Engineering CV. `roleLens()` in `lib/tailoring.js` decides the lens from three signals, in this order of weight: the job title (3 points for each side whose words are in the title), the words of the JD (2 points for the side with clearly more product or engineering terms, else 1), and the RM scores (1 point for the variant with a fit score at least 3 points higher). When the points are equal, the title decides, then the RM recommendation. `tailor.js` writes the lens and its reasons to the log and gives them in the second message. The worker uses the lens, and changes it only when the JD clearly describes the other kind of role. It then puts the facts of that lens first in the headline, the summary, the accomplishments, the bullets of each role, the skill groups and the cover letter. The facts of the other lens stay, lower and shorter. The owner made this decision on 2026-11-05.
- **Missing result block.** When the worker finishes but does not give its JSON result block, `tailor.js` uses the score line of the report (`reportScore()`). The log shows a warning.
- **Style.** These rules come from the owner's own resumes. `config/tailoring-rules.md` gives them to the worker. `checkDocLimits()` writes a warning to the log when a payload does not obey them.
  - The owner's own facts are not in git (owner, 2026-11-12). They are in `config/private/` (gitignored). `cv-rules.md` has the CV rules with the real facts: the level, the bold examples, the must-have items, and the city and availability for the cover letter. `tailor.js` adds it after `config/tailoring-rules.md`. `owner.json` has the home city and the match patterns of the must-have items (`cv_checks`). `checkDocLimits()` and `build-cv-docx.py` use these patterns. The `_example` files show the format, with made-up values. When a private file is missing, the board uses its `_example` file, and `tailor.js` writes a warning to the log.
  - Do not use em dashes or en dashes. The master CV has some; the worker must write the sentence again. The two Word builders also replace each remaining dash: a range gets "to", a pair of words gets a hyphen, and other dashes get a comma.
  - Bold: the theme of each accomplishment ("**Platform transformation.**", with the period), one or two key results in each accomplishment, the key number in the bullets of the latest role and each skill label ("**Cloud and Architecture:**"). Do not use bold in other text. The builder puts " • " between the skills.
  - Recognition and Education do not change. `build-cv-docx.py` copies these two sections from the template (`Resume/templates/resume.docx`) with no change to the words or the format. It does not use the awards and the education in the payload. The template must have the same two sections as the owner's latest resume. When the owner changes them, copy the latest resume to the template again.
  - Skill groups: 5, including "Core Competencies". 6 is an exception, and the log gives a warning for it. `build-cv-docx.py` removes the last groups above 6.
  - Must-have items: each CV has the owner's must-have items (in `config/private/cv-rules.md`), also for an engineering role. If one is missing, `checkDocLimits` gives a warning. The headline has one of the owner's keywords.

### 16.4 Limited permissions

career-ops starts its workers with all permission checks off. The board does not do this. A job description is external text, and it can contain instructions. `tailor.js` starts each worker with these limits (`limitedSettings()` in `lib/tailoring.js`):

- `--permission-mode dontAsk`: the worker cannot use a tool that no allow rule permits.
- The file tools can read and write only in the career-ops folder.
- Commands run in the macOS sandbox. They can write only in the career-ops folder and in temporary folders. They have no network access. No command can run outside the sandbox.
- No web tools (WebFetch, WebSearch) and no subagents.
- No MCP servers (`--strict-mcp-config`).

The rules tell the worker that the job description is data and not instructions.

> **CAUTION:** Do not start career-ops workers with `--dangerously-skip-permissions` for board roles.

### 16.5 Personal data

The master CV, the career-ops profile, the reports and the Word files contain personal data. They stay in the career-ops folder, in `Resume/` and in `tailoring.output_dir`. Git does not track them. `config/tailoring-rules.md` contains no personal data.

The owner's original resume folder is read-only for Claude Code. A deny rule and a hook in the Claude Code user settings prevent writes to it. People can change it as usual.

### 16.6 The career-ops tracker

career-ops keeps its own tracker in `data/applications.md` in the career-ops folder. After each run, `tailor.js` makes this file if it does not exist (`ensureTracker()` in `lib/tracker-sync.js`) and runs `merge-tracker.mjs`. Then each evaluated role has a row with the status "Evaluated".

A board mark changes the status of the row (`syncTracker()`), with the career-ops command `set-status.mjs --report <number>`:

| Board mark | career-ops status |
|---|---|
| Interested | Evaluated |
| Applied | Applied |
| Rejected (the employer said no) | Rejected |
| Closed | Discarded |
| No mark | Evaluated |

The server does the sync after each mark change. `tailor.js` does it after each run for the roles that had a mark before career-ops evaluated them. `marks.tracker_status` records the last status that the sync wrote, so the sync writes only a change. With the status "Applied", career-ops also plans a follow-up date.

### 16.7 The fact-check configuration

`config/cv-facts.json` in the career-ops folder gives the fact check two lists:

- `forbidden_phrases`: claims that the owner does not make, for example "Fortune 500", "patent", "PhD" and "P&L ownership". A file with one of these fails the check.
- `warn_phrases`: clichés, for example "passionate", "results-driven" and "proven track record". The check shows a warning.

## 17. Model router and Claude usage

### 17.1 The router

Each Claude call of the board goes through `claudeCall()` in `lib/models.js`. The call names a stage. The stage selects the model from `models` in `config/settings.json`:

| Stage | Settings key | Default model | Caller |
|---|---|---|---|
| `rm_score` | `models.rm`, effort `models.rm_effort` | `claude-opus-5-5`, effort `medium` | `autoscore.js` |
| `careerops_score` | `models.scoring` | `claude-sonnet-5-5` | `tailor.js`, first message |
| `application_package` | `models.documents` | `claude-opus-5-5` | `tailor.js`, second message (CV, ATS headline, cover letter) |
| `resume_tailoring`, `cover_letter`, `ats_optimization` | `models.documents` | `claude-opus-5-5` | Reserved. One message makes all three today |

RM scoring stays on Opus. In the check runs of 2026-11-04 (50 roles), Sonnet gave RM scores 7 points lower on average, and only 93% of the roles had the same qualification. Opus with the effort `low` gave 94%, and one role that had a tailored CV went below 75. Opus with the effort `medium` gave 96%, the same as the stored scores. A Sonnet-first method with an Opus score for roles near the gate cost the same as Opus only, thus the board does not use it.

An unknown stage is an error. No stage has a default model. The refresh (`refresh.js`, `lib/descriptions.js`, `discover.js`) has no stage and makes no Claude call. `test/models.test.js` makes sure that no other file starts `claude` itself.

### 17.2 The usage record

The router asks for the JSON reply (`--output-format json`). The reply gives the tokens of each model. Each call adds one row to `model_calls`: the stage, the model that the router asked for, the models that Claude Code used, the role, the number of roles, the input, output, cache-read and cache-write tokens, the list-price value, the time and the result. The log gets one line for each call, for example:

```text
Batch 1: router rm_score -> claude-sonnet-5-5 (used: claude-sonnet-5-5; 12 in, 9.8k out, 6.1k cache read, 40.2k cache write; $0.310 list; 71s)
```

If Claude Code did not use the model that the router asked for, `tailor.js` writes a warning.

The list-price value is the value that Claude Code reports. With a Claude subscription, Anthropic does not bill each call. Use the value to compare stages and models.

### 17.3 The usage page

**Model usage** on the board (`/usage.html`, `GET /api/usage?days=30`) shows, for the period:

- The number of calls, the tokens and the list-price value.
- The part of the scoring calls that used Sonnet (the career-ops evaluation; RM scoring uses Opus), and the part of all calls that used the routed model.
- For each stage and model: the tokens, the value and the time, in total and for one role.
- For each day: the calls, the roles, the tokens and the value.

### 17.4 The check run

`node tools/shadow-score.js --roles 50 [--model M] [--effort E]` scores again roles that have a current score, with the current prompt, the model `M` and the effort level `E`. It does not store the scores. It records the tokens with `shadow = 1`, and the usage page shows them as a check run, not in the totals. It compares the new scores with the stored scores: the part of the roles with the same qualification (better RM score 75 or more), and the differences of the RM score. The details go to `.cache/shadow/`.

### 17.5 What the router does not change

- The rubric, the RM and career-ops scores, their thresholds and the gate.
- The career-ops evaluation and the CV rules. The second message has all of the context of the first message.
- The job cache: a role gets a new score only when its description or the rubric version changes (`role_scores`), and a new evaluation only when its description changes or the owner asks for it (`tailored_docs`).

## 18. State machines

Many values on the board move through states. Before 2026-11-12, no one file named the states or the transitions. `lib/states.js` now names them. Each machine has a list of states, a pure function that reads a row and gives the state, and a text for each state. The writers did not move: `lib/database.js`, `tailor.js` and `server.js` still write the columns and the flags. The readers use `lib/states.js`: the publisher writes `score_state` and `tailor_state` into `data/roles.json`, the board shows their text, and `tools/find-role.js` and `tools/board-status.js` print them. `test/states.test.js` tests each function.

The functions in `lib/states.js` change nothing. They do not decide what a run does. The selection rules stay in their modules (`selectForTailoring()`, `scoreState()`, `getRolesNeedingDescription()`); the state functions call them or copy them, and a test keeps the two equal.

### 18.1 Role lifecycle (`roles.is_active`)

| State | Meaning |
|---|---|
| open | The role is on the board. |
| closed | The role is not on the board. |

Transitions:

| From | To | Cause | Writer |
|---|---|---|---|
| (new) | open | The scraper found the role. | `syncRoles` |
| open | closed | The job id or the URL is not in the full list of the site. | `syncRoles` (section 3.0.1) |
| open | closed | The closing date passed (UTC). | `deactivateExpiredRoles`, at the end of `syncRoles` and after the scrape stage |
| open | closed | The detail page says that the role is closed. | `syncRoles` (`goneUrls`), `saveDescriptionResult` (`gone`) |
| closed | open | The site lists the id or the URL again. Not after the closing date. | `syncRoles` |

A manual role (`source` 'manual') stays open. The refresh never closes it. The owner marks it **Closed**. The database does not store the cause of a close. `roleState()` reads the cause from `description_status` and `deadline` when they show it.

### 18.2 Job text (`roles.description_status`)

| State | Column value | Due again |
|---|---|---|
| owner | 'ok', `source` 'manual' | Never. The text is the text that the owner gave. |
| listing | NULL, text of `min_full_chars` or more | Never. The scrape gave the full text. |
| missing | NULL, shorter text | In the next refresh. |
| fetched | 'ok' | After `descriptions.refetch_ok_days` (14). |
| closed | 'gone' | When a scrape opens the role again (the role is active with status 'gone'). |
| error | 'error' | After `descriptions.retry_error_hours` (20). |
| skipped | 'skipped' | After `descriptions.retry_skipped_days` (7). |

Only an active, shortlisted, scraped role is due. `saveDescriptionResult()` writes the column. `getRolesNeedingDescription()` applies the rule in SQL. `descriptionState()` applies the same rule in code, and `test/states.test.js` compares the two on a test database.

### 18.3 Tier and source

`roles.tier` is 'target', 'exception' or 'excluded' (NULL before the first classification). It is a classification, not a lifecycle: `refresh.js --reclassify` can move a role to any tier. A manual role keeps 'target'. `SHORTLISTED_SQL` in `lib/states.js` gives the shortlist rule (`tier IN ('target', 'exception')`) to the queries. `roles.source` is 'manual' or NULL and never changes.

### 18.4 RM score (`role_scores`)

| State | Meaning | Next scoring run |
|---|---|---|
| scored | The stored score is current. | Nothing. |
| stale | The title, the text or the rubric changed (`scoreState()` in `lib/scoring.js`, section 12.3). | Scores it again. |
| waiting | No current score. | Scores it. |
| given_up | `score.js --import` rejected the score `scoring.max_attempts` (2) times for the same description (`.cache/autoscore/attempts.json`). | Does not send it until the description changes. |
| outside_window | The role is older than `board.max_age_days` (30). | Does not send it. |

`rmState()` gives the state. The board shows the reason for a missing score on the role card. `tools/find-role.js` shows it with the text.

### 18.5 career-ops and the Word CV (`tailored_docs`)

The table stores 'evaluated', 'ready' or 'failed', with `attempts`, `rerun` and `description_hash`. The state adds the gate, the board window and the CV window:

| State | Meaning | Next automatic run |
|---|---|---|
| unscored | No RM score yet. | Waits for the score. |
| not_eligible | The better RM score is below `tailoring.min_fit_score` (75). | Does not send it. `tailor.js --role ID --any-fit` evaluates it; `--force-cv` also makes a CV. |
| outside_window | RM passes, but the role is older than `board.max_age_days`. | Does not send it. `tailor.js --role ID` does. |
| incomplete | The employer site left the job text empty. | Does not send it. |
| waiting | RM passes; no evaluation yet. | Sends it. |
| stale | The title or the text changed after the evaluation. An earlier CV stays. | Sends it again. |
| rerun | The owner confirmed a gap (section 16.3). | Sends it again. |
| retry | The last run failed, fewer than `tailoring.max_attempts` (2) times. | Tries again. |
| given_up | Failed `max_attempts` times with the same description. | Does not send it until the description changes. |
| below_gate | Evaluated; the RM score or the career-ops score is below the gate. No CV. | Nothing. |
| no_cv | Evaluated and passed the gate, but older than `tailoring.max_age_days` (3) when evaluated. No CV. | Nothing. `tailor.js --role ID` makes a CV. |
| ready | A Word CV is made. | Nothing. |
| evaluated | Evaluated, no CV, and the career-ops threshold is not on this computer. | Nothing. |

`tailorState()` gives the state, its text and `next` (true when the next automatic `tailor.js` run sends the role). `next` comes from `selectForTailoring()` on that one row, so it cannot differ from the real selection. The career-ops threshold (`auto_pdf_score_threshold` in the career-ops profile, 4.0) comes from `readCvMinScore()`; the publisher writes it to `targeting.cv_min_score`.

The outcomes of one `tailor.js` run ('below', 'too_old', 'ready', 'failed' in the server log) name what that run did. The state names what the table shows now.

The board shows the state text in the career-ops box (a role that waits, a retry or a failed role), in "Why this score", and as counts in the refresh status panel. Before this change, a role that passed the gate but was too old for a CV showed "Below the score for a tailored resume".

### 18.6 Marks and the tracker (`marks`)

The states are the marks: none, interested, applied, rejected, closed (`MARKS` in `lib/tailoring.js`). Any mark can follow any mark; a second click on the same mark removes it. `trackerStatus()` maps the mark to the career-ops tracker status (section 16.6), and `marks.tracker_status` records the last status that the sync wrote. This machine was explicit before; it stays in `lib/tailoring.js` and `lib/tracker-sync.js`.

### 18.7 The server cycle (`server.js`)

`GET /api/refresh/status` gives the flags `running`, `scoring`, `tailoring` and `paused`, and now also `phase` and `queued`:

| Phase | Meaning | Next |
|---|---|---|
| refreshing | `refresh.js` runs. | The scoring (exit code 0), a pause (75 or 69), a retry wait (other codes) or idle. |
| scoring | `autoscore.js` runs. | The tailoring, or idle. A refresh that starts stops it. |
| tailoring | `tailor.js` runs. | Queued work (a manual job's scoring, "Make CV anyway"), or idle. A refresh that starts stops it. |
| paused | The refresh stopped because the Mac can sleep or has no network. | The catch-up check continues it (`--resume`). |
| retry_wait | The refresh stopped with an error. | One retry after `schedule.retry_after_minutes` (10), with `--resume`. |
| idle | Nothing runs. | The next scheduled refresh, or **Refresh now**. |

`cyclePhase()` gives the phase from the flags, in this order of precedence. `queued` gives `scoring` (true when a manual job waits for the scoring) and `cvs` (the number of "Make CV anyway" requests that wait). The board still reads the flags; the phase is for the API readers.

### 18.8 The refresh checkpoint

`lib/checkpoint.js` was explicit before. An employer in a run is pending, 'ok' or 'error'. A run is in progress, complete (`completed_at`), or resumable (not complete and started less than `refresh.checkpoint_max_age_hours` (12) before). Refer to section 6.1.

## 19. Test guard

On 2026-11-13 a test (`test/publisher.test.js`) sent the database to a temporary folder, but `publish()` wrote its default file, `data/roles.json`. Each test run replaced the live board with 5 test roles. The database did not change. `node tools/publish.js` wrote the board file again.

### 19.1 The rules

Jest loads `test/setup/live-guard.cjs` before each test file (`package.json`, `jest.setupFiles`). During a test:

- A write is allowed only in the system temporary folder (`os.tmpdir()`). A write to another location fails with the error `live-guard: a test tried to ...` and the name of the file. This applies to the `fs` functions (sync, callback, promise and stream), and to a SQLite open that is not read-only.
- A read of a live file is allowed.
- A child process is not allowed, because the guard cannot see its writes.
- A request to a real site fails. Only nock replies and localhost are allowed.
- The logger writes to the console only. It does not write `logs/combined.log` or `logs/error.log`.

The guard is below the code. Thus it also stops a write that a new module adds later.

### 19.2 How to write a test

- Make a temporary folder: `fs.mkdtempSync(path.join(os.tmpdir(), 'name-'))`.
- Give each function a path in that folder: `useDatabasePath()` before the first query, `publish({ outputPath })`, `saveCheckpoint(cp, file)`.
- When a new function writes a file, give it a path argument with the live file as the default. Do not remove the guard to make a test pass.
- `test/live-guard.test.js` makes sure that the guard works. It also makes sure that the live files do not change during the run.

### 19.3 The board file check

`tools/board-status.js` compares `data/roles.json` with the database. Each role id must have the same title and URL in the `roles` table. If not, the report shows a `PROBLEM:` line, and the fix is `node tools/publish.js`. This command writes the board file again from the database. It does not scrape, score or call Claude.

## 20. Personal data guard

The owner's facts must never go into git (section 12.2 and section 16.5). Before 2026-11-13, a person did a manual search of each change before a push. Now git hooks do the check on each commit and each push. This is necessary before the repository becomes public, because a public commit stays in copies after it is removed.

### 20.1 The check

`lib/private-check.js` has the rules. `tools/check-private.js` gives them the text from git.

- **The facts.** They come only from files that git ignores, so the committed code holds no fact: the career-ops `cv.md` (the name, the email addresses, the phone number, the LinkedIn name, and the employers from the `### Employer -- City` lines), `config/private/owner.json` (`excluded_employers`) and `config/private/private-terms.txt` (one word or phrase on each line). A term must have 4 characters or more. A phone number matches its digits only.
- **Whole words.** A term matches only as a whole word, in any case. Thus a hash in `package-lock.json` does not match a short term.
- **Blocked files.** `Resume/`, `config/private/` (except the `_example` files), Word, PowerPoint, Excel and PDF files, `.env` files (except `.env.example`), the database, `data/roles.json` and the logs (except `.gitkeep`). The check stops them also when `git add -f` adds them.
- **The author.** The pre-commit and pre-push hooks also check the author and committer of each commit. Use the GitHub noreply address as `user.email` in this repository.
- **The report.** It shows the file, the line, the first two characters and the length of the term, and the source file. It never shows the full fact.
- **No private files.** With none of the files (a fresh clone), the list is empty and each check passes.

### 20.2 When it runs

| Hook (`.githooks/`) | Command | What it checks |
|---|---|---|
| pre-commit | `node tools/check-private.js` | The staged files and lines |
| commit-msg | `--message FILE` | The commit message |
| pre-push | `--push REMOTE` | Each commit that is not on the remote, also a commit made with `--no-verify` |
| By hand | `npm run check:private` (`--all`, `--history`) | All tracked files, and all commits on all branches |

`npm install` sets `core.hooksPath` to `.githooks` (the `prepare` script). The check of 2026-11-13 found no fact in the 81 commits.

### 20.3 GitHub

GitHub secret scanning and push protection find keys and tokens. They are free only for a public repository. Turn them on when the repository becomes public (`docs/SETUP.md`, section 9.1).

