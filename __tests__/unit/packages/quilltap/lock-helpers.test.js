/**
 * @jest-environment node
 *
 * Unit tests for the `quilltap` CLI write-lock helpers (acquireWriteLock /
 * releaseWriteLock) added so `quilltap db --write` can open the database
 * read-write while honouring the instance lockfile the server uses.
 *
 * Hard contract under test:
 *   - absent lock  -> acquire creates `<dataDir>/quilltap.lock` (our pid, with
 *                     an `acquired` history entry); getLockStatus reports active.
 *   - release      -> removes the lockfile (idempotent; never throws).
 *   - active lock  -> acquire REFUSES (no override) and leaves the lock untouched.
 *   - stale lock   -> acquire CLAIMS it (dead pid), recording stale-detected /
 *                     stale-claimed, exactly like the server.
 *
 * Pure filesystem — no database, no encryption.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const {
  acquireWriteLock,
  releaseWriteLock,
  getLockStatus,
} = require(path.join(QUILLTAP_PKG, 'lib', 'lock-helpers'));

function writeLock(lockPath, overrides = {}) {
  const now = new Date().toISOString();
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      {
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: now,
        lastHeartbeat: now,
        environment: 'local',
        processTitle: 'node',
        processArgv0: process.argv[0],
        history: [],
        ...overrides,
      },
      null,
      2,
    ),
  );
}

describe('quilltap CLI write-lock helpers', () => {
  let dir;
  let lockPath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-lock-test-'));
    lockPath = path.join(dir, 'quilltap.lock');
  });

  afterEach(() => {
    // Always release so the module's heartbeat timer is cleared and module
    // state (ownedLockPath) resets between tests.
    try { releaseWriteLock(dir); } catch { /* ignore */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('acquires a fresh lock when none exists', () => {
    acquireWriteLock(dir);

    expect(fs.existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.pid).toBe(process.pid);
    expect(lock.hostname).toBe(os.hostname());
    expect(lock.history.some((h) => h.event === 'acquired')).toBe(true);
    expect(getLockStatus(dir).state).toBe('active');
  });

  it('release removes the lockfile and is idempotent', () => {
    acquireWriteLock(dir);
    expect(fs.existsSync(lockPath)).toBe(true);

    releaseWriteLock(dir);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(getLockStatus(dir).state).toBe('absent');

    // Second release must be a silent no-op, not a throw.
    expect(() => releaseWriteLock(dir)).not.toThrow();
  });

  it('REFUSES to acquire when a live process holds the lock (no override)', () => {
    // A lock owned by our own (live, node-shaped) pid reads as `active`.
    writeLock(lockPath, { processTitle: 'node' });
    expect(getLockStatus(dir).state).toBe('active');

    let caught;
    try {
      acquireWriteLock(dir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.locked).toBe(true);

    // The existing lock must be left exactly as it was — no override.
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.history).toEqual([]);
  });

  it('CLAIMS a stale lock (dead pid), recording stale-detected/stale-claimed', () => {
    const deadPid = 2147480000; // almost certainly not a live process
    writeLock(lockPath, {
      pid: deadPid,
      startedAt: '2020-01-01T00:00:00.000Z',
      lastHeartbeat: '2020-01-01T00:00:00.000Z',
      history: [{ event: 'acquired', pid: deadPid, hostname: os.hostname(), timestamp: '2020-01-01T00:00:00.000Z' }],
    });
    expect(getLockStatus(dir).state).toBe('stale');

    acquireWriteLock(dir);

    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.pid).toBe(process.pid);
    expect(lock.history.some((h) => h.event === 'stale-detected')).toBe(true);
    expect(lock.history.some((h) => h.event === 'stale-claimed')).toBe(true);
  });
});
