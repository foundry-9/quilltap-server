/**
 * Instance Lock Manager
 *
 * Prevents two Quilltap processes from opening the same SQLite database
 * simultaneously, which causes WAL corruption with SQLCipher.
 *
 * The lock file lives at <dataDir>/data/quilltap.lock and contains JSON
 * with the owning process's PID, hostname, environment type, and a
 * history log of all state changes (acquire, release, override, stale claims).
 *
 * Design decisions:
 * - Uses PID-in-file rather than OS-level flock() because network mounts and
 *   bind mounts do not reliably propagate POSIX file locks.
 * - Hostname is a human-readable label only. It is NOT proof of machine
 *   identity: macOS derives gethostname() dynamically when `scutil --get
 *   HostName` is unset, so one Mac reports "MacBook-Pro.local" and "Mac" at
 *   different times, flipping on Wi-Fi reconnect, sleep/wake, VPN and DHCP
 *   renewal. Ownership is decided by the snapshot taken when we wrote the
 *   lock (PID + startedAt); liveness of a foreign lock is decided by
 *   heartbeat freshness. See bug 126.
 * - All operations are synchronous because better-sqlite3's Database
 *   constructor is synchronous.
 * - Module state uses globalThis for Next.js HMR safety.
 *
 * @module lib/database/backends/sqlite/instance-lock
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'database:instance-lock' });

// ============================================================================
// Types
// ============================================================================

export type EnvironmentType = 'local' | 'electron' | 'docker';

export type LockEvent =
  | 'acquired'
  | 'released'
  | 'stale-detected'
  | 'stale-claimed'
  | 'override'
  | 'override-rejected';

export interface LockHistoryEntry {
  event: LockEvent;
  pid: number;
  hostname: string;
  timestamp: string;
  detail?: string;
}

export interface LockFileContent {
  pid: number;
  hostname: string;
  startedAt: string;
  lastHeartbeat: string;
  environment: EnvironmentType;
  processTitle: string;
  processArgv0: string;
  history: LockHistoryEntry[];
}

// ============================================================================
// Custom Error
// ============================================================================

export class InstanceLockError extends Error {
  constructor(
    message: string,
    public readonly lockInfo: LockFileContent,
    public readonly lockPath: string
  ) {
    super(message);
    this.name = 'InstanceLockError';
  }
}

// ============================================================================
// HMR-Safe Global State
// ============================================================================

declare global {
  var __quilltapInstanceLockPath: string | undefined;
  var __quilltapInstanceHeartbeatInterval: ReturnType<typeof setInterval> | undefined;
  var __quilltapInstanceLockOwner: LockOwnership | undefined;
  var __quilltapInstanceLockShutdownHandler: (() => void) | undefined;
}

function getActiveLockPath(): string | null {
  return globalThis.__quilltapInstanceLockPath ?? null;
}

function setActiveLockPath(p: string | null): void {
  globalThis.__quilltapInstanceLockPath = p ?? undefined;
}

/**
 * Identity of the lock record this process wrote, captured at write time.
 *
 * The heartbeat compares the lock file against this snapshot rather than
 * against freshly-read process/OS values, so an OS-level hostname change
 * cannot make a process mistake its own lock for someone else's.
 */
export interface LockOwnership {
  pid: number;
  hostname: string;
  startedAt: string;
}

function getLockOwner(): LockOwnership | null {
  return globalThis.__quilltapInstanceLockOwner ?? null;
}

/** Record that `content` is the lock record we just wrote. */
function rememberLockOwner(content: LockFileContent): void {
  globalThis.__quilltapInstanceLockOwner = {
    pid: content.pid,
    hostname: content.hostname,
    startedAt: content.startedAt,
  };
}

function forgetLockOwner(): void {
  globalThis.__quilltapInstanceLockOwner = undefined;
}

/**
 * Is the on-disk lock still the record this process wrote?
 *
 * Compares PID and the acquisition timestamp, both of which any process
 * taking the lock overwrites with its own values. Deliberately does NOT
 * compare hostname: `os.hostname()` is not stable over a process's lifetime
 * (see the module header), and a hostname change is not evidence of takeover.
 */
