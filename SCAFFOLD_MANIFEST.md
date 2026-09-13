# Scaffold Manifest (Phase 0)

Quick reference for what exists after Phase 0 and what each later phase adds.

**Update 2026-09-13:** Phases 1 and 2 are now done — see `docs/ARCHITECTURE.md`
§8/§8.1 for current employer/scraper status (18/34 active, 558 real roles) and
what changed from the plan below during real-world verification. The ATS
breakdown and "not yet implemented" list further down are Phase-0-era and
kept for history; they no longer reflect current reality.

## Files created in Phase 0

- [x] `docs/ARCHITECTURE.md` — 12-section system design
- [x] `docs/SETUP.md` — setup + cron + Actions secrets guide
- [x] `README.md` — project overview & quick start
- [x] `package.json` — dependencies and scripts
- [x] `.gitignore` — node/data/logs/env/OS excludes
- [x] `.env.example` — env var template
- [x] `refresh.js` — orchestrator entry point (imports Phase 1-3 modules that don't exist yet — this is expected)
- [x] `config/employers.json` — 34 employers, classified by ATS type
- [x] `config/filters.json` — location/experience/keyword filters
- [x] `.github/workflows/refresh-schedule.yml` — daily 6 AM IST GitHub Action
- [x] `lib/logger.js` — winston logger (console + rotating file transports)
- [x] `SCAFFOLD_MANIFEST.md` — this file

## Folders created in Phase 0

- [x] `lib/` (+ `.gitkeep`)
- [x] `lib/scrapers/` (+ `.gitkeep`)
- [x] `data/` (+ `.gitkeep`) — will hold `jobs.db`, gitignored
- [x] `logs/` (+ `.gitkeep`) — will hold run logs, gitignored
- [x] `frontend/` (+ `.gitkeep`)
- [x] `docs/`
- [x] `.github/workflows/`

## Employer breakdown (`config/employers.json`)

34 active employers + 2 explicitly excluded (Citi, JPMorgan — see
`ARCHITECTURE.md` §2.1). Classification reconciled against
`BFSI_Job_Board_Architecture_Spec.md` on 2026-09-13 (KPMG moved to
Workday, DTCC/BNY split out as a distinct Taleo type per the spec's
explicit examples).

| ATS type | Count |
|---|---|
| Workday | 9 |
| Oracle | 3 |
| Taleo | 2 |
| Custom | 20 |

## Not yet implemented (deferred to later phases, by design)

- `lib/database.js` — schema init, `syncRoles`, `recordScrapeRun`
- `lib/parser.js` — raw listing → normalized role + filter matching
- `lib/scrapers/BaseScraper.js` — robots.txt check, rate limiting, UA
- `lib/scrapers/ScraperFactory.js` — ATS type → scraper class
- `lib/scrapers/WorkdayScraper.js`, `OracleScraper.js`, `TaleoScraper.js`, `CustomScraper.js`
- `lib/publisher.js` — Claude Artifact publish step
- `frontend/` contents — React job board UI
- `bin/cli.js` — manual trigger / health-check CLI (Phase 4)
- Local cron registration (documented in `docs/SETUP.md`, not run automatically by this scaffold)
- GitHub Actions secrets (`CLAUDE_API_KEY`, `CLAUDE_ARTIFACT_ID`, `SLACK_WEBHOOK`) — must be added manually in repo settings

Running `node refresh.js` before Phase 1 lands will fail on the
`lib/database.js` import — that's expected and confirms the orchestrator
shell is wired correctly.

## Commit strategy

One commit per phase, pushed immediately after:

- **Phase 0** (this scaffold): single commit, all files above.
- **Phase 1**: `lib/database.js`, `lib/parser.js`, `BaseScraper`,
  `ScraperFactory`, 3 pilot scrapers — commit + push.
- **Phase 2**: remaining scrapers — commit + push (may split into a few
  commits if reviewing per-ATS makes sense).
- **Phase 3**: `frontend/` + `lib/publisher.js` — commit + push.
- **Phase 4**: hardening changes — commit + push.

Daily automated data refreshes (once Phase 1+ is live) commit separately
via the GitHub Actions workflow, not as part of manual phase work.
