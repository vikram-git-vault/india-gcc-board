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

## 2. Configure the settings

The settings are in two files:

- `config/settings.json` contains all settings that git can keep. Git keeps this file.
- `.env` contains only the values that must not be in git: secrets and private host names. Git ignores this file.

`lib/settings.js` gives a default value for each property in `config/settings.json`. The file overrides the default. If a property is missing, the default applies. If a value has a wrong type or is out of range, the program writes a warning and uses the default. An unknown property also gives a warning.

1. Copy the example file:

   ```bash
   cp .env.example .env
   ```

2. If other devices must open the board, set `ALLOWED_HOSTS` in `.env`. Refer to section 7.
3. Examine the values in `config/settings.json`. The default values are correct for most installations.
4. After a change to `config/settings.json`, restart the server.

### 2.1 `.env`

| Variable | Default | Function |
|---|---|---|
| `ALLOWED_HOSTS` | (empty) | More host names that can open the board, with a comma between names. For example: your Tailscale name. The server always accepts `localhost` and IP addresses. It rejects other host names with `403`. Refer to section 7. |
| `SLACK_WEBHOOK` | (empty) | Not used by local code. The GitHub workflow reads it from the repository secrets. Notifications are a Phase 4 item. |

> **CAUTION:** Do not put API keys, personal data or private host names in `config/settings.json`. Git keeps this file.

### 2.2 `config/settings.json`

