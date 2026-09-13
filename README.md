# India GCC Board

A personal BFSI (Banking, Financial Services & Insurance) leadership job
aggregator. Scrapes 34 employer career sites daily at 6 AM IST, filters for
leadership-track roles in India GCC hub cities, and publishes results to a
searchable job board.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system
design, including the ethical scraping policy this project operates under.

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

Currently: **Phase 2 done — 18/34 employers live, 558 real roles.**

| Phase | Status |
|---|---|
| 0 — Architecture, config, scaffold | ✅ done |
| 1 — Database + generic scraper (3 pilot sites) | ✅ done |
| 2 — ATS-specific scrapers | ✅ done — 18/34 employers active (12 Workday, 2 Oracle, 4 sitemap-based custom), 16 remain inactive pending further verification (see `docs/ARCHITECTURE.md` §8.1) |
| 3 — Frontend job board | ⬜ not started |
| 4 — Scheduling & hardening | ⬜ not started |

See [`SCAFFOLD_MANIFEST.md`](SCAFFOLD_MANIFEST.md) for the file-level
checklist.

## Project structure

```
config/            employer list + filter rules
lib/                database, parser, scrapers (Phase 1-2)
lib/scrapers/       ATS-specific scraper classes
frontend/           React job board (Phase 3)
docs/               architecture & setup docs
.github/workflows/  daily scheduled refresh
data/               SQLite DB (gitignored)
logs/               run logs (gitignored)
```

## License

MIT