function isStillOurLock(content: LockFileContent): boolean {
  const owner = getLockOwner();
  if (!owner) {
    // No snapshot (lock adopted across an HMR boundary) — PID is all we have.
    return content.pid === process.pid;
  }
  return content.pid === owner.pid && content.startedAt === owner.startedAt;
}

/**
 * Register the callback that closes database connections when the lock is
 * lost. `client.ts` owns the correct shutdown order and already imports this
 * module, so it registers inward rather than being required outward — a
 * dynamic `require('./client')` here does not survive bundling into the
 * standalone server, which left the database un-checkpointed on exit.
 */
export function registerInstanceLockShutdownHandler(handler: () => void): void {
  globalThis.__quilltapInstanceLockShutdownHandler = handler;
}

// ============================================================================
// Lock Heartbeat
// ============================================================================

const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds

/**
 * How long a lock's heartbeat may go unrefreshed before the holder is
 * presumed dead. Generous relative to HEARTBEAT_INTERVAL_MS so a process
 * merely paused (laptop asleep, long synchronous migration) is not evicted.
 */
const HEARTBEAT_FRESH_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Close databases and exit after losing the lock.
 *
 * Delegates to the handler `client.ts` registered with us; without one we
 * still exit rather than keep writing to a database another process owns.
 */
function shutdownAfterLockLoss(): void {
  // Short delay so the log entry above reaches disk before we exit.
  setTimeout(() => {
    const handler = globalThis.__quilltapInstanceLockShutdownHandler;
    if (handler) {
      try {
        handler();
      } catch (closeErr) {
        moduleLogger.error('Error closing database during lock-loss shutdown', {
          error: closeErr instanceof Error ? closeErr.message : String(closeErr),
        });
      }
    } else {
      moduleLogger.error(
        'No shutdown handler registered — exiting without closing the database cleanly',
      );
    }
    process.exit(1);
  }, 500);
}

/**
 * Start a periodic heartbeat that updates the lock file's lastHeartbeat timestamp.
 * Uses .unref() so the interval does not prevent process exit.
 * HMR-safe: stops any existing heartbeat before starting a new one.
 */