| Property | Default | Function |
|---|---|---|
| `server.port` | `4000` | The port that `server.js` listens on. |
| `server.host` | `127.0.0.1` | The address that `server.js` listens on. With `127.0.0.1`, only this computer can open the board. To let other devices open the board, refer to section 7. |
| `server.progress_log_minutes` | `1` | The minutes between the progress lines in the server log during a refresh. |
| `schedule.refresh_cron` | `0 6 * * *` | The first default for the daily refresh time (cron format). The board can change the schedule. Refer to section 5.1. |
| `schedule.timezone` | `Asia/Kolkata` | The time zone of the refresh schedule. |
| `schedule.catch_up_check_minutes` | `5` | The minutes between the checks for a missed refresh. |
| `schedule.retry_after_minutes` | `10` | The minutes before the server tries a failed refresh again (one time). |
| `refresh.scrape_concurrency` | `6` | The number of employers that the refresh scrapes at the same time (1 to 16). Refer to section 4.1 of `docs/ARCHITECTURE.md`. |
| `refresh.employer_time_limit_minutes` | `20` | The time limit for one employer. After the limit, the employer counts as failed. |
| `refresh.publish_interval_seconds` | `30` | The minimum time between two writes of `data/roles.json` during a refresh. |
| `refresh.checkpoint_max_age_hours` | `12` | A resumed refresh continues an unfinished run only if the run is younger than this. |
| `refresh.network_wait_minutes` | `15` | Without a network, the refresh waits this long. Then it pauses, and the server continues it when there is a network. |
| `refresh.network_check_seconds` | `30` | The time between two network checks while the refresh waits. |
| `refresh.max_failed_percent` | `50` | If more failed employers than this percentage, the run is not complete and the server tries it again. |
| `scraping.user_agent` | `india-gcc-board-bot/1.0 (...)` | The name that the scrapers send to the employer sites. |
| `scraping.request_timeout_seconds` | `30` | The time limit for one request. |
| `scraping.default_crawl_delay_seconds` | `5` | The crawl delay for an employer that has no `crawl_delay_seconds` in `config/employers.json`. |
| `scraping.network_check_host` | `github.com` | The network check opens a connection to this host on port 443. |
| `descriptions.min_full_chars` | `1000` | A scraped description with this length or more is the full text. The refresh does not get the description again. |
| `descriptions.max_chars` | `50000` | The maximum length of a stored description. |
| `descriptions.refetch_ok_days` | `14` | The age after which the refresh gets a description again. |
| `descriptions.retry_error_hours` | `20` | The time before the refresh tries a failed description again. |
| `descriptions.retry_skipped_days` | `7` | The time before the refresh tries a skipped description again. |
| `scoring.auto_score` | `true` | Score new roles with Claude Code after each refresh. Refer to section 6. |
| `scoring.max_roles_per_run` | `50` | The maximum number of roles that one automatic scoring run scores. |
| `scoring.batch_size` | `10` | The number of roles in one request to Claude Code. |
| `scoring.claude_timeout_minutes` | `15` | The time limit for one request to Claude Code. After the limit, `autoscore.js` sends the same batch one more time. Thus one batch can take two times this limit. |
| `scoring.max_attempts` | `2` | After this number of rejected scores, the role is not sent again until its description changes. |
| `scoring.keep_score_files` | `10` | The number of score files that `.cache/autoscore/` keeps. |
| `scoring.rescore_min_fit` | `65` | After a rubric change, the scorer scores a role again only when its better RM score was this or more. A lower role keeps its score until its title or description changes. |
| `board.max_age_days` | `30` | The board shows, and Claude scores, only the roles that are this number of days old or less (the posted date, or the day that the board found the role). An older role keeps its scores. The board shows it when you select **Show roles older than 30 days**. Roles that you marked and roles with a tailored CV always show. `--role ID` and a re-tailor after a confirmed gap are not limited. |
| `tailoring.auto_tailor` | `true` | After the scoring, send the best-matched roles to career-ops for a tailored Word CV and cover letter. Refer to section 6.1. |
| `tailoring.career_ops_dir` | `~/Projects/career-ops` | The career-ops folder. `~` is your home folder. |
| `tailoring.output_dir` | `~/Library/CloudStorage/OneDrive-Personal/Desktop/Resume_Tailored` | The folder for the Word files. |
| `tailoring.min_fit_score` | `75` | career-ops gets only the roles whose better RM score is this or more. |
| `tailoring.max_age_days` | `3` | career-ops evaluates roles of all ages, but makes a Word CV only for a role that is this number of days old or less. The date is the posted date (or the day that the board found the role). When the employer changes the title or the text of the role, the date of the change is used. A new CV goes into a new folder. The earlier CVs stay. |
| `tailoring.max_roles_per_run` | `40` | The maximum number of roles in one tailoring run. |
| `tailoring.worker_timeout_minutes` | `20` | The time limit for one role. |
| `tailoring.max_attempts` | `2` | After this number of failed runs, the role is not sent again until its description changes. |
| `models.rm` | `claude-opus-5-5` | The model for RM scoring. Refer to `docs/ARCHITECTURE.md`, section 17. |
| `models.rm_effort` | `medium` | The effort level of RM scoring: `low`, `medium`, `high`, `xhigh` or `max`. Do a check run (`tools/shadow-score.js`) before you change it. |
| `models.scoring` | `claude-sonnet-5-5` | The model for the career-ops evaluation. |
| `models.documents` | `claude-opus-5-5` | The model for the tailored CV and cover letter (the second message of the career-ops worker). |
| `discovery.delay_seconds` | `5` | The delay between requests of `discover.js`. |
| `logging.level` | `info` | The minimum level of log messages: `error`, `warn`, `info` or `debug`. |
| `database.path` | `./data/jobs.db` | The location of the database. |

3. Make your private files and folders readable only by your macOS user:

   ```bash
   mkdir -p data logs .cache Resume
   chmod 600 .env
   chmod 700 data logs .cache Resume
   chmod 700 ~/.pm2/logs   # after the first pm2 start (section 5.3)
   ```

   `data/` contains the database and the scores. `Resume/` contains your resumes. `.cache/`, `logs/` and the pm2 logs can contain parts of the scores. The server writes new files in these folders. A folder with mode `700` keeps all of its files private.

### 2.3 `config/private/` (your CV facts)

This folder keeps your own facts out of git. Git ignores all files in it, except the `_example` files.

1. Copy the two example files:

   ```bash
   cp config/private/owner_example.json config/private/owner.json
   cp config/private/cv-rules_example.md config/private/cv-rules.md
   ```

2. In `owner.json`, write your home city (`home_city`) and the match patterns of your must-have CV items (`cv_checks`). The CV contact line shows the city of the role and then your home city, for example "Mumbai/Pune". When the role gives no city, the template's location stays.
3. In `cv-rules.md`, write your own CV rules: your level, examples of bold facts, the items that each CV must have, and the city and availability for the cover letter. Use only facts from your master CV.

