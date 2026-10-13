# Setup guide

This guide gives the procedures to install, start, refresh and score the board.

## Prerequisites

- Node.js 18 or later.
- A macOS or Linux shell.

## 1. Install the packages

1. Open a shell in the project folder.
2. Install the packages:

   ```bash
   npm install
   ```

## 2. Configure the environment

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. Examine the values in `.env`. The default values are correct for most installations.

| Variable | Default | Function |
|---|---|---|
| `PORT` | `4000` | The port that `server.js` listens on. |
| `HOST` | `0.0.0.0` | The address that `server.js` listens on. `0.0.0.0` lets other devices on your network open the board. |
| `REFRESH_CRON` | `0 6 * * *` | The first default for the daily refresh time (cron format). The board can change the schedule. Refer to section 5.1. |
| `TZ` | `Asia/Kolkata` | The time zone of the refresh schedule. |
| `LOG_LEVEL` | `info` | The minimum level of log messages. |
| `CRAWL_DELAY_MS` | `8000` | Not used. The scrapers use `crawl_delay_seconds` for each employer in `config/employers.json`. |
| `MAX_CONCURRENT_SCRAPERS` | `3` | Not used. The refresh scrapes one employer at a time. |
| `USER_AGENT` | `india-gcc-board-bot/1.0 (...)` | The name that the scrapers send to the employer sites. |
| `DB_PATH` | `./data/jobs.db` | The location of the database. |
| `SLACK_WEBHOOK` | (empty) | Not used. Notifications are a Phase 4 item. |

## 3. Make the database

1. Make the database:

   ```bash
   node refresh.js --init
   ```

This command makes `data/jobs.db`. Refer to `docs/ARCHITECTURE.md`, section 3, for the schema.
You can run this command again. It adds new columns and tables to an existing database and keeps the data.

## 4. Do a refresh

1. Start a full refresh:

   ```bash
   node refresh.js
   ```

A full refresh does these steps:

1. It scrapes all employers that have `active: true` in `config/employers.json` (22 employers).
2. It classifies each role with the rules in `config/targets.json`.
3. It writes the roles to `data/jobs.db`.
4. It gets the full job description for each target role and each exception role.
5. It writes `data/roles.json`. The server shows this file.

A full refresh takes approximately 30 to 45 minutes.
Most of this time is the crawl delay between requests to each employer site. The delay is intentional.
The logs go to the shell and to `logs/combined.log` and `logs/error.log`.

### Other refresh commands

| Command | Function | Time |
|---|---|---|
| `node refresh.js --reclassify` | Applies `config/targets.json` again to all stored roles. Use it after you change the targeting rules. It does not scrape. | Seconds |
| `node refresh.js --descriptions` | Gets the missing job descriptions. It does not scrape the role lists. | Approximately 5 seconds for each role |

## 5. Start the server

1. Start the server:

   ```bash
   npm run serve
   ```

2. Open http://localhost:4000 in a browser.

The server does these tasks:

- It shows the board.
- It does a refresh on the schedule that you set on the board, while the process runs.
- It does a refresh when you click **Refresh now**. A lock prevents two refreshes at the same time.

### 5.1 Set the refresh schedule

The board header has the control **Auto refresh**. It has two settings:

- **Daily at:** the server does a refresh each day at the time that you set.
- **On demand only:** the server does a refresh only when you click **Refresh now**.

To change the schedule:

1. In the board header, select **Daily at** or **On demand only**.
2. If you select **Daily at**, set the time.
3. Wait until the control shows **Saved**.

The change has an effect immediately. You do not have to restart the server.
The server keeps the setting in `data/schedule.json`. Git ignores this file.
If the file does not exist, the server uses `REFRESH_CRON` in `.env` as the daily time.

> **NOTE:** The daily refresh occurs only while the server runs. To keep the server running after you close the shell, use a process manager. For example: `pm2 start server.js --name india-gcc-board`, or a `launchd` agent on macOS.

## 6. Score the roles

The board shows two scores on each role:

- **ATS score (0–100):** how well your resume text matches the job description.
- **Fit score (0–100):** how a recruiter rates your experience for the role.

The board also shows the recommended resume (Product Owner or Engineering Leader), a reason, the matched keywords and the gaps.
Exception roles (AVP, Senior Manager) stay on the board only when the fit score is 75 or more.

The scorer is Claude Code. Do this procedure after each refresh that finds new roles.

> **CAUTION:** Keep the resume files only in `Resume/`. Do not copy resume text into a file that git tracks. The resume files contain personal data. Git ignores the `Resume/` folder.

1. Make sure that these files are in the `Resume/` folder:
   - `profile_product_owner.txt`
   - `profile_engineering_leader.txt`
   - `candidate_profile.txt`
2. Open Claude Code in the project folder.
3. Type: "score the new roles".
4. Wait until Claude Code shows the number of stored scores.
5. Reload the board.

> **NOTE:** In step 4, Claude Code does these tasks:
> - It runs `node score.js --pending`. This command writes the roles that need a score to `.cache/scoring/pending.json`.
> - It scores each role with the rubric in `config/scoring-rubric.md`.
> - It writes the scores to a file and runs `node score.js --import <file>`.

To see how many roles need a score, run:

```bash
node score.js --status
```

A score becomes stale when the job description or the rubric version changes. The `--pending` output includes stale roles.
The board shows a stale score with the label "score out of date".

> **NOTE:** `score.js --import` rejects a score that does not agree with the rubric schema. For example, it rejects a score above 100, or a recommended resume that does not have the higher fit score. The command shows the reason for each rejection.

## 7. Open the board from other devices

### Devices on the same Wi-Fi network

1. Run `ipconfig getifaddr en0` to find the LAN IP address of this computer (macOS, Wi-Fi).
2. On the other device, open `http://<LAN-IP>:4000`.

### Devices on other networks

Use Tailscale. Tailscale makes a private network between your devices only. It does not make the board public.

1. Install [Tailscale](https://tailscale.com/download) on this computer.
2. Sign in to Tailscale.
3. Install Tailscale on each other device.
4. Sign in on each device with the same account.
5. On this computer, run `tailscale status` to find the Tailscale host name.
6. On the other device, open `http://<tailscale-host-name>:4000`.

## 8. Optional: an unlisted public URL

You can share the board with a URL that no search engine or list shows. The project does not need changes for this.

> **WARNING:** Do not share the URL with persons who must not see your data. The board shows your scores and the reasons, and these contain details from your resume.

1. Install [`cloudflared`](https://github.com/cloudflare/cloudflared).
2. While the server runs, run:

   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```

3. Copy the `https://*.trycloudflare.com` URL that `cloudflared` shows.

The URL works while the tunnel runs. A person can open the board only with the exact URL.

> **NOTE:** The quick-tunnel URL changes each time you start the tunnel. A named tunnel with your own domain needs a free Cloudflare account.

## GitHub Actions (not used)

The file `.github/workflows/refresh-schedule.yml` is from an earlier cloud setup. It refers to a publish step that the project does not use now.
Its schedule is in a comment, so the workflow runs only when a person starts it.
Do not enable the schedule. Do not add its secrets.
Refer to `docs/ARCHITECTURE.md`, section 6.

## Status

Phases 0 to 3b, 5 and 6 are complete. Phase 4 (hardening) is not started.
Refer to the status table in `README.md` and to `docs/ARCHITECTURE.md`, section 8.
