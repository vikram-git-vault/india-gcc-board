# Employer directory

This document lists all 36 employers and the method that tracks each employer.

- The refresh scrapes 22 employers automatically each day.
- You must check 14 employers manually. The site of the employer does not permit crawlers, or a scraper does not exist yet.

For the verification history, refer to `docs/ARCHITECTURE.md`, sections 8.1 and 8.2.
For the dated finding for each employer, refer to the `note` field in `config/employers.json`.

*Last review: 2026-09-14. Each career site link opens in a new tab.*

## Automated (22)

`refresh.js` scrapes these employers each day.
The platform column gives the ATS that a test on the live site confirmed. It is not the ATS in the source specification.

| Employer | Platform | Career site |
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
| Deloitte USI | Avature | <a href="https://usijobs.deloitte.com/en_US/careersUSI" target="_blank" rel="noopener noreferrer">usijobs.deloitte.com/en_US/careersUSI</a> |

## Manual: policy stop (6)

The site of the employer does not permit crawlers: robots.txt disallows the paths, or a bot wall blocks access.
More engineering does not change this. Do not try to go around the block (refer to `docs/ARCHITECTURE.md`, section 14).
Check these career sites yourself.

| Employer | Reason | Career site |
|---|---|---|
| Citigroup | robots.txt: `Disallow: /search-jobs/` | <a href="https://jobs.citi.com/search-jobs" target="_blank" rel="noopener noreferrer">jobs.citi.com/search-jobs</a> |
| JPMorgan Chase | 403 login wall | <a href="https://www.jpmorganchase.com/careers" target="_blank" rel="noopener noreferrer">jpmorganchase.com/careers</a> |
| Charles Schwab | robots.txt: `Disallow: /` for all user agents | <a href="https://schwabjobs.com" target="_blank" rel="noopener noreferrer">schwabjobs.com</a> |
| UBS | 403, bot protection | <a href="https://jobs.ubs.com" target="_blank" rel="noopener noreferrer">jobs.ubs.com</a> |
| BNP Paribas | 403, bot protection | <a href="https://group.bnpparibas/en/careers" target="_blank" rel="noopener noreferrer">group.bnpparibas/en/careers</a> |
| Blackstone | Cloudflare challenge page, also in a headless browser | <a href="https://www.blackstone.com/careers" target="_blank" rel="noopener noreferrer">blackstone.com/careers</a> |

## Manual: backlog (8)

No policy blocks these employers. The refresh does not scrape them yet, for one of these reasons:

- The site uses a proprietary platform. It needs a scraper with CSS selectors. `CustomScraper` uses sitemaps and structured data, and these sites do not have them.
- The ATS of the site is not known.

| Employer | Status | Career site |
|---|---|---|
| Vanguard | Content is available. No known ATS. Probably a proprietary system. | <a href="https://www.vanguard.in/" target="_blank" rel="noopener noreferrer">vanguard.in</a> |
| Goldman Sachs | Content is available. No known ATS. Probably a proprietary system. | <a href="https://higher.gs.com/roles" target="_blank" rel="noopener noreferrer">higher.gs.com/roles</a> |
| Morgan Stanley | Content is available. No known ATS. Probably a proprietary system. | <a href="https://www.morganstanley.com/careers/students-graduates/experienced-professionals" target="_blank" rel="noopener noreferrer">morganstanley.com/careers</a> |
| Deutsche Bank | Content is available. No known ATS. Probably a proprietary system. | <a href="https://careers.db.com/search-results" target="_blank" rel="noopener noreferrer">careers.db.com/search-results</a> |
| Citadel | Content is available. No known ATS. Probably a proprietary system. | <a href="https://www.citadel.com/careers/open-opportunities/" target="_blank" rel="noopener noreferrer">citadel.com/careers/open-opportunities</a> |
| KPMG | Marketing site only. The ATS URL is not known. | <a href="https://www.kpmguscareers.com/" target="_blank" rel="noopener noreferrer">kpmguscareers.com</a> |
| Zurich Insurance | The URL is not known. The India operations can be in a joint venture (Zurich Kotak). | <a href="https://www.zurich.com/careers" target="_blank" rel="noopener noreferrer">zurich.com/careers</a> |
| ICE | The platform is not known. Two vendor matches were false. | <a href="https://careers.ice.com" target="_blank" rel="noopener noreferrer">careers.ice.com</a> |

## Interactive version

A version of this list with search and filters is available at this link. Each link in it also opens in a new tab:
<https://claude.ai/code/artifact/feda9848-2b8a-4d2a-b9dd-d5f2fb08ab94>