export function startLockHeartbeat(lockPath: string): void {
  // Forked job-runner children share the parent's lock; they must not run
  // their own heartbeat or compete with the parent for ownership.
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  // Stop any existing heartbeat first (HMR safety)
  stopLockHeartbeat();

  const interval = setInterval(() => {
    try {
      const content = readLockFile(lockPath);
      if (!content) {
        moduleLogger.error('Instance lock file disappeared — another process may claim the database. Shutting down.', {
          lockPath,
        });
        stopLockHeartbeat();
        shutdownAfterLockLoss();
        return;
      }

      // Verify the lock is still the record we wrote. Hostname is logged for
      // diagnostics but is NOT part of the test — see the module header.
      if (!isStillOurLock(content)) {
        moduleLogger.error('Instance lock lost — another process has taken over the database. Shutting down.', {
          lockPath,
          lockPid: content.pid,
          lockHostname: content.hostname,
          lockStartedAt: content.startedAt,
          lockEnvironment: content.environment,
          ourPid: process.pid,
          ourHostname: os.hostname(),
          ourStartedAt: getLockOwner()?.startedAt,
        });
        stopLockHeartbeat();

        // Close the database and exit to prevent corruption.
        shutdownAfterLockLoss();
        return;
      }

      // Update the heartbeat timestamp. Also refresh the recorded hostname so
      // the file keeps a useful label even when the OS name has since changed.
      content.lastHeartbeat = new Date().toISOString();
      content.hostname = os.hostname();
      writeLockFile(lockPath, content);
      rememberLockOwner(content);

      moduleLogger.debug('Lock heartbeat updated', { lockPath, lastHeartbeat: content.lastHeartbeat });
    } catch (error) {
      moduleLogger.debug('Heartbeat: error updating lock file', {
        lockPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Don't prevent process exit (same pattern as checkpoint interval in protection.ts)
  interval.unref();

  globalThis.__quilltapInstanceHeartbeatInterval = interval;
  moduleLogger.debug('Lock heartbeat started', { lockPath, intervalMs: HEARTBEAT_INTERVAL_MS });
}

/**
 * Stop the periodic lock heartbeat.
 */
export function stopLockHeartbeat(): void {
  if (globalThis.__quilltapInstanceHeartbeatInterval) {
    clearInterval(globalThis.__quilltapInstanceHeartbeatInterval);
    globalThis.__quilltapInstanceHeartbeatInterval = undefined;
    moduleLogger.debug('Lock heartbeat stopped');
  }
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Detect the current runtime environment type for lock metadata.
 */
export function detectEnvironmentType(): EnvironmentType {
  // Electron detection
  if (process.versions && (process.versions as Record<string, string>).electron) {
    return 'electron';
  }
  if (process.env.ELECTRON_DEV) {
    return 'electron';
  }

  // Docker detection
  if (process.env.DOCKER_CONTAINER === 'true') {
    return 'docker';
  }
  try {
    if (fs.existsSync('/.dockerenv')) {
      return 'docker';
    }
  } catch {
    // Not Docker
  }

  return 'local';
}

// ============================================================================
// Lock File I/O
// ============================================================================

const MAX_HISTORY_ENTRIES = 50;

/**
 * Build a fresh lock content object for the current process.
 */
function buildLockContent(): LockFileContent {
  const now = new Date().toISOString();
  return {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now,
    lastHeartbeat: now,
    environment: detectEnvironmentType(),
    processTitle: process.title,
    processArgv0: process.argv[0] || '',
    history: [],
  };
}

/**
 * Append a history entry to lock content, trimming to MAX_HISTORY_ENTRIES.
 */
function addHistoryEntry(
  content: LockFileContent,
  event: LockEvent,
  detail?: string
): LockFileContent {
  const entry: LockHistoryEntry = {
    event,
    pid: process.pid,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };

  const history = [...content.history, entry];
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.splice(0, history.length - MAX_HISTORY_ENTRIES);
  }

  return { ...content, history };
}

/**
 * Read and parse the lock file. Returns null if missing or unparseable.
 */
export function readLockFile(lockPath: string): LockFileContent | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw);

    // Basic shape validation
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.hostname !== 'string' ||
      !Array.isArray(parsed.history)
    ) {
      moduleLogger.warn('Lock file has invalid structure, treating as corrupt', {
        lockPath,
      });
      return null;
    }

    return parsed as LockFileContent;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    moduleLogger.debug('Could not read lock file, treating as absent', {
      lockPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Write lock content atomically via tmp + rename.
 */
function writeLockFile(lockPath: string, content: LockFileContent): void {
  const tmpPath = lockPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, lockPath);
  } catch (error) {
    // Clean up tmp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failure
    }
    throw error;
  }
}

// ============================================================================
// PID Verification
// ============================================================================

/**
 * Check whether a PID is alive. Uses signal 0 (existence check).
 * Returns true if the process exists, false if dead.
 * Returns true on EPERM (process exists but we lack permission).
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      return true; // Process exists, we just can't signal it
    }
    return false; // ESRCH — no such process
  }
}

/**
 * Verify that a PID corresponds to a Quilltap/Node process, not an
 * unrelated process that reused the PID.
 *
 * Conservative: returns true (assume match) if verification is impossible.
 */
export function verifyPidMatchesProcess(pid: number, expectedArgv0: string): boolean {
  try {
    const platform = process.platform;

    if (platform === 'linux') {
      // Linux: read /proc/<pid>/cmdline
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        // cmdline uses null bytes as separators
        const cmd = cmdline.split('\0')[0] || '';
        return looksLikeNodeProcess(cmd, expectedArgv0);
      } catch {
        // /proc not available or permission denied — assume match
        return true;
      }
    }

    if (platform === 'darwin') {
      // macOS: use ps command
      try {
        const output = execSync(`ps -p ${pid} -o comm=`, {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return looksLikeNodeProcess(output, expectedArgv0);
      } catch {
        // ps failed — assume match
        return true;
      }
    }

    if (platform === 'win32') {
      // Windows: use tasklist
      try {
        const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return looksLikeNodeProcess(output, expectedArgv0);
      } catch {
        return true;
      }
    }

    // Unknown platform — assume match
    return true;
  } catch {
    return true;
  }
}

/**
 * Heuristic: does a process command string look like it could be a
 * Node.js / Electron / Quilltap process?
 */
function looksLikeNodeProcess(processCmd: string, expectedArgv0: string): boolean {
  const lower = processCmd.toLowerCase();
  const expectedLower = expectedArgv0.toLowerCase();

  // Direct match
  if (lower.includes(path.basename(expectedLower))) {
    return true;
  }

  // Known Node.js / Electron process names
  const knownNames = ['node', 'nodejs', 'electron', 'quilltap', 'next-server'];
  return knownNames.some(name => lower.includes(name));
}

// ============================================================================
// Lock Acquisition & Release
// ============================================================================

/**
 * Claim a stale lock: log the reason, preserve history, overwrite with
 * current process info, and start the heartbeat.
 */
function claimStaleLock(lockPath: string, existing: LockFileContent, reason: string): void {
  moduleLogger.warn('Stale instance lock detected, claiming', {
    lockPath,
    stalePid: existing.pid,
    staleHostname: existing.hostname,
    staleEnvironment: existing.environment,
    staleStartedAt: existing.startedAt,
    reason,
  });

  let content = { ...existing };
  content = addHistoryEntry(content, 'stale-detected', reason);

  content.pid = process.pid;
  content.hostname = os.hostname();
  content.startedAt = new Date().toISOString();
  content.lastHeartbeat = new Date().toISOString();
  content.environment = detectEnvironmentType();
  content.processTitle = process.title;
  content.processArgv0 = process.argv[0] || '';
  content = addHistoryEntry(content, 'stale-claimed', `Claimed by PID ${process.pid}`);

  writeLockFile(lockPath, content);
  rememberLockOwner(content);
  setActiveLockPath(lockPath);

  moduleLogger.info('Instance lock acquired after stale claim', {
    lockPath,
    pid: process.pid,
  });
  startLockHeartbeat(lockPath);
}

/**
 * Acquire the instance lock for the current process.
 *
 * @throws {InstanceLockError} if another live process holds the lock
 */
export function acquireInstanceLock(lockPath: string): void {
  // Forked job-runner children share the parent's lock; the parent holds it.
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  let existing = readLockFile(lockPath);

  if (!existing) {
    // No lock — try atomic creation with O_CREAT | O_EXCL to prevent race conditions.
    // Only the first process to call openSync succeeds; others get EEXIST.
    const content = buildLockContent();
    const withHistory = addHistoryEntry(content, 'acquired', 'Clean acquisition — no prior lock');
    const jsonData = JSON.stringify(withHistory, null, 2) + '\n';

    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
      );
      try {
        fs.writeSync(fd, jsonData, 0, 'utf8');
      } finally {
        fs.closeSync(fd);
      }

      rememberLockOwner(withHistory);
      setActiveLockPath(lockPath);
      moduleLogger.info('Instance lock acquired', {
        lockPath,
        pid: process.pid,
        environment: withHistory.environment,
      });
      startLockHeartbeat(lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Another process created the file between our read and our create attempt.
        // Re-read and fall through to stale-check logic below.
        existing = readLockFile(lockPath);
        if (!existing) {
          // File was created but is now gone or unreadable — retry acquisition
          throw new Error(
            `Instance lock file at ${lockPath} was transiently created by another process ` +
            `but could not be read. Retry acquisition.`
          );
        }
      } else {
        throw error;
      }
    }
  }

  // Lock exists — check if it's stale
  const sameHost = existing.hostname === os.hostname();
  const samePid = existing.pid === process.pid;
  const pidAlive = sameHost && isPidAlive(existing.pid);

  // Re-entrant: same PID on same host (HMR or repeated init)
  if (sameHost && samePid) {
    const updated = addHistoryEntry(existing, 'acquired', 'Re-entrant acquisition (same PID)');
    updated.startedAt = new Date().toISOString();
    updated.environment = detectEnvironmentType();
    updated.processTitle = process.title;
    updated.processArgv0 = process.argv[0] || '';
    writeLockFile(lockPath, updated);
    rememberLockOwner(updated);
    setActiveLockPath(lockPath);

    moduleLogger.debug('Instance lock re-acquired (same PID)', {
      lockPath,
      pid: process.pid,
    });
    startLockHeartbeat(lockPath);
    return;
  }

  // Same host but PID is dead — definitively stale
  if (sameHost && !pidAlive) {
    claimStaleLock(lockPath, existing, `PID ${existing.pid} is no longer running`);
    return;
  }

  // Different hostname. This does NOT establish that the lock belongs to a
  // different machine: it is equally likely to be this same machine under a
  // changed OS hostname (see the module header), in which case a live sibling
  // process holds the lock and claiming it would corrupt the database — the
  // exact outcome this module exists to prevent.
  //
  // Since we cannot tell the two cases apart by name, and cannot check PID
  // liveness across a PID namespace, decide on the heartbeat alone:
  // - Recent heartbeat (< HEARTBEAT_FRESH_MS) → someone live holds it, refuse
  // - Stale or missing heartbeat → holder is gone, claim it
  if (!sameHost) {
    const heartbeatAgeMs = existing.lastHeartbeat
      ? Date.now() - new Date(existing.lastHeartbeat).getTime()
      : Infinity;

    if (heartbeatAgeMs < HEARTBEAT_FRESH_MS) {
      const envLabel = existing.environment === 'docker' ? 'Docker container'
        : existing.environment === 'electron' ? 'Electron app'
        : 'local server';

      throw new InstanceLockError(
        `Another Quilltap instance (${envLabel}, PID ${existing.pid} on ${existing.hostname}) ` +
        `is already using this database (last heartbeat ${Math.round(heartbeatAgeMs / 1000)}s ago). ` +
        `If no other instance is running, this machine's hostname may have changed ` +
        `since the lock was taken (now: ${os.hostname()}); wait ` +
        `${Math.ceil((HEARTBEAT_FRESH_MS - heartbeatAgeMs) / 1000)}s for the lock to go stale, ` +
        `or use the lock override to force access.`,
        existing,
        lockPath
      );
    }

    claimStaleLock(
      lockPath,
      existing,
      `Lock from ${existing.hostname} (${existing.environment}) has no recent heartbeat ` +
      `(last: ${existing.lastHeartbeat || 'never'}, age: ${Math.round(heartbeatAgeMs / 1000)}s)`
    );
    return;
  }

  // Lock is held by a live, different process on the same host
  const envLabel = existing.environment === 'electron' ? 'Electron app'
    : existing.environment === 'docker' ? 'Docker container'
    : 'local server';

  throw new InstanceLockError(
    `Another Quilltap instance (${envLabel}, PID ${existing.pid}) is already using this database. ` +
    `Started at ${existing.startedAt}. ` +
    `Kill the other process or use the lock override to force access.`,
    existing,
    lockPath
  );
}

/**
 * Release the instance lock if owned by the current process.
 * Never throws — safe to call in shutdown handlers.
 */
export function releaseInstanceLock(lockPath: string): void {
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  stopLockHeartbeat();
  try {
    const existing = readLockFile(lockPath);

    if (!existing) {
      moduleLogger.debug('No lock file to release', { lockPath });
      return;
    }

    if (!isStillOurLock(existing)) {
      moduleLogger.warn('Lock file not owned by this process, skipping release', {
        lockPath,
        lockPid: existing.pid,
        lockHostname: existing.hostname,
        lockStartedAt: existing.startedAt,
        ourPid: process.pid,
        ourHostname: os.hostname(),
        ourStartedAt: getLockOwner()?.startedAt,
      });
      return;
    }

    // Write final state with release event, then delete
    const updated = addHistoryEntry(existing, 'released', `Released by PID ${process.pid}`);
    writeLockFile(lockPath, updated);

    try {
      fs.unlinkSync(lockPath);
    } catch (unlinkError) {
      moduleLogger.debug('Could not delete lock file after release', {
        lockPath,
        error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError),
      });
    }

    forgetLockOwner();

    moduleLogger.info('Instance lock released', {
      lockPath,
      pid: process.pid,
    });
  } catch (error) {
    moduleLogger.warn('Error releasing instance lock', {
      lockPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Release the active instance lock (convenience for shutdown handlers).
 * Never throws.
 */
export function releaseActiveInstanceLock(): void {
  if (process.env.QUILLTAP_JOB_CHILD === '1') return;

  stopLockHeartbeat();
  const lockPath = getActiveLockPath();
  if (lockPath) {
    releaseInstanceLock(lockPath);
    setActiveLockPath(null);
  }
}

// ============================================================================
// Manual Override
// ============================================================================

/**
 * Forcibly override the instance lock.
 *
 * Verifies that the PID in the lock file (if alive) actually corresponds
 * to a Node/Quilltap process before allowing the override. This prevents
 * accidentally killing an unrelated process that reused the PID.
 *
 * @throws {Error} if the lock's PID is alive but doesn't match a Quilltap process
 */
export function overrideInstanceLock(lockPath: string): void {
  const existing = readLockFile(lockPath);

  if (!existing) {
    // No lock to override — just acquire normally
    acquireInstanceLock(lockPath);
    return;
  }

  const sameHost = existing.hostname === os.hostname();
  const pidAlive = sameHost && isPidAlive(existing.pid);

  if (pidAlive) {
    // Verify the PID actually belongs to a Quilltap-like process
    const matches = verifyPidMatchesProcess(existing.pid, existing.processArgv0);

    if (!matches) {
      const updated = addHistoryEntry(
        existing,
        'override-rejected',
        `PID ${existing.pid} is alive but does not match expected process — possible PID reuse`
      );
      writeLockFile(lockPath, updated);

      throw new Error(
        `Lock override rejected: PID ${existing.pid} is alive but does not appear to be a ` +
        `Quilltap/Node process. The PID may have been reused by an unrelated process. ` +
        `Verify manually before proceeding.`
      );
    }

    moduleLogger.warn('Overriding instance lock with live process', {
      lockPath,
      overriddenPid: existing.pid,
      overriddenEnvironment: existing.environment,
    });
  }

  // Preserve history, override with our info
  let content = { ...existing };
  content = addHistoryEntry(
    content,
    'override',
    `Manual override by PID ${process.pid}` +
    (pidAlive ? ` (overriding live PID ${existing.pid})` : ` (PID ${existing.pid} was dead)`)
  );

  content.pid = process.pid;
  content.hostname = os.hostname();
  content.startedAt = new Date().toISOString();
  content.environment = detectEnvironmentType();
  content.processTitle = process.title;
  content.processArgv0 = process.argv[0] || '';

  writeLockFile(lockPath, content);
  rememberLockOwner(content);
  setActiveLockPath(lockPath);

  moduleLogger.info('Instance lock overridden', {
    lockPath,
    pid: process.pid,
    previousPid: existing.pid,
  });

  // An overridden lock still needs a heartbeat: freshness is what tells other
  // machines the holder is alive, so a silent lock reads as abandoned.
  startLockHeartbeat(lockPath);
}

// ============================================================================
// Query
// ============================================================================

/**
 * Get the current lock file info without modifying it.
 * Returns null if no lock file exists.
 */
export function getInstanceLockInfo(lockPath: string): LockFileContent | null {
  return readLockFile(lockPath);
}
