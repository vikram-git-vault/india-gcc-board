# India GCC Board

A personal BFSI (Banking, Financial Services & Insurance) leadership job
aggregator. Scrapes 36 employer career sites daily at 6 AM IST, filters for
leadership-track roles in India GCC hub cities, and serves the results
from a small self-hosted job board — no cloud account or Claude session
needed to keep it running day to day.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system
design, including the ethical scraping policy this project operates under.
See [`docs/EMPLOYERS.md`](docs/EMPLOYERS.md) for every employer tracked —
automated or manual — with a direct link to each job board. See
[`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) for a framework-by-framework,
concept-by-concept debrief of how this was built — useful reference if
you want to talk through the project (interview, write-up, etc.).

## Quick start

```bash
npm install
cp .env.example .env        # fill in values as needed
node refresh.js --init      # create the database (Phase 1+)
node refresh.js             # run a manual scrape (or use the Refresh button once serving)
npm run serve                # start the board at http://localhost:4000
```

The server also schedules its own daily refresh (6 AM IST by default —
see `REFRESH_CRON`/`TZ` in `.env.example`), so once it's running you don't
need to re-run `node refresh.js` by hand.

**Reach it from your phone or another computer:** the server binds
`0.0.0.0`, so `http://<this-machine's-LAN-IP>:4000` already works from any
device on the same Wi-Fi. For access from anywhere (not just home Wi-Fi),
still private to only your own devices, see the Tailscale setup in
[`docs/SETUP.md`](docs/SETUP.md). Full setup, including how to later
expose an unlisted private URL with zero code changes, is in
[`docs/SETUP.md`](docs/SETUP.md).

## Status

Currently: **Phase 3b done — self-hosted local server live, 22/33 employers, 593 real roles.**

| Phase | Status |
|---|---|
| 0 — Architecture, config, scaffold | ✅ done |
| 1 — Database + generic scraper (3 pilot sites) | ✅ done |
| 2 — ATS-specific scrapers | ✅ done — 22/33 employers active (12 Workday, 2 Oracle, 1 Greenhouse, 1 Avature, 6 sitemap-based custom), 11 remain inactive (3 bot-protected, 8 unidentified/proprietary) — see `docs/ARCHITECTURE.md` §8.1 |
| 3 — Frontend job board | ✅ done, superseded by 3b — see `docs/ARCHITECTURE.md` §5 |
| 3b — Self-hosted, local-first | ✅ done — `server.js` serves the board + API directly; daily refresh scheduled in-process; on-demand "Refresh now" button in the UI; no Claude dependency in the runtime loop — see `docs/ARCHITECTURE.md` §5–§6 |
| 4 — Hardening | ⬜ not started |

See [`SCAFFOLD_MANIFEST.md`](SCAFFOLD_MANIFEST.md) for the file-level
checklist.

## Project structure

```
config/            employer list + filter rules
lib/                database, parser, scrapers, publisher
lib/scrapers/       ATS-specific scraper classes
server.js           self-hosted server: serves frontend + API, schedules refresh
frontend/public/    static frontend (index.html) served by server.js
docs/               architecture & setup docs
.github/workflows/  daily scheduled refresh (not used in local-first setup — see ARCHITECTURE.md §6)
data/               SQLite DB + roles.json (gitignored)
logs/               run logs (gitignored)
```

## License

MIT
