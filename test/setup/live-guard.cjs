// Jest loads this file before each test file (package.json "jest.setupFiles").
// A test must never change the live board: data/roles.json, data/jobs.db,
// the logs, .cache, config, the career-ops folder or the CV folder. On
// 2026-11-13 a test wrote data/roles.json through the default path of
// publish() and the board showed only 5 test roles.
//
// The same rule for the network: a test never reaches a real site (a
// scraper test that forgets a nock reply, or a call to the Claude API).
// nock answers; every other request fails. localhost stays open.
//
// The rule: during a test, a write is allowed only inside the system
// temporary folder (os.tmpdir()). Any other write fails with an error that
// names the file. Child processes are not allowed: their writes are not
// visible here. The rule is under the code, so it also stops a write that a
// new module adds later.
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function realDir(dir) {
  try { return fs.realpathSync.native(dir); } catch { return path.resolve(dir); }
}
const ALLOWED = [...new Set([os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].map(realDir))];

// The real path of the file, or of its nearest folder that exists (a new file
// has no real path yet).
function resolved(file) {
  let p = path.resolve(String(file));
  const rest = [];
  while (!fs.existsSync(p) && path.dirname(p) !== p) {
    rest.unshift(path.basename(p));
    p = path.dirname(p);
  }
  return path.join(realDir(p), ...rest);
}

function allowed(file) {
  if (file === undefined || file === null || typeof file === 'number') return true; // a file descriptor
  const s = file instanceof URL ? file.pathname : String(file);
  if (s === '' || s === ':memory:') return true;
  const p = resolved(s);
  return ALLOWED.some((dir) => p === dir || p.startsWith(dir + path.sep));
}

function blocked(file, what) {
  const err = new Error(`live-guard: a test tried to ${what} ${path.resolve(String(file))}. `
    + 'Tests may write only inside os.tmpdir(). Give the code a temporary path '
    + '(for example useDatabasePath(), publish({ outputPath }) or saveCheckpoint(cp, file)).');
  err.code = 'ELIVEGUARD';
  return err;
}

const WRITE_FLAGS = /[wa+]/;
const isWriteFlag = (flags) => (typeof flags === 'number'
  ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND)) !== 0
  : WRITE_FLAGS.test(String(flags || 'r')));

// [function name, indexes of the path arguments, check the flags (open)]
const PATH_WRITES = [
  ['writeFile', [0]], ['appendFile', [0]], ['mkdir', [0]], ['rm', [0]], ['rmdir', [0]], ['unlink', [0]],
  ['rename', [0, 1]], ['copyFile', [1]], ['cp', [1]], ['symlink', [1]], ['link', [1]], ['truncate', [0]],
  ['chmod', [0]], ['chown', [0]], ['utimes', [0]], ['mkdtemp', [0]],
];

// mode: 'sync' throws, 'callback' calls the callback, 'promise' rejects.
function fail(err, mode, args) {
  if (mode === 'promise') return Promise.reject(err);
  if (mode === 'callback' && typeof args[args.length - 1] === 'function') {
    process.nextTick(args[args.length - 1], err);
    return undefined;
  }
  throw err;
}

function wrap(target, name, indexes, mode) {
  const fn = target[name];
  if (typeof fn !== 'function' || fn.__liveGuard) return;
  const guarded = function liveGuarded(...args) {
    for (const i of indexes) {
      if (!allowed(args[i])) return fail(blocked(args[i], name.replace(/Sync$/, '')), mode, args);
    }
    return fn.apply(this, args);
  };
  guarded.__liveGuard = true;
  target[name] = guarded;
}

function wrapOpen(target, name, flagIndex, mode) {
  const fn = target[name];
  if (typeof fn !== 'function' || fn.__liveGuard) return;
  const guarded = function liveGuardedOpen(file, ...args) {
    const opt = args[flagIndex];
    const flags = opt && typeof opt === 'object' ? opt.flags : opt;
    if (isWriteFlag(flags ?? (name === 'createWriteStream' ? 'w' : 'r')) && !allowed(file)) {
      return fail(blocked(file, 'open for writing'), mode, args);
    }
    return fn.call(this, file, ...args);
  };
  guarded.__liveGuard = true;
  target[name] = guarded;
}

for (const [name, indexes] of PATH_WRITES) {
  wrap(fs, name, indexes, 'callback');
  wrap(fs, `${name}Sync`, indexes, 'sync');
  wrap(fs.promises, name, indexes, 'promise');
}
wrapOpen(fs, 'open', 0, 'callback');
wrapOpen(fs, 'openSync', 0, 'sync');
wrapOpen(fs.promises, 'open', 0, 'promise');
wrapOpen(fs, 'createWriteStream', 0, 'sync');

// SQLite opens its file in native code, so the fs functions above do not see
// it. A read-only open of a live database is allowed (the status tools).
try {
  const sqlite3 = require('sqlite3');
  const Original = sqlite3.Database;
  if (!Original.__liveGuard) {
    const Guarded = function Database(file, mode, ...rest) {
      const readOnly = typeof mode === 'number' && (mode & sqlite3.OPEN_READWRITE) === 0 && (mode & sqlite3.OPEN_CREATE) === 0;
      if (!readOnly && !allowed(file)) throw blocked(file, 'open the SQLite database');
      return new Original(file, mode, ...rest);
    };
    Guarded.prototype = Original.prototype;
    Guarded.__liveGuard = true;
    sqlite3.Database = Guarded;
  }
} catch (err) {
  if (err.code === 'ELIVEGUARD') throw err;
}

for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const fn = childProcess[name];
  if (typeof fn !== 'function' || fn.__liveGuard) continue;
  const guarded = function liveGuardedChild(command) {
    const err = new Error(`live-guard: a test tried to start a child process (${String(command)}). `
      + 'Its writes cannot be checked. Test the function that builds the command instead.');
    err.code = 'ELIVEGUARD';
    throw err;
  };
  guarded.__liveGuard = true;
  childProcess[name] = guarded;
}

const nock = require('nock');
nock.disableNetConnect();
nock.enableNetConnect(/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/);

global.__LIVE_GUARD__ = { allowed };
