---
name: tailor-role
description: Run career-ops (score, gaps and, when the role qualifies, a tailored Word CV and cover letter) for roles the owner names on the India GCC board - by job URL, employer job id (such as R-2680072) or board role id. Use this whenever the owner pastes a job link or job id and asks to score it, evaluate it, run career-ops, tailor a CV, make a resume or cover letter for it, or check whether it is indexed or scored. Also use it when the owner pastes a job description or a job link that the board has not scraped (LinkedIn, Naukri, any career site) and asks to add it, and to re-run career-ops on a role after a gap answer.
---

# Tailor a role with career-ops

The owner pastes roles from employer sites. This skill finds them on the board, tells the owner what career-ops can do for each one, and runs it.

## Steps

1. **Find the roles.** Give all the inputs to one call:

   ```
   node tools/find-role.js <url | job id | role id> ...
   ```

   For each input it prints the board role, its RM score, any earlier career-ops result and the `tailor.js` command to use.

2. **Handle what the script cannot run:**
   - `NOT FOUND`: the board has not scraped the role. Add it as a manual job (step 2a) when the owner asked to add it, or asked to score or tailor it. If the employer is not in `config/employers.json` (search by its career site host), also offer to add the employer for the future. Do not add an employer without the owner's yes.
   - `NOT SCORED`: run `node autoscore.js` (it scores all pending roles), then run step 1 again.
   - `CLOSED`: the posting is gone. Tell the owner; do not run career-ops.

2a. **Add a manual job** (a link the board has not scraped, or a job description that the owner pasted):

   ```
   node tools/add-job.js --url <link> [--file <jd file>] [--company NAME] [--title TITLE] [--location CITY]
   ```

   - For pasted text, write it to a file in the scratchpad directory (not in the repo) and give it with `--file`.
   - The board reads Workday links and pages with schema.org job data. `NOT ADDED: ... paste it` means it could not: ask the owner to paste the job description. LinkedIn, Naukri and pages with a login always need the pasted text.
   - Workday can give the legal entity as the company (for example "RE1055 GE ... Private Limited"). Give `--company` with the usual name.
   - `ADDED: role ID`: run `node autoscore.js`, then go on with step 3 for that role id. `ALREADY ON THE BOARD`: use that role id.
   - A manual job has no 3-day CV limit and the refresh never closes it. When it fails the gate, the owner can ask for a CV anyway: `node tailor.js --role ID --force-cv` (or the **Make CV anyway** button on the board).

3. **Tell the owner before a costly run.** One career-ops role takes about 3 minutes and costs about $0.50 for the evaluation, plus about $2 when it makes a CV. For each role, say which case applies:
   - RM 75 or more: `node tailor.js --role ID`. It makes a Word CV when career-ops gives 4.0 or more.
   - RM below 75: `node tailor.js --role ID --any-fit`. Score and gaps only: the gate (RM 75 and career-ops 4.0) never gives a CV for it.
   If the owner already asked to run it, go on without a second question.

4. **Run it** with all the role ids in one command, comma-separated:

   ```
   node tailor.js --role 18054,18032 --any-fit
   ```

   Run it as a plain command: no pipe, no `| grep`, no `&&` chain. A plain `node tailor.js` command runs outside the sandbox (it is in `sandbox.excludedCommands`). A command with a pipe runs inside the sandbox, the worker cannot read the login in the macOS keychain, and the role fails with "Not logged in". Run it in the background when there are more than two roles. Use `--any-fit` only when at least one role is below RM 75; it does no harm for the roles above.

5. **Report** for each role: the career-ops score, the decision, the gaps (short), and, when a CV was made, the folder path. The folder is `<Company>/<YYYY-MM-DD>_<Role>_<job id>/` in the Resume_Tailored folder. For a new CV, offer `/check-cv <role id>`.

## Rules to keep

- Never start a career-ops worker with `--dangerously-skip-permissions`. `tailor.js` sets the limited permissions; always use it, not career-ops directly.
- The CV facts come only from `cv.md` in the career-ops folder. If the owner gives new experience for a gap, it goes through the board's **I have done this** button (or ask the owner before you add it to `cv.md` by hand), then run the role again.
- Do not write to the owner's original resume folder (OneDrive `Desktop/Resume`).