Do not put your facts in other files that git tracks. When a private file is missing, the board uses its `_example` file and `tailor.js` writes a warning to the log.

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

The refresh saves each employer immediately. If the refresh stops, `node refresh.js --resume` continues it from the employer that stopped. Refer to `docs/ARCHITECTURE.md`, section 6.1.

A full refresh takes approximately 30 to 45 minutes.
Most of this time is the crawl delay between requests to each employer site. The delay is intentional.
The logs go to the shell and to `logs/combined.log` and `logs/error.log`.

### Other refresh commands

| Command | Function | Time |
|---|---|---|
| `node refresh.js --reclassify` | Applies `config/targets.json` again to all stored roles. Use it after you change the targeting rules. It does not scrape. | Seconds |
| `node refresh.js --resume` | Continues the last refresh if it did not complete and started less than 12 hours before. Otherwise it starts a full refresh. | The remaining employers |
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
If the file does not exist, the server uses `schedule.refresh_cron` in `config/settings.json` as the daily time.

### 5.2 Missed refreshes (the computer was asleep)

If the computer sleeps at the daily time, the refresh does not start at that time.
The server checks every 5 minutes, and 30 seconds after it starts. If a daily refresh was due and no refresh started after that time, the server starts the refresh immediately.
For example, when you open the computer at 08:30, the refresh starts within approximately 5 minutes.
The server makes only one catch-up attempt for each due time. The check does nothing in the **On demand only** mode.
If a refresh stops with an error, the server tries it again one time after 10 minutes. The new attempt continues from the employer that stopped.
During a refresh and the scoring after it, the server keeps the Mac awake with `caffeinate`. When the cycle ends, the Mac can sleep again. The cycle ends after the scoring, or when the refresh pauses or fails.
On battery power with a closed lid, `caffeinate` cannot keep the Mac awake. Thus the refresh does not start then. If you close the lid on battery power during a refresh, the refresh pauses before the next employer. The board shows **Refresh paused**. When you connect mains power or open the lid, the refresh continues within approximately 5 minutes.

> **NOTE:** To refresh before you start work, you can also wake the computer before the daily time. On macOS, run `sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00`. A MacBook with a closed lid on battery power can stay asleep.

### 5.3 Keep the server running with pm2

1. Install pm2: `npm install -g pm2`.
2. Start the server: `pm2 start server.js --name india-gcc-board`.
3. Run `pm2 startup` and run the command that it shows.
4. Run `pm2 save`.
5. After a change to the code, run `pm2 restart india-gcc-board`.

To see the server messages, run `pm2 logs india-gcc-board`.
During a refresh, the server writes one progress line each minute. For example:

`Refresh running 12 min: scraping employer 14 of 56 (EY GDS), 3 min on this step`

When the refresh stops, the server writes the exit code and the total time.
`GET /api/refresh/status` also gives the progress in the `progress` field.

> **NOTE:** The daily refresh occurs only while the server runs. To keep the server running after you close the shell, use a process manager. For example: `pm2 start server.js --name india-gcc-board`, or a `launchd` agent on macOS.

## 6. Score the roles

The board shows two scores on each role:

- **ATS score (0–100):** how well your resume text matches the job description.
- **Fit score (0–100):** how a recruiter rates your experience for the role.

The board also shows the recommended resume (Product Owner or Engineering Leader), a reason, the matched keywords and the gaps.
Exception roles (AVP, Senior Manager) stay on the board only when the fit score is 75 or more.

The scorer is Claude Code. After each successful refresh, the server scores the new roles automatically (`autoscore.js`). While the scores are in progress, the board footer shows the counts: the roles done, the scores stored, the scores rejected, the roles left and the model. The server log (`pm2 logs india-gcc-board`) shows the same counts after each batch and one time each minute. Each batch of 10 roles takes approximately 30 to 60 seconds.

Automatic scoring needs these conditions:

- You installed Claude Code on this computer, and you logged in to it.
- The three resume files are in the `Resume/` folder.

To stop automatic scoring, set `scoring.auto_score` to `false` in `config/settings.json` and restart the server.
To score by hand, run `node autoscore.js`, or use the procedure that follows.

