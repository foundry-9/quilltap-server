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
  return rebuildModules(['better-sqlite3-multiple-ciphers']);
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
  betterSqlite3NeedsRebuild,
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
