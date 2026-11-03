'use strict';

// Jest globalSetup — arms the V8 Sparkplug segfault guard (below) before any
// suite runs.
//
// The real-binding suites (db-backup, graph-integrity, memories-commands, the
// migration / content-hash / run-sql-handler suites) load the actual SQLCipher
// driver rather than the mock. It is a Node-API addon whose prebuilt binary
// ships inside the npm package, so a Node upgrade no longer needs any healing
// here.

// --- V8 Sparkplug segfault guard (nodejs/node#62393) ---
//
// V8 13.6 (Node 24) has a GC race: a stack-guard interrupt fired inside
// Sparkplug's Builtins_BaselineOutOfLinePrologue can start a mark-compact
// whose ClearStaleLeftTrimmedPointerVisitor dereferences a junk frame slot —
// SIGSEGV at address 0xe. Under jest that kills a worker mid-run and fails an
// arbitrary innocent suite ("A jest worker process ... was terminated by
// another process: signal=SIGSEGV") roughly 1 run in 5 on this codebase. It is
// NOT the native SQLCipher binding: crash reports show workers dying with no
// better_sqlite3.node loaded at all. Upstream still reproduces it on Node 26,
// so a Node upgrade is not the fix; `--no-sparkplug` is the workaround the
// nodejs/node#62393 thread converged on (0 crashes across every reporter's
// matrix, no measurable wall-time cost).
//
// jest-worker forks each worker with the parent's `process.execArgv`, which is
// a plain mutable array it reads at fork time — and globalSetup runs in the
// main jest process before any worker forks. Appending the flag here therefore
// disables the baseline compiler in every worker no matter how jest was
// launched (`npx jest`, `--watch`, a single-file `-u` run...). The npm test
// scripts additionally start jest itself under `node --no-sparkplug` so the
// main process and in-band runs are covered too; this push is the safety net
// for ad-hoc invocations that skip the scripts. Remove once the supported Node
// lines ship the V8 fix (verify against the issue above first).
function armSparkplugGuard() {
  if (!process.execArgv.includes('--no-sparkplug')) {
    process.execArgv.push('--no-sparkplug');
  }
}

module.exports = async function globalSetup() {
  armSparkplugGuard();
};
