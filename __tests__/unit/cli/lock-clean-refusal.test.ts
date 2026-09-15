/**
 * @jest-environment node
 *
 * What `quilltap db --lock-clean` *says* when it refuses.
 *
 * The refusals were covered by whether they refused; nothing read the
 * sentences, and one of them was false for two releases (bug 144): the
 * heartbeat arm is reached only when the PID check has already come back dead,
 * yet it announced "its holder is alive" and told the operator to stop a
 * process that was gone. A wording defect is invisible to any assertion about
 * exit codes, so this drives the real binary and reads the output.
 *
 * Guards:
 *   - packages/quilltap/bin/quilltap.js (the --lock-clean arms)
 *   - docs/developer/bugs/fixed/bug-144-lock-clean-claims-dead-holder-is-alive.md
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI = path.join(process.cwd(), 'packages', 'quilltap', 'bin', 'quilltap.js');

/** A PID that cannot be alive, so the freshness arm is the one under test. */
const DEAD_PID = 999999;

let dataDir: string;

interface LockFields {
  pid?: number;
  heartbeatAgoMs?: number;
}

function writeLock({ pid = DEAD_PID, heartbeatAgoMs = 82_000 }: LockFields = {}) {
  fs.writeFileSync(
    path.join(dataDir, 'data', 'quilltap.lock'),
    JSON.stringify({
      pid,
      hostname: os.hostname(),
      environment: 'local',
      processTitle: 'quilltap-web',
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      lastHeartbeat: new Date(Date.now() - heartbeatAgoMs).toISOString(),
      history: [],
    })
  );
}

/** Run the real CLI and return what the operator would see, exit code included. */
function lockClean(): { output: string; status: number } {
  try {
    const output = execFileSync(process.execPath, [CLI, '--data-dir', dataDir, 'db', '--lock-clean'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { output, status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { output: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? -1 };
  }
}

const lockExists = () => fs.existsSync(path.join(dataDir, 'data', 'quilltap.lock'));

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-lock-clean-'));
  fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('quilltap db --lock-clean', () => {
  describe('a fresh heartbeat over a dead PID', () => {
    it('refuses without claiming anything is alive', () => {
      writeLock();

      const { output, status } = lockClean();

      // The defect, stated as the assertion that would have caught it: this
      // arm runs only when `alive` is false, so it may not say otherwise.
      expect(output).not.toMatch(/is alive/i);
      expect(output).not.toMatch(/stop the running instance/i);

      // …and the refusal itself is unchanged — deliberate conservatism from
      // bug 126, not something this fix relaxes.
      expect(status).toBe(1);
      expect(lockExists()).toBe(true);
    });

    it('says what it actually tested, and offers remedies that exist', () => {
      writeLock({ heartbeatAgoMs: 82_000 });

      const { output } = lockClean();

      expect(output).toContain('Lock heartbeat is still fresh (82s ago). Cannot clean.');
      // Waiting is the remedy the old text omitted entirely.
      expect(output).toMatch(/wait it out/i);
      expect(output).toMatch(/--lock-override/);
    });

    it('states the window the check really uses, not a hardcoded guess', () => {
      writeLock();

      const { output } = lockClean();

      // HEARTBEAT_FRESH_MS is 5 * 60 * 1000; the sentence is derived from it,
      // so changing the constant without the copy cannot go unnoticed.
      expect(output).toContain('5 minutes stale');
    });
  });

  it('still cleans a lock whose heartbeat has gone stale', () => {
    writeLock({ heartbeatAgoMs: 10 * 60_000 });

    const { output, status } = lockClean();

    expect(status).toBe(0);
    expect(output).toMatch(/no longer running/i);
    expect(lockExists()).toBe(false);
  });

  it('tells the operator to stop the instance when one is genuinely running', () => {
    // Our own process: alive, and a real node binary — the one arm where
    // "stop the running instance first" is true.
    writeLock({ pid: process.pid, heartbeatAgoMs: 10 * 60_000 });

    const { output, status } = lockClean();

    expect(status).toBe(1);
    expect(output).toContain('Lock is held by a live Quilltap process');
    expect(output).toMatch(/stop the running instance/i);
    expect(lockExists()).toBe(true);
  });

  it('says nothing is there to clean when no lock exists', () => {
    const { output, status } = lockClean();

    expect(status).toBe(0);
    expect(output).toContain('No lock file found');
  });
});
