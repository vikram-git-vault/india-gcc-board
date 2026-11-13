---
name: board-status
description: Report what the last India GCC board run did - the refresh (employers ok and failed), RM scoring, career-ops evaluations, Word CVs made, failed or blocked roles, warnings in the logs, and the Claude cost. Use this whenever the owner asks "where are we now", "status", "what happened in the morning run", "did the refresh work", "check the refresh log", "any failed roles", "how much did today cost", or asks about scraping, scoring or tailoring results, even if they do not say "status". Read-only.
---

# Board status

The owner wants one short, accurate answer about the last run. All facts come from one read-only script, so the answer is the same each time and costs few tokens.

## Steps

1. Run the report as a plain command (no pipe, so it stays outside the sandbox like the other board commands):

   ```
   node tools/board-status.js
   ```

   For a different window, add `--since 2026-11-07T00:00` (UTC). The default starts at the beginning of the last refresh.

2. Check that the process runs: `pm2 status`. The board is one process, `india-gcc-board`. More than one, or a status other than `online`, is a problem to report.

3. Read the output and write the answer. Do not paste the raw output.

## How to read the output

- **Refresh.** The checkpoint is the final state of each employer. The log can show an error for an employer that the checkpoint shows as ok: the refresh tried it again after the network came back. Report only the employers that the checkpoint shows as failed. Mention the network loss in one line if the log has "No network" lines.
- **Board file.** The first line of "Roles on the board by state" gives the number of roles in `data/roles.json`. A `PROBLEM:` line there means that the board file does not come from the database (for example a test wrote it). Report it first, as the most important problem, with its fix (`node tools/publish.js`). Do not use the state counts below it: they are from the wrong file.
- **Roles on the board by state.** The counts use the names in `lib/states.js` (`docs/ARCHITECTURE.md`, section 18). The lines below the counts are the roles that need attention: `retry` (the next run tries again), `given_up` (failed twice; the owner can run `node tailor.js --role ID` by hand, or wait for a new description) and `no_cv` (passed the gate, too old for a CV; `node tailor.js --role ID` makes one). Report `given_up` and `no_cv` roles; `retry` needs no action.
- **career-ops results.** `ready` with "Word CV" is a new CV. `evaluated` is a score with no CV: either below the CV threshold (4.0), or too old for a CV (`tailoring.max_age_days`), or RM below 75 with `--any-fit`. The state lines above say which. `failed` is a problem: give the error.
- **Failed model calls.** A failed `careerops_score` call with "Not logged in" means that the worker ran inside the sandbox (a command with a pipe). The fix is to run `node tailor.js` as a plain command.
- **Cost** is list price, from `model_calls`.

## Answer format

Keep it short, in plain words (the owner reads about 80% ASD-STE100 style):

```
**Refresh** (6:00 to 6:23 IST): 105 of 108 employers ok. Failed: JLL, Amazon, Marsh & McLennan (timeouts).
**Scoring:** 22 roles scored.
**career-ops:** 7 evaluated, 3 Word CVs:
- 18560 Global Payments, Director, Software Engineering: 4.2
- ...
**Problems:** none / list
**Cost:** $11.06
```

Give times in IST (UTC + 5:30). End with the next action only when there is a problem to fix. Change nothing: this skill only reports.
