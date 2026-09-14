# Setup Guide

## Prerequisites

- Node.js 18+
- macOS/Linux shell access

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` — sane defaults already in `.env.example`:
- `PORT` / `HOST` — where `server.js` listens (default `4000` / `0.0.0.0`;
  `0.0.0.0` means it's already reachable from other devices on your
  network, not just `localhost`).
- `REFRESH_CRON` / `TZ` — when the server's built-in scheduler runs the
  daily refresh (default 6 AM `Asia/Kolkata`).
- `CRAWL_DELAY_MS`, `DB_PATH` — scraper behavior, rarely need changing.

## 3. Initialize the database

```bash
node refresh.js --init
```

Creates `data/jobs.db` with the schema described in `docs/ARCHITECTURE.md` §3.

## 4. Run a first scrape

```bash
node refresh.js
```

This scrapes all `active: true` employers in `config/employers.json`
(currently 22), writes results to `data/jobs.db`, and publishes
`data/roles.json` for the server to serve. A full run takes roughly
30–45 minutes — most of that is deliberate per-employer crawl delay
(politeness toward the employer sites, not a performance problem).
Logs go to stdout and `logs/combined.log` / `logs/error.log`.

## 5. Start the server

```bash
npm run serve
```

Open **http://localhost:4000** — that's the board. It also:
- Re-runs the refresh automatically every day at the time set by
  `REFRESH_CRON`, for as long as the process keeps running.
- Exposes a **"Refresh now"** button in the UI for an on-demand run
  (`POST /api/refresh`; a lock prevents two runs overlapping).

Keep it running: for actual daily use, run it under something that
survives terminal closes and machine sleep — e.g. `pm2 start server.js
--name india-gcc-board`, a `launchd` agent on macOS, or just a spare
terminal tab you leave open. Not scripted here since it's a one-time
personal preference, not something the app needs to dictate.

## 6. Reach it from your other devices

**Same Wi-Fi (laptop, desktop, phone on the same network):** nothing
extra to do — find this machine's LAN IP (`ipconfig getifaddr en0` on
macOS Wi-Fi) and open `http://<that-ip>:4000` from the other device.

**From anywhere, still private to only your own devices** (e.g. phone on
mobile data, not home Wi-Fi):

1. Install [Tailscale](https://tailscale.com/download) on this machine
   and sign in (free for personal use).
2. Install Tailscale on each other device (phone, other laptop) and sign
   into the **same account**.
3. On this machine, note the Tailscale hostname/IP (`tailscale status` or
   the Tailscale app).
4. From another device, open `http://<tailscale-hostname>:4000`.

This is a private mesh network between only your signed-in devices —
nothing is exposed publicly.

## 7. Later: an unlisted URL, if you ever want to share it

No changes to this project needed — run
[`cloudflared`](https://github.com/cloudflare/cloudflared) (free,
open-source) alongside the already-running server:

```bash
cloudflared tunnel --url http://localhost:4000
```

This prints a public-but-unlisted `https://*.trycloudflare.com` URL that
proxies to your local server for as long as the tunnel runs. Nobody finds
it without the exact link. (A named, persistent tunnel with your own
domain is also possible later via a free Cloudflare account, if the
quick-tunnel URL changing on restart becomes annoying — not needed to
start.)

## GitHub Actions (not used in this setup)

`.github/workflows/refresh-schedule.yml` exists in the repo from an
earlier cloud-hosting attempt and currently references a publish step
that no longer applies. It's left as a starting point for a possible
future fully-cloud-hosted phase — leave it disabled (don't add its
secrets) unless/until you deliberately revisit that path; see
`docs/ARCHITECTURE.md` §6.

## Where things stand

All phases through **3b (self-hosted, local-first)** are done — see the
status table in `README.md` and `docs/ARCHITECTURE.md` §8 for the full
phase-by-phase history and what's still open (Phase 4: hardening).
