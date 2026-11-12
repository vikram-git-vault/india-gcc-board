# India GCC Board

India GCC Board is a personal job board for leadership roles in India GCC (global capability center) hub cities.
It covers BFSI (banking, financial services and insurance) and other industries.
It collects roles from the career sites of the employers in `config/employers.json` (161 employers; the refresh scrapes 106 of them).
It keeps only the roles that match a target profile.
It gives each role an ATS score and a fit score against two resume variants.
A small server on your computer shows the roles in a web page.
The daily operation does not need a cloud account or a Claude session.

## Documents

| Document | Content |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | The procedures to install, start, refresh and score. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The system design and the scraping policy. |
| [`docs/diagrams/architecture.html`](docs/diagrams/architecture.html) | An interactive diagram of the system components. Open it in a browser. |
| [`docs/diagrams/dataflow.html`](docs/diagrams/dataflow.html) | An interactive diagram of the data flow, from the career sites to the board. Open it in a browser. |
| [`docs/EMPLOYERS.md`](docs/EMPLOYERS.md) | All employers, with a link to each career site. |
| [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) | The frameworks and the concepts that the project uses. |
| [`SCAFFOLD_MANIFEST.md`](SCAFFOLD_MANIFEST.md) | A list of the project files and their purpose. |

## Quick start

Do these steps one time:

1. Install the packages:

   ```bash
   npm install
   ```

2. Make the environment file:

   ```bash
   cp .env.example .env
   ```

3. If necessary, change the values in `config/settings.json`. Put only secrets and private host names in `.env` (refer to `docs/SETUP.md`, section 2).

4. Make the database:

   ```bash
   node refresh.js --init
   ```

5. Start the server:

   ```bash
   npm run serve
   ```

6. Open http://localhost:4000 in a browser.

7. Click **Refresh now** to collect the roles for the first time. A full refresh takes approximately 30 to 45 minutes.

By default, the server refreshes the roles each day at 06:00 IST.
To change the schedule, use the **Auto refresh** control in the board header: **Daily at** a time, or **On demand only**.

> **NOTE:** The server listens on `127.0.0.1`. Thus only this computer can open the board. To open the board from other devices, refer to [`docs/SETUP.md`](docs/SETUP.md), section 7.
> For access from other networks, use Tailscale. Refer to [`docs/SETUP.md`](docs/SETUP.md).

## How the board selects and scores roles

1. **Collect.** The scrapers get the roles from each employer career site.
2. **Target.** The rules in `config/targets.json` classify each role by its title:
   - **Target:** VP, Associate Director, Director, Head, SVP. The board shows these roles.
   - **Target, lead role with no grade:** the board shows these roles. They are:
     - Product and program roles: product owner, product manager, program manager.
     - Engineering leader roles: engineering, development or delivery manager; engineering, chapter, squad or tribe lead.
   - **Exception:** AVP, Senior Manager. The board shows these roles only when the fit score is 75 or more.
   - **Excluded:** all other grades, hands-on engineering roles and non-technology functions. The board does not show these roles.
3. **Describe.** The refresh gets the full job description for each target role and each exception role.
4. **Score.** A scorer compares each role with the two resume variants. The scorer uses the rubric in `config/scoring-rubric.md`. Each role gets an ATS score, a fit score, the recommended resume and a short reason.
5. **Show.** The board shows the scores on each role. You can sort and filter the roles by score.

After each refresh, the server scores the new roles with Claude Code (`autoscore.js`). To score by hand, run `node autoscore.js`. Refer to [`docs/SETUP.md`](docs/SETUP.md), section 6.

Then the server sends the roles with an RM score of 75 or more to career-ops (`tailor.js`). career-ops gives a score from 1 to 5. At 4 or more, the board makes a tailored Word CV and cover letter for the role. You open the posting and apply. Refer to [`docs/SETUP.md`](docs/SETUP.md), section 6.1.

> **CAUTION:** The resumes are personal data. Keep them only in the `Resume/` folder. Git ignores this folder. Do not copy resume text into a file that git tracks.

## Status

Current status: Phase 9 is complete. The refresh scrapes 106 of 161 employers.

| Phase | Status |
|---|---|
| 0: Architecture, configuration, scaffold | Complete |
| 1: Database and generic scraper (3 pilot sites) | Complete |
| 2: ATS-specific scrapers | Complete. 22 employers are active (12 Workday, 2 Oracle, 1 Greenhouse, 1 Avature, 6 custom sitemap scrapers). 14 employers are tracked manually. Refer to `docs/ARCHITECTURE.md`, section 8.1. |
| 3: Frontend job board | Complete. Phase 3b replaces it. |
| 3b: Self-hosted, local-first | Complete. `server.js` serves the board and the API and runs the daily refresh. |
| 4: Hardening | Not started. |
| 5: Role targeting | Complete. `config/targets.json` and `lib/targeting.js`. |
| 6: Job descriptions and AI scoring | Complete. `lib/descriptions.js`, `score.js`, `config/scoring-rubric.md`. The scorer is Claude Code. An automatic scorer is a future option. |
| 7: Board redesign and schedule control | Complete. Wide layout, ATS score and RM score on each role, **Auto refresh** control (daily or on demand only). |
| 8: Employer discovery | Complete. `discover.js` finds companies and their ATS. 113 employers added (BFSI and other industries). Refer to `docs/ARCHITECTURE.md`, section 15. |
| 9: Security | Complete. The server listens on `127.0.0.1`. It checks the `Host` and `Origin` headers and sends a strict Content-Security-Policy. Refer to `docs/ARCHITECTURE.md`, section 6. |

## Project structure

```
config/             employers, filters, targeting rules, scoring rubric
lib/                database, parser, targeting, descriptions, scoring, discovery, schedule, publisher
lib/states.js       the named states of a role, its score, career-ops and the server cycle
lib/scrapers/       scraper classes, one for each ATS type
refresh.js          refresh: scrape, classify, get descriptions, publish
score.js            scoring: export roles to score, import scores
tailor.js           career-ops: tailored Word CV and cover letter for the best roles
tools/              Word builders for the tailored CV and cover letter; read-only reports (find-role, board-status, check-cv); add-job
discover.js         discovery: find companies and detect their ATS (manual run)
server.js           server: shows the board, gives the API, runs the daily refresh
frontend/public/    the board web page (index.html, js/, css/, fonts/)
test/               Jest tests
docs/               documents
.github/workflows/  workflow from an earlier cloud setup (schedule off)
data/               SQLite database and roles.json (git ignores this folder)
logs/               refresh logs (git ignores this folder)
Resume/             resume variants and candidate profile (git ignores this folder)
```

## License

MIT
