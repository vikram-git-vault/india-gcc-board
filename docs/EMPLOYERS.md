# Employer Directory

All 36 employers ever considered for the board, and how each is tracked.
21 are scraped automatically every day; the other 15 are tracked manually
— either because the employer's own site says not to crawl it, or because
nobody's built a scraper for it yet. See `docs/ARCHITECTURE.md` §8.1–8.2
for the full verification history behind every row, and
`config/employers.json` for the per-employer `note` field with dates.

*Last reviewed: 2026-09-14*

## Automated (21)

Scraped daily via `refresh.js`. Platform is the ATS actually confirmed
live against the real site, not assumed from the original spec.

| Employer | Platform | Job board |
|---|---|---|
| LPL Financial | Workday | <https://lplfinancial.wd1.myworkdayjobs.com/India_Ext> |
| Wells Fargo | Workday | <https://wf.wd1.myworkdayjobs.com/WellsFargoJobs> |
| Invesco | Workday | <https://invesco.wd1.myworkdayjobs.com/IVZ> |
| Broadridge | Workday | <https://broadridge.wd5.myworkdayjobs.com/Careers> |
| Northern Trust | Workday | <https://ntrs.wd1.myworkdayjobs.com/northerntrust> |
| State Street | Workday | <https://statestreet.wd1.myworkdayjobs.com/Global> |
| LSEG | Workday | <https://lseg.wd3.myworkdayjobs.com/Careers> |
| Bank of America | Workday | <https://ghr.wd1.myworkdayjobs.com/lateral-us> |
| Barclays | Workday | <https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays> |
| AIG | Workday | <https://aig.wd1.myworkdayjobs.com/aig> |
| Visa | Workday | <https://visa.wd5.myworkdayjobs.com/Visa> |
| CME Group | Workday | <https://cmegroup.wd1.myworkdayjobs.com/cme_careers> |
| DTCC | Oracle Fusion | <https://ebxr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs> |
| BNY | Oracle Fusion | <https://eofe.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/BNY-Careers/jobs> |
| Franklin Templeton | Phenom | <https://careers.franklintempleton.com/us/en/search-results> |
| PwC AC | Phenom | <https://jobs-ta.pwc.com/global/en/ac-india-job-search> |
| EY GDS | SuccessFactors | <https://careers.ey.com> |
| Standard Chartered | SuccessFactors | <https://jobs.standardchartered.com/> |
| Mastercard | Phenom | <https://careers.mastercard.com> |
| Marsh & McLennan | Phenom | <https://careers.marsh.com> |
| Bridgewater Associates | Greenhouse | <https://www.bridgewater.com/careers> |

## Manual — policy stop (6)

The employer's own site says not to crawl it: robots.txt disallowing
everything, or a bot-wall. This won't change with more engineering effort
— per `docs/ARCHITECTURE.md` §12, working around it would be evasion, not
scraping. Check these yourself if they matter to you.

| Employer | Why manual | Job board |
|---|---|---|
| Citigroup | robots.txt: `Disallow: /search-jobs/` | <https://jobs.citi.com/search-jobs> |
| JPMorgan Chase | 403 authentication wall | <https://www.jpmorganchase.com/careers> |
| Charles Schwab | robots.txt: `Disallow: /` for every user-agent | <https://schwabjobs.com> |
| UBS | 403, confirmed bot-protected | <https://jobs.ubs.com> |
| BNP Paribas | 403, confirmed bot-protected | <https://group.bnpparibas/en/careers> |
| Blackstone | Cloudflare challenge, confirmed via headless browser | <https://www.blackstone.com/careers> |

## Manual — backlog (9)

No policy blocker — just not automated yet. Either a genuinely
proprietary platform (would need dedicated CSS-selector scraping, not
the sitemap + structured-data convention `CustomScraper` relies on) or
the real ATS hasn't been identified.

| Employer | Status | Job board |
|---|---|---|
| Deloitte USI | Avature confirmed; no job-listing sitemap exists at all | <https://usijobs.deloitte.com/en_US/careersUSI> |
| Vanguard | Real content, no known ATS vendor — likely proprietary | <https://www.vanguard.in/> |
| Goldman Sachs | Real content, no known ATS vendor — likely proprietary | <https://higher.gs.com/roles> |
| Morgan Stanley | Real content, no known ATS vendor — likely proprietary | <https://www.morganstanley.com/careers/students-graduates/experienced-professionals> |
| Deutsche Bank | Real content, no known ATS vendor — likely proprietary | <https://careers.db.com/search-results> |
| Citadel | Real content, no known ATS vendor — likely proprietary | <https://www.citadel.com/careers/open-opportunities/> |
| KPMG | Marketing site only; real ATS URL not found | <https://www.kpmguscareers.com/> |
| Zurich Insurance | Real URL not found; India ops may sit under a JV (Zurich Kotak) | <https://www.zurich.com/careers> |
| ICE | Real platform not identified (two false-positive vendor matches so far) | <https://careers.ice.com> |

## Interactive version

A filterable/searchable version of this same list is published at:
<https://claude.ai/code/artifact/feda9848-2b8a-4d2a-b9dd-d5f2fb08ab94>
