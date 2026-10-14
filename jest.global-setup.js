'use strict';

// Jest globalSetup — two jobs, both of which must happen BEFORE any suite runs:
// arm the V8 Sparkplug segfault guard (below), and heal a stale native
// SQLCipher binding.
//
// The real-binding suites (db-backup, graph-integrity, memories-commands, the
// migration / content-hash / run-sql-handler suites) load the actual
// better-sqlite3 native addon rather than the mock. After a Node.js upgrade that
// addon is compiled against the old ABI and throws NODE_MODULE_VERSION on load,
// turning every one of those suites red until someone rebuilds by hand. This
// mirrors the CLI's `ensureDatabaseNativeModule()` heal so `npm run test:unit`
// self-corrects instead.
//
// Two copies can back those suites (see the `loadDriver()` fallback chain in
// __tests__/unit/packages/quilltap/*.js): the per-package
// better-sqlite3-multiple-ciphers install used locally, and the root
// better-sqlite3 alias used in CI. We heal whichever exists. Detection reuses
// the same binary-symbol scan the CLI uses — no dlopen, no error-string matching.

const fs = require('fs');
const path = require('path');
const { readCompiledAbi, rebuildNativePackage } = require('./packages/quilltap/lib/native-modules');

const ROOT = __dirname;

// Each candidate copy is addressed by its DIRECTORY, not by an npm package name.
// This used to shell out to `npm rebuild <name>` and both spellings failed:
// `better-sqlite3` (the root alias) is refused with EALLOWSCRIPTS because it is
// not a key in the root package.json `allowScripts` map, and
// `better-sqlite3-multiple-ciphers` at the root reports success while rebuilding
// a phantom directory. `rebuildNativePackage` runs the package's own
// `prebuild-install || node-gyp rebuild` chain in place instead, and verifies
// the binding's ABI actually moved before calling it healed.
const COPIES = [
  {
    label: 'better-sqlite3 (root alias)',
    pkgDir: path.join(ROOT, 'node_modules', 'better-sqlite3'),
  },
  {
    label: 'better-sqlite3-multiple-ciphers (packages/quilltap)',
    pkgDir: path.join(ROOT, 'packages', 'quilltap', 'node_modules', 'better-sqlite3-multiple-ciphers'),
  },
];

function healCopy(copy) {
  if (!fs.existsSync(copy.pkgDir)) return; // not installed here — nothing to heal
  const bindingPath = path.join(copy.pkgDir, 'build', 'Release', 'better_sqlite3.node');
  const running = process.versions.modules;
  const exists = fs.existsSync(bindingPath);
  const compiledAbi = exists ? readCompiledAbi(bindingPath) : null;
  // Rebuild when the binary is missing, or its compiled-for ABI differs from the
  // running one. A readable-and-matching ABI (or an unreadable symbol on an
  // existing file) is left alone — the suite's own load surfaces anything else.
  const needsRebuild = !exists || (compiledAbi !== null && compiledAbi !== running);
  if (!needsRebuild) return;

  console.log(
    `\n  [jest] Native ABI mismatch for ${copy.label} ` +
      `(built ${compiledAbi ?? 'missing'}, running ${running}). Rebuilding for Node ${process.version}...`,
  );
  const result = rebuildNativePackage(copy.pkgDir, bindingPath);
  if (result.ok) {
    console.log(`  [jest] Rebuilt ${copy.label} via ${result.reason}.\n`);
  } else {
    console.error(`  [jest] Failed to rebuild ${copy.label} — ${result.reason}`);
    console.error(`  [jest] Try: (cd ${copy.pkgDir} && ./node_modules/.bin/prebuild-install)\n`);
  }
}

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
  for (const copy of COPIES) healCopy(copy);
};