> **CAUTION:** Keep the resume files only in `Resume/`. Do not copy resume text into a file that git tracks. The resume files contain personal data. Git ignores the `Resume/` folder.

1. Make sure that these files are available:
   - `cv.md` in the career-ops folder (`tailoring.career_ops_dir`): the master CV. career-ops uses the same file.
   - `candidate_profile.txt` in the `Resume/` folder.
2. Open Claude Code in the project folder.
3. Type: "score the new roles".
4. Wait until Claude Code shows the number of stored scores.
5. Reload the board.

> **NOTE:** Automatic scoring uses your Claude plan usage. If you reach the usage limit, the roles stay without a score. The next refresh tries again.

> **NOTE:** In step 4, Claude Code does these tasks:
> - It runs `node score.js --pending`. This command writes the roles that need a score to `.cache/scoring/pending.json`.
> - It scores each role with the rubric in `config/scoring-rubric.md`.
> - It writes the scores to a file and runs `node score.js --import <file>`.

To see how many roles need a score, run:

```bash
node score.js --status
```

A score becomes stale when the job description or the rubric version changes. The `--pending` output includes stale roles.
The board shows a stale score with the label "score out of date". A role with no score shows why: it waits for a score, the scorer gave up on it (two rejected scores), or it is older than the board window. `docs/ARCHITECTURE.md`, section 18.4, lists the states.

> **NOTE:** `score.js --import` rejects a score that does not agree with the rubric schema. For example, it rejects a score above 100, or a recommended resume that does not have the higher fit score. The command shows the reason for each rejection.

### 6.1 Tailored resumes (career-ops)

After the scoring, the server sends each role with an RM score of 75 or more to career-ops (`tailor.js`). career-ops gives the role a score from 1 to 5. At 4 or more, the board makes a tailored Word CV and cover letter. The role card shows:

- The career-ops score next to the ATS score and the RM score. A dashed box means that the role waits for career-ops; its tooltip says what the next run does (waiting, a retry, or given up after two failed runs). "Why this score" names the state: a Word CV is ready, the role is below the gate, or it passed the gate but was too old for a CV. The refresh status panel (point to "Updated") counts the roles in each state. `docs/ARCHITECTURE.md`, section 18.5, lists the states.
- The links **Resume (Word)**, **Cover letter (Word)**, **career-ops report** and **Folder**. On the computer that runs the board, a click opens the file in its OneDrive folder (Word files open in Word) or opens the folder in Finder. On another device, a click downloads the file.
- In "Why this score": the career-ops decision and the job requirements that are not in your master CV.

Tailoring needs these conditions:

1. career-ops is in `tailoring.career_ops_dir`, and `node doctor.mjs` in that folder shows no failures.
2. These career-ops files have your data: `cv.md` (the master CV), `config/profile.yml` and `modes/_profile.md`.
3. `Resume/templates/resume.docx` and `Resume/templates/cover-letter.docx` are your own Word files. The board copies their format.

To run tailoring by hand, run one of these commands:

```bash
node tailor.js              # all roles that need it
node tailor.js --max 5      # not more than 5 roles
node tailor.js --role 463   # only role 463
```

While tailoring runs, the server log (`pm2 logs india-gcc-board`) shows the progress, as for the scoring:

- A progress line when a role starts a step (the career-ops evaluation or the CV and cover letter), and one time each minute. The line shows the roles done, the role in progress, its step and model, the time on this role, and the counts: scored, passed the gate, Word CVs, too old for a CV, failed, left.
- One line for each finished role: its career-ops score and the result (Word CV made, below the CV threshold, too old for a CV, or the reason that it failed).
- A summary line when tailoring ends. It also shows a usage limit that stopped the run.

To stop tailoring, set `tailoring.auto_tailor` to `false` and restart the server.

To add a skill that career-ops shows as a gap, do these steps:

1. Open "Why this score" on the role card.
2. Below "Not in your master CV", click **I have done this** next to the gap.
3. Write where you did it, what you did and a result, in your own words.
4. Click **Add to my master CV**.

The board adds your text to `cv.md` and career-ops makes the resume of this role again (approximately 3 minutes). Later resumes for other roles can also use it.

> **CAUTION:** The master CV is the only source of facts for the tailored files. Add only experience that you have. The board adds your words as you write them.

