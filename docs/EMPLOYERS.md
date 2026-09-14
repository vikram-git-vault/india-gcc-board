# Employer Directory

All 36 employers ever considered for the board, and how each is tracked.
21 are scraped automatically every day; the other 15 are tracked manually
— either because the employer's own site says not to crawl it, or because
nobody's built a scraper for it yet. See `docs/ARCHITECTURE.md` §8.1–8.2
for the full verification history behind every row, and
`config/employers.json` for the per-employer `note` field with dates.

*Last reviewed: 2026-09-14. Every job board link opens in a new tab.*

## Automated (21)

Scraped daily via `refresh.js`. Platform is the ATS actually confirmed
live against the real site, not assumed from the original spec.

| Employer | Platform | Job board |
|---|---|---|
| LPL Financial | Workday | <a href="https://lplfinancial.wd1.myworkdayjobs.com/India_Ext" target="_blank" rel="noopener noreferrer">lplfinancial.wd1.myworkdayjobs.com/India_Ext</a> |
| Wells Fargo | Workday | <a href="https://wf.wd1.myworkdayjobs.com/WellsFargoJobs" target="_blank" rel="noopener noreferrer">wf.wd1.myworkdayjobs.com/WellsFargoJobs</a> |
| Invesco | Workday | <a href="https://invesco.wd1.myworkdayjobs.com/IVZ" target="_blank" rel="noopener noreferrer">invesco.wd1.myworkdayjobs.com/IVZ</a> |
| Broadridge | Workday | <a href="https://broadridge.wd5.myworkdayjobs.com/Careers" target="_blank" rel="noopener noreferrer">broadridge.wd5.myworkdayjobs.com/Careers</a> |
| Northern Trust | Workday | <a href="https://ntrs.wd1.myworkdayjobs.com/northerntrust" target="_blank" rel="noopener noreferrer">ntrs.wd1.myworkdayjobs.com/northerntrust</a> |
| State Street | Workday | <a href="https://statestreet.wd1.myworkdayjobs.com/Global" target="_blank" rel="noopener noreferrer">statestreet.wd1.myworkdayjobs.com/Global</a> |
| LSEG | Workday | <a href="https://lseg.wd3.myworkdayjobs.com/Careers" target="_blank" rel="noopener noreferrer">lseg.wd3.myworkdayjobs.com/Careers</a> |
| Bank of America | Workday | <a href="https://ghr.wd1.myworkdayjobs.com/lateral-us" target="_blank" rel="noopener noreferrer">ghr.wd1.myworkdayjobs.com/lateral-us</a> |
| Barclays | Workday | <a href="https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays" target="_blank" rel="noopener noreferrer">barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays</a> |
| AIG | Workday | <a href="https://aig.wd1.myworkdayjobs.com/aig" target="_blank" rel="noopener noreferrer">aig.wd1.myworkdayjobs.com/aig</a> |
| Visa | Workday | <a href="https://visa.wd5.myworkdayjobs.com/Visa" target="_blank" rel="noopener noreferrer">visa.wd5.myworkdayjobs.com/Visa</a> |
| CME Group | Workday | <a href="https://cmegroup.wd1.myworkdayjobs.com/cme_careers" target="_blank" rel="noopener noreferrer">cmegroup.wd1.myworkdayjobs.com/cme_careers</a> |
| DTCC | Oracle Fusion | <a href="https://ebxr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs" target="_blank" rel="noopener noreferrer">ebxr.fa.us2.oraclecloud.com/.../CX_1/jobs</a> |
| BNY | Oracle Fusion | <a href="https://eofe.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/BNY-Careers/jobs" target="_blank" rel="noopener noreferrer">eofe.fa.us2.oraclecloud.com/.../BNY-Careers/jobs</a> |
| Franklin Templeton | Phenom | <a href="https://careers.franklintempleton.com/us/en/search-results" target="_blank" rel="noopener noreferrer">careers.franklintempleton.com/us/en/search-results</a> |
| PwC AC | Phenom | <a href="https://jobs-ta.pwc.com/global/en/ac-india-job-search" target="_blank" rel="noopener noreferrer">jobs-ta.pwc.com/global/en/ac-india-job-search</a> |
| EY GDS | SuccessFactors | <a href="https://careers.ey.com" target="_blank" rel="noopener noreferrer">careers.ey.com</a> |
| Standard Chartered | SuccessFactors | <a href="https://jobs.standardchartered.com/" target="_blank" rel="noopener noreferrer">jobs.standardchartered.com</a> |
| Mastercard | Phenom | <a href="https://careers.mastercard.com" target="_blank" rel="noopener noreferrer">careers.mastercard.com</a> |
| Marsh & McLennan | Phenom | <a href="https://careers.marsh.com" target="_blank" rel="noopener noreferrer">careers.marsh.com</a> |
| Bridgewater Associates | Greenhouse | <a href="https://www.bridgewater.com/careers" target="_blank" rel="noopener noreferrer">bridgewater.com/careers</a> |

