import { WorkdayScraper } from './WorkdayScraper.js';
import { OracleScraper } from './OracleScraper.js';
import { CustomScraper } from './CustomScraper.js';
import { GreenhouseScraper } from './GreenhouseScraper.js';
import { AvatureScraper } from './AvatureScraper.js';
import { EightfoldScraper } from './EightfoldScraper.js';
import { PhenomScraper } from './PhenomScraper.js';
import { JibeScraper } from './JibeScraper.js';
import { AmazonJobsScraper } from './AmazonJobsScraper.js';

// An employer whose ats_type isn't registered yet fails loudly here,
// which refresh.js's per-employer try/catch turns into a logged,
// skippable error rather than aborting the whole run. There is no
// separate 'taleo' entry — no employer in this project was verified to
// run genuine legacy Oracle Taleo; DTCC/BNY turned out to be Oracle
// Fusion Recruiting Cloud (a different product), handled by
// OracleScraper (docs/ARCHITECTURE.md §4).
const REGISTRY = {
  workday: WorkdayScraper,
  oracle: OracleScraper,
  custom: CustomScraper,
  greenhouse: GreenhouseScraper,
  avature: AvatureScraper,
  eightfold: EightfoldScraper,
  phenom: PhenomScraper,
  jibe: JibeScraper,
  amazon: AmazonJobsScraper,
};

export class ScraperFactory {
  static create(employer) {
    const ScraperClass = REGISTRY[employer.ats_type];
    if (!ScraperClass) {
      throw new Error(`No scraper registered for ats_type "${employer.ats_type}" (employer: ${employer.id})`);
    }
    return new ScraperClass(employer);
  }
}
