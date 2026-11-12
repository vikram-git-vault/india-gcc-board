---
name: check-cv
description: Check tailored CVs and cover letters from career-ops against the owner's CV rules - facts only from the master CV (career-ops fact check), no em or en dashes, bold conventions, the owner's must-have items and the facts that must stay in separate sentences (config/private/cv-rules.md), page, bullet, headline and cover letter limits. Use this whenever the owner asks to check, review, verify or proofread a tailored CV, resume or cover letter, asks whether a CV follows the rules or has hallucinated facts, or right after a new Word CV is made. Reports only; changes nothing.
---

# Check a tailored CV

A tailored CV goes to an employer, so a wrong fact or a broken rule costs the owner a chance. This skill finds the problems; the owner decides what to fix.

The owner's own rules and facts are in `config/private/cv-rules.md` and `config/private/owner.json` (gitignored). Read `cv-rules.md` before step 3. Do not copy its facts into a file that git tracks.

## Steps

1. **Pick the roles.** The owner gives board role ids. If they give a job id or URL, use `node tools/find-role.js <input>` to get the role id. If they say "today's CVs", use the role ids with "Word CV" from `node tools/board-status.js`.

2. **Run the check**, all roles in one command:

   ```
   node tools/check-cv.js 18560 18561 18420
   ```

   It reads the worker's payloads and the Word text that `tailor.js` saved in the career-ops `output/` folder. It does not open the Word files in OneDrive. Thus it checks the CV as `tailor.js` built it: if the owner changed the Word file later, say that the check does not see those changes.

3. **Read the output:**
   - `WARN` lines are rules from `checkDocLimits()` (`lib/tailoring.js`): length, headline, bold, skill groups, dashes, and the owner's must-have items (`cv_checks` in `owner.json`).
   - `REVIEW` lines are sentences that may mix facts which must stay apart (`cv_checks.review` in `owner.json`). Read each sentence against the rule in `cv-rules.md` and decide. A correct sentence keeps each number with its own scope.
   - Fact check `FAIL`: the career-ops fact check found a claim with no support in `cv.md`. Give the claim. This is the most serious problem.

4. **Check what the script cannot.** Read the CV payload (`cv-payload-<report>-*.json`, path in the output folder of career-ops) and look at:
   - the headline job title agrees with the owner's real level (in `cv-rules.md`);
   - the lens (Product or Engineering) suits the job title;
   - the owner's must-have items are easy to see, near the top.
   Do this in a few lines. Do not write a full review of the CV text.

5. **Report** per role: OK, or a short list of problems, the most serious first.

## Rules to keep

- Change nothing. Do not edit the payloads, the Word files or `cv.md`. To fix a CV, the owner can run the role again (`/tailor-role`), or ask for a change by hand.
- CV rules apply to new CVs only (the owner's rule). An older CV made before a rule existed can break that rule: say "made before the rule" and not "wrong". `cv-rules.md` gives the start date of each dated rule; the job id in folder names started on 2026-11-06.
- The check reads personal data (the CV). Keep it in the answer; do not write it to a file in the repo.