The marks **Applied**, **Rejected** and **Closed** also change the status of the role in the career-ops tracker (`data/applications.md` in the career-ops folder). The server keeps the marks, so all your browsers and devices show the same marks.

> **NOTE:** Read each Word file before you send it. The page count is an estimate. Make sure that the CV has 3 pages or less in Word.

### 6.2 Add a job that the board did not find

To add a job from LinkedIn, Naukri or a career site that the board does not scrape, do these steps:

1. On the board, click **Add a job**.
2. Paste the link to the job, the job description, or both.
3. If you paste only a link, you can leave the company, title and city empty. The board takes them from the link.
4. Click **Add the job**.

The board reads Workday links and most career sites. If it cannot read the link, the form tells you to paste the job description. The job shows with the **Manual** tag, and the scoring starts immediately. If the job passes the gate, career-ops makes the Word CV and cover letter (approximately 5 to 10 minutes).

If the job fails the gate, click **Make CV anyway** on its card to get a CV. The 3-day age limit does not apply to a manual job. The refresh never closes a manual job: when you do not need it, mark it **Closed**.

You can also add a job from the command line:

```bash
node tools/add-job.js --url <link> [--file jd.md] [--company NAME] [--title TITLE] [--location CITY]
node autoscore.js
node tailor.js --role <role id>
```

To see the state of a role (open or closed, the job text, the RM score, career-ops, the mark) and the `tailor.js` command for it, run `node tools/find-role.js <role id | job id | job URL>`. `node tools/board-status.js` reports the last run and counts the roles on the board in each state. Both are read-only. If the status report says that the board file does not match the database, run `node tools/publish.js`. It writes `data/roles.json` again from the database.

> **NOTE:** Workday can give the legal name of the company (for example a name with "Private Limited"). Type the usual name in the **Company** field.

## 7. Open the board from other devices

By default, the server listens on `127.0.0.1`. Thus only this computer can open the board.

> **WARNING:** The board has no login. A device that can open the board can see your scores and the reasons. The reasons contain details from your resume. That device can also start a refresh and change the schedule.

### Devices on the same Wi-Fi network

Do these steps only on a network that you trust, for example your home network. Do not do them on a public network.

1. In `config/settings.json`, set `server.host` to `0.0.0.0`.
2. Restart the server: `pm2 restart india-gcc-board --update-env`.
3. Run `ipconfig getifaddr en0` to find the LAN IP address of this computer (macOS, Wi-Fi).
4. On the other device, open `http://<LAN-IP>:4000`.

### Devices on other networks

Use Tailscale. Tailscale makes a private network between your devices only. It does not make the board public.

1. Install [Tailscale](https://tailscale.com/download) on this computer.
2. Sign in to Tailscale.
3. Install Tailscale on each other device.
4. Sign in on each device with the same account.
5. On this computer, run `tailscale serve --bg 4000`. Tailscale then sends requests from your devices to the board on `127.0.0.1`. Thus `HOST` can stay `127.0.0.1`.
6. Run `tailscale serve status` to find the board URL, for example `https://<host-name>.<tailnet>.ts.net`.
7. In `.env`, set `ALLOWED_HOSTS=<host-name>.<tailnet>.ts.net`.
8. Restart the server: `pm2 restart india-gcc-board --update-env`.
9. On the other device, open the URL.

> **NOTE:** If the board shows "Host not allowed", add the host name in the address bar to `ALLOWED_HOSTS`. If **Refresh now** or **Auto refresh** shows an error, do the same. The server log shows each rejected request.

## 8. Optional: an unlisted public URL

You can share the board with a URL that no search engine or list shows. The project does not need changes for this.

> **WARNING:** Do not share the URL with persons who must not see your data. The board shows your scores and the reasons, and these contain details from your resume.

1. Install [`cloudflared`](https://github.com/cloudflare/cloudflared).
2. While the server runs, run:

   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```

3. Copy the `https://*.trycloudflare.com` URL that `cloudflared` shows.
4. In `.env`, set `ALLOWED_HOSTS` to the host name of that URL, for example `ALLOWED_HOSTS=abc-def.trycloudflare.com`.
5. Restart the server: `pm2 restart india-gcc-board --update-env`.

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
