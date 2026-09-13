import { WorkdayScraper } from './WorkdayScraper.js';

// Oracle/Taleo/Custom land in Phase 2 (docs/ARCHITECTURE.md §8). An
// employer whose ats_type isn't registered yet fails loudly here, which
// refresh.js's per-employer try/catch turns into a logged, skippable
// error rather than aborting the whole run.
const REGISTRY = {
  workday: WorkdayScraper,
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
