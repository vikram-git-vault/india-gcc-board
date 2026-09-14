# India GCC Board

A personal BFSI (Banking, Financial Services & Insurance) leadership job
aggregator. Scrapes 34 employer career sites daily at 6 AM IST, filters for
leadership-track roles in India GCC hub cities, and publishes results to a
searchable job board.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system
design, including the ethical scraping policy this project operates under.
See [`docs/EMPLOYERS.md`](docs/EMPLOYERS.md) for every employer tracked —
automated or manual — with a direct link to each job board.

**The live board:** https://claude.ai/code/artifact/35691137-5630-4af7-a06c-72cd225e065c

## Quick start

```bash
npm install
cp .env.example .env        # fill in values as needed
node refresh.js --init      # create the database (Phase 1+)
npm start                   # run a manual refresh
```

Full setup, including the daily cron and GitHub Actions schedule, is in
[`docs/SETUP.md`](docs/SETUP.md).

## Status

Currently: **Phase 3 done — live board published, 22/33 employers, 593 real roles.**

| Phase | Status |
|---|---|
| 0 — Architecture, config, scaffold | ✅ done |
| 1 — Database + generic scraper (3 pilot sites) | ✅ done |
| 2 — ATS-specific scrapers | ✅ done — 22/33 employers active (12 Workday, 2 Oracle, 1 Greenhouse, 1 Avature, 6 sitemap-based custom), 11 remain inactive (3 bot-protected, 8 unidentified/proprietary) — see `docs/ARCHITECTURE.md` §8.1 |
| 3 — Frontend job board | ✅ done — search/filter/tabs/marks, built vanilla JS (Artifact CSP has no React CDN). Marks sync live; refreshing the *listings* needs a manual sync step — see `docs/ARCHITECTURE.md` §5.1 |
| 4 — Scheduling & hardening | ⬜ not started |

See [`SCAFFOLD_MANIFEST.md`](SCAFFOLD_MANIFEST.md) for the file-level
checklist.

## Project structure

```
config/            employer list + filter rules
lib/                database, parser, scrapers, publisher
lib/scrapers/       ATS-specific scraper classes
frontend/           job board source (job-board.html) + build.js
docs/               architecture & setup docs
.github/workflows/  daily scheduled refresh
data/               SQLite DB + artifact-sync.json (gitignored)
logs/               run logs (gitignored)
```

## License

MIT
