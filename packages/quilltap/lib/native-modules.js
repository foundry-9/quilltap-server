'use strict';

// Shared helpers for keeping native modules compiled against the current Node
// ABI. Used by both the runtime CLI entry (bin/quilltap.js) and the package's
// `postinstall` hook, so a fresh install picks up the correct binaries up front
// and a later Node upgrade still self-heals on first run.

const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_DIR = path.resolve(__dirname, '..');

// Resolve a native module's directory, handling npm hoisting.
// Returns the directory containing package.json, or null if not found.
function resolveModuleDir(moduleName) {
  try {
    const pkgJson = require.resolve(moduleName + '/package.json', { paths: [PACKAGE_DIR] });
    return path.dirname(pkgJson);
  } catch {
    return null;
  }
}

// Locate the SQLCipher binding (better-sqlite3-multiple-ciphers, aliased as
// better-sqlite3). Returns the absolute path to better_sqlite3.node, or null.
function betterSqlite3BindingPath() {
  const modDir = resolveModuleDir('better-sqlite3-multiple-ciphers')
              || resolveModuleDir('better-sqlite3');
  if (!modDir) return null;
  return path.join(modDir, 'build', 'Release', 'better_sqlite3.node');
}

// Read the Node ABI (NODE_MODULE_VERSION) a node-gyp/NAN addon was compiled
// against, by scanning for its `node_register_module_v<ABI>` export — a few-KB
// byte read, no dlopen, no rebuild. Returns the ABI as a string, or null when
// the symbol is absent (e.g. an N-API build, which is ABI-stable) or unreadable.
function readCompiledAbi(bindingPath) {
  try {
    const buf = require('fs').readFileSync(bindingPath);
    const m = /node_register_module_v(\d+)/.exec(buf.toString('latin1'));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// True when the SQLCipher binding is missing or was built for a different Node
// ABI than the one we're running. Reads the compiled-for ABI straight from the
// binary; only falls back to an actual load probe if the symbol can't be read.
function betterSqlite3NeedsRebuild() {
  const bindingPath = betterSqlite3BindingPath();
  if (!bindingPath) return true; // unresolvable → needs (re)build
  if (!require('fs').existsSync(bindingPath)) return true;
  const compiledAbi = readCompiledAbi(bindingPath);
  if (compiledAbi) return compiledAbi !== process.versions.modules;
  // Symbol unreadable — fall back to the authoritative dlopen probe.
  try {
    require(bindingPath);
    return false;
  } catch (err) {
    return !!(err.message && err.message.includes('NODE_MODULE_VERSION'));
  }
}

// Locate an executable installed by a dependency, given the package directory
// that needs it. Checks the package's own `.bin` first, then the `.bin` beside
// it (the hoisted case, which is the usual one). Returns null when absent.
function findBinFor(pkgDir, tool) {
  const fs = require('fs');
  const names = process.platform === 'win32' ? [`${tool}.cmd`, `${tool}.exe`, tool] : [tool];
  const dirs = [
    path.join(pkgDir, 'node_modules', '.bin'),  // nested install
    path.join(pkgDir, '..', '.bin'),            // hoisted alongside the package
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Rebuild ONE native package in place, addressed by its directory.
//
// Deliberately does NOT go through `npm rebuild <name>`, which fails this job
// two different ways:
//
//   1. npm refuses install scripts for any package not listed in the root
//      package.json `allowScripts` map (keyed `name@version`). The root
//      SQLCipher copy is installed under the ALIAS `better-sqlite3`, which is
//      not a key there, so the rebuild dies with EALLOWSCRIPTS.
//   2. Asking for the real name (`better-sqlite3-multiple-ciphers`) at the root
//      instead resolves a phantom directory: npm reports "rebuilt dependencies
//      successfully" and the binding on disk is untouched. A success message is
//      worse than an error.
//
// Running the package's own build chain (`prebuild-install || node-gyp rebuild`,
// exactly what its `install` script does) in its own directory sidesteps both:
// no name resolution, no npm script policy. `prebuild-install` downloads the
// prebuilt binary for the running ABI and needs network; node-gyp compiles and
// needs a toolchain.
//
// Returns { ok, reason }. Never throws. Verifies the result rather than trusting
// the exit code — see (2): the whole failure mode here is a rebuild that claims
// to have worked.
function rebuildNativePackage(pkgDir, bindingPath) {
  const fs = require('fs');
  if (!fs.existsSync(pkgDir)) return { ok: false, reason: `no package at ${pkgDir}` };

  const before = fs.existsSync(bindingPath) ? readCompiledAbi(bindingPath) : null;
  const attempts = [];

  const prebuild = findBinFor(pkgDir, 'prebuild-install');
  if (prebuild) attempts.push({ label: 'prebuild-install', cmd: `"${prebuild}"` });

  const nodeGyp = findBinFor(pkgDir, 'node-gyp');
  if (nodeGyp) attempts.push({ label: 'node-gyp rebuild', cmd: `"${nodeGyp}" rebuild --release` });

  if (attempts.length === 0) {
    return { ok: false, reason: 'neither prebuild-install nor node-gyp is installed' };
  }

  const failures = [];
  for (const attempt of attempts) {
    try {
      execSync(attempt.cmd, { cwd: pkgDir, stdio: 'inherit' });
    } catch (err) {
      failures.push(`${attempt.label}: ${err.message.split('\n')[0]}`);
      continue;
    }
    // Trust nothing but the binary. A tool can exit 0 having done nothing.
    const after = fs.existsSync(bindingPath) ? readCompiledAbi(bindingPath) : null;
    if (after === process.versions.modules) return { ok: true, reason: attempt.label };
    failures.push(
      `${attempt.label}: exited 0 but the binding is still ${after ?? 'missing'} ` +
      `(wanted ${process.versions.modules}${before ? `, was ${before}` : ''})`,
    );
  }
  return { ok: false, reason: failures.join('; ') };
}

// Rebuild the named native modules against the current Node ABI. Prints a
// friendly notice rather than throwing; returns true on success, false on
// failure. Backfills node-pty's spawn-helper afterward.
function rebuildModules(moduleNames) {
  console.log(`  Rebuilding native modules for Node.js ${process.version}...`);
  try {
    execSync(`npm rebuild ${moduleNames.join(' ')}`, {
      cwd: PACKAGE_DIR,
      stdio: 'inherit',
    });
    console.log('  Done.');
    console.log('');
    reconcileNodePtySpawnHelper();
    return true;
  } catch (err) {
    console.error('');
    console.error(`  Warning: Failed to rebuild native modules: ${err.message}`);
    console.error('  Try running: npm rebuild --prefix ' + PACKAGE_DIR);
    console.error('');
    return false;
  }
}

// Fast pre-flight for the ONE ABI-fragile native module every DB path needs:
// better-sqlite3-multiple-ciphers (SQLCipher). sharp and node-pty are N-API and
// ABI-stable, so they can't hit this failure. Detects an ABI mismatch from the
// binary itself and rebuilds before anything tries to load it, so a Node upgrade
// self-heals instead of throwing. Cheap no-op when already healthy. Never throws.
function ensureDatabaseNativeModule() {
  try {
    if (!betterSqlite3NeedsRebuild()) return true;
  } catch {
    return true; // detection hiccup — let the real load be the source of truth
  }

  const bindingPath = betterSqlite3BindingPath();
  if (!bindingPath) {
    console.error('  Warning: could not locate the SQLCipher binding to rebuild.');
    return false;
  }
  // build/Release/better_sqlite3.node → the package directory above it.
  const pkgDir = path.resolve(path.dirname(bindingPath), '..', '..');

  console.log(`  Rebuilding the SQLCipher binding for Node.js ${process.version}...`);
  const result = rebuildNativePackage(pkgDir, bindingPath);
  if (result.ok) {
    console.log(`  Done (${result.reason}).`);
    console.log('');
    return true;
  }
  console.error('');
  console.error(`  Warning: failed to rebuild the SQLCipher binding — ${result.reason}`);
  console.error(`  Try running: (cd ${pkgDir} && ./node_modules/.bin/prebuild-install)`);
  console.error('');
  return false;
}

// node-pty needs a `spawn-helper` executable beside the pty.node it loads, or
// pty.spawn() fails with `posix_spawnp failed`. An ABI rebuild lands a fresh
// build/Release/pty.node (which node-pty's loader prefers over prebuilds/) but
// emits only the addon, not node-pty's separate spawn-helper target; tar/extract
// can also drop the exec bit on the shipped prebuilds/*/spawn-helper. spawn-helper
// is a plain executable (no Node linkage) so the prebuilt copy is ABI-independent
// and safe to reuse. Best-effort; never throws.
function reconcileNodePtySpawnHelper() {
  if (process.platform === 'win32') return; // conpty has no spawn-helper
  const fs = require('fs');
  try {
    const nodePtyDir = resolveModuleDir('node-pty');
    if (!nodePtyDir) return;
    const prebuildsDir = path.join(nodePtyDir, 'prebuilds');
    const prebuiltHelper = path.join(prebuildsDir, `${process.platform}-${process.arch}`, 'spawn-helper');

    if (fs.existsSync(prebuildsDir)) {
      for (const entry of fs.readdirSync(prebuildsDir)) {
        const helper = path.join(prebuildsDir, entry, 'spawn-helper');
        if (fs.existsSync(helper)) {
          try { fs.chmodSync(helper, 0o755); } catch { /* best-effort */ }
        }
      }
    }

    for (const buildType of ['Release', 'Debug']) {
      const buildDir = path.join(nodePtyDir, 'build', buildType);
      const builtAddon = path.join(buildDir, 'pty.node');
      const builtHelper = path.join(buildDir, 'spawn-helper');
      if (fs.existsSync(builtHelper)) {
        try { fs.chmodSync(builtHelper, 0o755); } catch { /* best-effort */ }
      } else if (fs.existsSync(builtAddon) && fs.existsSync(prebuiltHelper)) {
        fs.copyFileSync(prebuiltHelper, builtHelper);
        fs.chmodSync(builtHelper, 0o755);
        console.log(`  node-pty: backfilled build/${buildType}/spawn-helper from prebuilds`);
      }
    }
  } catch {
    // best-effort — node-pty terminals are optional; never block the CLI
  }
}

// Check if native modules are compiled for the current Node.js version.
// This handles the case where npx caches the package but the user upgrades
// Node.js — the cached native modules will have a stale NODE_MODULE_VERSION.
// Returns true if everything was healthy or successfully rebuilt; false on
// rebuild failure. Never throws.
function ensureNativeModules() {
  const needsRebuild = [];

  // Check better-sqlite3-multiple-ciphers (provides SQLCipher encryption support).
  // The main app depends on this via an npm alias as 'better-sqlite3', so we must
  // ensure the SQLCipher-capable version is available and link it as 'better-sqlite3'.
  // This is the only ABI-fragile binding — detected straight from the binary.
  if (betterSqlite3NeedsRebuild()) {
    needsRebuild.push('better-sqlite3-multiple-ciphers');
  }

  // Check sharp: loads its native binding eagerly on require.
  try {
    require.resolve('sharp', { paths: [PACKAGE_DIR] });
    require('sharp');
  } catch (err) {
    if (err.message && err.message.includes('NODE_MODULE_VERSION')) {
      needsRebuild.push('sharp');
    } else if (err.code === 'MODULE_NOT_FOUND') {
      needsRebuild.push('sharp');
    }
  }

  // Check node-pty: backs the Ariel terminal feature. Loaded dynamically by
  // pty-manager in the standalone server, so resolution must succeed and the
  // native binding's NODE_MODULE_VERSION must match the runtime.
  try {
    require.resolve('node-pty', { paths: [PACKAGE_DIR] });
    require('node-pty');
  } catch (err) {
    if (err.message && err.message.includes('NODE_MODULE_VERSION')) {
      needsRebuild.push('node-pty');
    } else if (err.code === 'MODULE_NOT_FOUND') {
      needsRebuild.push('node-pty');
    }
  }

  if (needsRebuild.length === 0) {
    reconcileNodePtySpawnHelper();
    return true;
  }

  return rebuildModules(needsRebuild);
}

module.exports = {
  resolveModuleDir,
  readCompiledAbi,
  betterSqlite3BindingPath,
  betterSqlite3NeedsRebuild,
  findBinFor,
  rebuildNativePackage,
  ensureDatabaseNativeModule,
  ensureNativeModules,
  reconcileNodePtySpawnHelper,
  PACKAGE_DIR,
};

// Allow this file to be invoked directly as a postinstall script:
//   node lib/native-modules.js
// Exits 0 on success or graceful warning; never blocks npm install on failure.
if (require.main === module) {
  ensureNativeModules();
  process.exit(0);
}
