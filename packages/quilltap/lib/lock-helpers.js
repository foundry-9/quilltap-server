'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;
const VM_ENVIRONMENTS = new Set(['docker', 'lima', 'wsl2']);

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function verifyPidIsNode(pid) {
  try {
    if (process.platform === 'linux') {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const cmd = cmdline.split('\0')[0] || '';
        return /node|electron|quilltap|next-server/i.test(cmd);
      } catch {
        return true;
      }
    }
    if (process.platform === 'darwin') {
      const output = execSync(`ps -p ${pid} -o comm=`, {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return /node|electron|quilltap|next-server/i.test(output);
    }
    if (process.platform === 'win32') {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return /node|electron|quilltap|next-server/i.test(output);
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Inspect the instance lock at <dataDir>/quilltap.lock and decide whether it
 * is *actively* held by a live Quilltap process.
 *
 * Returns:
 *   { state: 'absent' }                                — no lock file
 *   { state: 'corrupt', lockPath }                     — file exists but unreadable
 *   { state: 'active', lock, lockPath, reason }        — held by a live owner
 *   { state: 'stale',  lock, lockPath, reason }        — owner is gone
 *   { state: 'suspect', lock, lockPath, reason }       — PID alive but not Quilltap-shaped
 */
function getLockStatus(dataDir) {
  const lockPath = path.join(dataDir, 'quilltap.lock');

  if (!fs.existsSync(lockPath)) {
    return { state: 'absent', lockPath };
  }

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return { state: 'corrupt', lockPath };
  }

  const hostname = os.hostname();
  const sameHost = lock.hostname === hostname;

  if (sameHost) {
    const alive = isPidAlive(lock.pid);
    if (!alive) {
      return { state: 'stale', lock, lockPath, reason: `PID ${lock.pid} is no longer running` };
    }
    const isNode = verifyPidIsNode(lock.pid);
    if (!isNode) {
      return {
        state: 'suspect',
        lock, lockPath,
        reason: `PID ${lock.pid} is alive but does not look like a Quilltap process`,
      };
    }
    return { state: 'active', lock, lockPath, reason: `held by PID ${lock.pid} on this host` };
  }

  // Different hostname — could be a VM/container sharing the data dir.
  const isVM = VM_ENVIRONMENTS.has(lock.environment);
  const heartbeatAgeMs = lock.lastHeartbeat
    ? Date.now() - new Date(lock.lastHeartbeat).getTime()
    : Infinity;
  if (isVM && heartbeatAgeMs < HEARTBEAT_FRESH_MS) {
    const ageStr = Math.round(heartbeatAgeMs / 1000) + 's';
    return {
      state: 'active',
      lock, lockPath,
      reason: `held by ${lock.environment} instance on ${lock.hostname} (heartbeat ${ageStr} ago)`,
    };
  }
  return {
    state: 'stale',
    lock, lockPath,
    reason: `held by ${lock.hostname} but no recent heartbeat`,
  };
}

module.exports = {
  getLockStatus,
  isPidAlive,
  verifyPidIsNode,
};
