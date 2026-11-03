// Settings: every value that changes how the board runs. Each property
// has a default here; config/settings.json (committed) overrides it.
// .env holds only values that must not be in git (secrets, private host
// names): see .env.example. Reference: docs/SETUP.md §3.
//
// A missing property takes its default. A property with a wrong type or
// out of range, or an unknown property, gives a warning and the default,
// so a typing error never stops the server or a refresh.
import fs from 'fs';

const int = (value, min, max) => ({ value, check: (v) => Number.isInteger(v) && v >= min && v <= max, rule: `an integer from ${min} to ${max}` });
const str = (value) => ({ value, check: (v) => typeof v === 'string' && v.trim() !== '', rule: 'a text value' });
const bool = (value) => ({ value, check: (v) => typeof v === 'boolean', rule: 'true or false' });
const oneOf = (value, options) => ({ value, check: (v) => options.includes(v), rule: `one of ${options.join(', ')}` });

const SPEC = {
  server: {
    port: int(4000, 1, 65535),
    // 127.0.0.1: only this computer can open the board. 0.0.0.0: other
    // devices on the network too (docs/SETUP.md §7).
    host: str('127.0.0.1'),
    // Minutes between the server log lines while a refresh runs.
    progress_log_minutes: int(1, 1, 60),
  },
  schedule: {
    // The first default of the daily refresh; the board can change it
    // (data/schedule.json).
    refresh_cron: str('0 6 * * *'),
    timezone: str('Asia/Kolkata'),
    // A missed refresh (computer asleep) starts at the next check.
    catch_up_check_minutes: int(5, 1, 60),
    // A failed refresh is tried again once after this time.
    retry_after_minutes: int(10, 1, 240),
  },
  refresh: {
    // Employers scraped at the same time; each has its own host.
    scrape_concurrency: int(6, 1, 16),
    // After this time an employer counts as failed.
    employer_time_limit_minutes: int(20, 1, 120),
    // data/roles.json is written at most this often during a refresh.
    publish_interval_seconds: int(30, 5, 600),
    // --resume continues an unfinished run only if it is younger.
    checkpoint_max_age_hours: int(12, 1, 72),
    // Without a network (after a wake or a Wi-Fi change), the refresh
    // checks every network_check_seconds and waits up to
    // network_wait_minutes, then pauses (lib/network.js).
    network_wait_minutes: int(15, 1, 120),
    network_check_seconds: int(30, 5, 300),
    // A run where more than this share of employers failed is not
    // complete: the retry continues with the failed employers.
    max_failed_percent: int(50, 1, 100),
  },
  scraping: {
    user_agent: str('india-gcc-board-bot/1.0 (+https://github.com/vikram-git-vault/india-gcc-board)'),
    request_timeout_seconds: int(30, 5, 120),
    // For an employer with no crawl_delay_seconds in config/employers.json.
    default_crawl_delay_seconds: int(5, 1, 60),
    // The network check opens a connection to this host on port 443.
    network_check_host: str('github.com'),
  },
  descriptions: {
    // A scraped description this long is the full text: no detail request.
    min_full_chars: int(1000, 100, 20000),
    max_chars: int(50000, 1000, 500000),
    refetch_ok_days: int(14, 1, 365),
    retry_error_hours: int(20, 1, 720),
    retry_skipped_days: int(7, 1, 365),
  },
  scoring: {
    // Score new roles with Claude Code after each refresh.
    auto_score: bool(true),
    max_roles_per_run: int(50, 1, 1000),
    batch_size: int(10, 1, 50),
    claude_timeout_minutes: int(15, 1, 120),
    // A role that import rejects this many times is not sent again
    // until its description changes.
    max_attempts: int(2, 1, 10),
    keep_score_files: int(10, 1, 1000),
  },
  tailoring: {
    // After scoring, send roles to career-ops for a tailored Word CV and
    // cover letter (tailor.js, docs/ARCHITECTURE.md §16).
    auto_tailor: bool(true),
    // The career-ops checkout. "~" is the home folder.
    career_ops_dir: str('~/Projects/career-ops'),
    // The Word files go to <output_dir>/<Company>/<YYYY-MM-DD>_<Role>/.
    output_dir: str('~/Library/CloudStorage/OneDrive-Personal/Desktop/Resume_Tailored'),
    // Only roles whose better RM score (PO or EM resume) is at least this.
    min_fit_score: int(75, 0, 100),
    max_roles_per_run: int(40, 1, 500),
    // One role takes about 3 minutes; a worker is stopped after this time.
    worker_timeout_minutes: int(20, 5, 120),
    model: str('claude-sonnet-5-5'),
    // A role that fails this many times is not sent again until its
    // description changes.
    max_attempts: int(2, 1, 10),
  },
  discovery: {
    delay_seconds: int(5, 1, 60),
  },
  logging: {
    level: oneOf('info', ['error', 'warn', 'info', 'debug']),
  },
  database: {
    path: str('./data/jobs.db'),
  },
};

export const SETTINGS_PATH = new URL('../config/settings.json', import.meta.url);

// Every default, in the shape of config/settings.json.
export function defaults() {
  return Object.fromEntries(Object.entries(SPEC).map(([section, props]) => [
    section, Object.fromEntries(Object.entries(props).map(([key, p]) => [key, p.value])),
  ]));
}

// The defaults with the valid overrides applied, and a warning for each
// value that was not used.
export function resolveSettings(overrides) {
  const result = defaults();
  const warnings = [];
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    if (overrides !== undefined) warnings.push('the settings file is not a JSON object; all defaults used');
    return { settings: result, warnings };
  }
  for (const [section, values] of Object.entries(overrides)) {
    if (!SPEC[section]) { warnings.push(`unknown section "${section}"`); continue; }
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      warnings.push(`"${section}" is not an object; its defaults used`);
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      const spec = SPEC[section][key];
      if (!spec) { warnings.push(`unknown property "${section}.${key}"`); continue; }
      if (spec.check(value)) result[section][key] = value;
      else warnings.push(`"${section}.${key}" must be ${spec.rule}; default ${JSON.stringify(spec.value)} used`);
    }
  }
  return { settings: result, warnings };
}

export function loadSettings(file = SETTINGS_PATH) {
  let overrides;
  try {
    overrides = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return resolveSettings(undefined);
    return { settings: defaults(), warnings: [`cannot read config/settings.json (${err.message}); all defaults used`] };
  }
  return resolveSettings(overrides);
}

// Read once for each process. lib/logger.js imports this module, so the
// warnings go to stderr here, not to the logger.
const loaded = loadSettings();
loaded.warnings.forEach((w) => process.stderr.write(`[settings] ${w}\n`));

export const settings = loaded.settings;