## Manual — policy stop (6)

The employer's own site says not to crawl it: robots.txt disallowing
everything, or a bot-wall. This won't change with more engineering effort
— per `docs/ARCHITECTURE.md` §12, working around it would be evasion, not
scraping. Check these yourself if they matter to you.

| Employer | Why manual | Job board |
|---|---|---|
| Citigroup | robots.txt: `Disallow: /search-jobs/` | <a href="https://jobs.citi.com/search-jobs" target="_blank" rel="noopener noreferrer">jobs.citi.com/search-jobs</a> |
| JPMorgan Chase | 403 authentication wall | <a href="https://www.jpmorganchase.com/careers" target="_blank" rel="noopener noreferrer">jpmorganchase.com/careers</a> |
| Charles Schwab | robots.txt: `Disallow: /` for every user-agent | <a href="https://schwabjobs.com" target="_blank" rel="noopener noreferrer">schwabjobs.com</a> |
| UBS | 403, confirmed bot-protected | <a href="https://jobs.ubs.com" target="_blank" rel="noopener noreferrer">jobs.ubs.com</a> |
| BNP Paribas | 403, confirmed bot-protected | <a href="https://group.bnpparibas/en/careers" target="_blank" rel="noopener noreferrer">group.bnpparibas/en/careers</a> |
| Blackstone | Cloudflare challenge, confirmed via headless browser | <a href="https://www.blackstone.com/careers" target="_blank" rel="noopener noreferrer">blackstone.com/careers</a> |

## Manual — backlog (9)

No policy blocker — just not automated yet. Either a genuinely
proprietary platform (would need dedicated CSS-selector scraping, not
the sitemap + structured-data convention `CustomScraper` relies on) or
the real ATS hasn't been identified.

| Employer | Status | Job board |
|---|---|---|
| Deloitte USI | Avature confirmed; no job-listing sitemap exists at all | <a href="https://usijobs.deloitte.com/en_US/careersUSI" target="_blank" rel="noopener noreferrer">usijobs.deloitte.com/en_US/careersUSI</a> |
| Vanguard | Real content, no known ATS vendor — likely proprietary | <a href="https://www.vanguard.in/" target="_blank" rel="noopener noreferrer">vanguard.in</a> |
| Goldman Sachs | Real content, no known ATS vendor — likely proprietary | <a href="https://higher.gs.com/roles" target="_blank" rel="noopener noreferrer">higher.gs.com/roles</a> |
| Morgan Stanley | Real content, no known ATS vendor — likely proprietary | <a href="https://www.morganstanley.com/careers/students-graduates/experienced-professionals" target="_blank" rel="noopener noreferrer">morganstanley.com/careers</a> |
| Deutsche Bank | Real content, no known ATS vendor — likely proprietary | <a href="https://careers.db.com/search-results" target="_blank" rel="noopener noreferrer">careers.db.com/search-results</a> |
| Citadel | Real content, no known ATS vendor — likely proprietary | <a href="https://www.citadel.com/careers/open-opportunities/" target="_blank" rel="noopener noreferrer">citadel.com/careers/open-opportunities</a> |
| KPMG | Marketing site only; real ATS URL not found | <a href="https://www.kpmguscareers.com/" target="_blank" rel="noopener noreferrer">kpmguscareers.com</a> |
| Zurich Insurance | Real URL not found; India ops may sit under a JV (Zurich Kotak) | <a href="https://www.zurich.com/careers" target="_blank" rel="noopener noreferrer">zurich.com/careers</a> |
| ICE | Real platform not identified (two false-positive vendor matches so far) | <a href="https://careers.ice.com" target="_blank" rel="noopener noreferrer">careers.ice.com</a> |

## Interactive version

A filterable/searchable version of this same list (also opens every link
in a new tab) is published at:
<https://claude.ai/code/artifact/feda9848-2b8a-4d2a-b9dd-d5f2fb08ab94>
