# Setup Guide

## Prerequisites

- Node.js 18+
- macOS/Linux shell access (for cron)
- A GitHub repo with Actions enabled (already set up: `vikram-git-vault/india-gcc-board`)

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:
- `CLAUDE_API_KEY` / `CLAUDE_ARTIFACT_ID` — only needed once Phase 3's
  publisher exists; leave blank until then, `refresh.js` will skip
  publishing with a warning if unset.
- `CRAWL_DELAY_MS`, `TZ`, `DB_PATH` — sane defaults already in
  `.env.example`, adjust if needed.

## 3. Initialize the database (Phase 1+)

```bash
node refresh.js --init
```

This creates `data/jobs.db` with the schema described in
`docs/ARCHITECTURE.md` §3. It's a no-op until `lib/database.js` is
implemented in Phase 1.

## 4. Run a manual refresh

```bash
npm start
# equivalent to: node refresh.js
```

Logs go to stdout and to `logs/combined.log` / `logs/error.log`.

## 5. Set up local cron (6 AM IST daily)

```bash
crontab -e
```

Add this line (adjust the path if you move the repo):

```
0 6 * * * cd ~/Projects/india-gcc-board && /usr/local/bin/node refresh.js >> logs/refresh.log 2>&1
```

Notes:
- Use `which node` to confirm the correct binary path for cron (cron's
  `PATH` is minimal and often won't find `node` otherwise).
- This only runs while the MacBook is on and awake — treat it as a
  convenience for local development, not the durable schedule. The
  GitHub Actions workflow (`.github/workflows/refresh-schedule.yml`) is
  the schedule of record and runs regardless of local machine state.
- Verify it's registered: `crontab -l`.

## 6. Configure GitHub Actions secrets

In the repo's Settings → Secrets and variables → Actions, add:

| Secret | Required | Purpose |
|---|---|---|
| `CLAUDE_API_KEY` | Phase 3+ | publishing the frontend artifact |
| `CLAUDE_ARTIFACT_ID` | Phase 3+ | which artifact to update |
| `SLACK_WEBHOOK` | optional | failure notifications |

`GITHUB_TOKEN` is provided automatically by Actions — no setup needed.

The workflow runs daily at 00:30 UTC (6:00 AM IST) and can also be
triggered manually from the Actions tab (`workflow_dispatch`).

## 7. Verify the workflow

After pushing, trigger it manually once to confirm the pipeline works
end-to-end before relying on the schedule:

```bash
gh workflow run refresh-schedule.yml
gh run watch
```

## Phase-by-phase build order

This scaffold (Phase 0) is complete. Building continues in order:

1. **Phase 1** — `lib/database.js`, `lib/parser.js`,
   `lib/scrapers/BaseScraper.js`, `lib/scrapers/ScraperFactory.js`, plus
   one working scraper per ATS type (3 pilot employers) to prove the
   pipeline end-to-end.
2. **Phase 2** — remaining 31 employer scrapers.
3. **Phase 3** — `frontend/`, `lib/publisher.js`.
4. **Phase 4** — failure-alerting thresholds, secrets wired up, both
   schedules verified in production.

Each phase should end with a commit and push, per `SCAFFOLD_MANIFEST.md`.
