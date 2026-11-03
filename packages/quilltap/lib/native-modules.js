'use strict';

// Shared helpers for keeping native modules *usable* under the running Node.
// Used by both the runtime CLI entry (bin/quilltap.js) and the package's
// `postinstall` hook.
//
// The SQLCipher driver (better-sqlite3-multiple-ciphers, aliased as
// better-sqlite3) is a Node-API addon that ships one prebuilt binary per
// platform inside its npm tarball, so there is nothing to compile and no Node
// ABI to drift. The only ways it can fail to load are a platform with no
// prebuild or a host libc older than the binary; we detect and explain those,
// never rebuild. sharp and node-pty keep their `npm rebuild` heal.

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

const SUPPORTED_DRIVER_TARGETS = [
  'darwin-x64', 'darwin-arm64',
  'linux-x64', 'linux-arm64',
  'linuxmusl-x64', 'linuxmusl-arm64',
  'win32-x64', 'win32-arm64',
];
const GLIBC_FLOOR = '2.35';

// Which SQLCipher binding file would the driver's loader pick on this host?
// Asks the package's own `lib/binding.js#getPrebuildPath()` (required by
// absolute path on purpose: the package's `exports` map blocks the subpath
// form). A v12 or from-source copy has no prebuilds, so fall back to the
// from-source build/ location to describe that install truthfully. Returns the absolute
// path, or null when neither exists.
function betterSqlite3BindingPath() {
  const fs = require('fs');
  const modDir = resolveModuleDir('better-sqlite3-multiple-ciphers')
              || resolveModuleDir('better-sqlite3');
  if (!modDir) return null;
  try {
    const prebuild = require(path.join(modDir, 'lib', 'binding.js')).getPrebuildPath();
    if (prebuild) return prebuild;
  } catch {
    // older layout — no lib/binding.js
  }
  const built = path.join(modDir, 'build', 'Release', 'better_sqlite3.node');
  return fs.existsSync(built) ? built : null;
}

// Turn a failed driver load into a reason the user can act on. Pure; exported
// for tests. Returns { kind, message, hint }.
function classifyDriverLoadFailure({ platform, arch, prebuildPath, error }) {
  if (!prebuildPath) {
    return {
      kind: 'unsupported-platform',
      message: `the SQLCipher driver has no prebuilt binary for ${platform}-${arch}.`,
      hint: `Supported targets: ${SUPPORTED_DRIVER_TARGETS.join(', ')}. ` +
        'On anything else, run the Quilltap Docker image.',
    };
  }
  const errMessage = (error && error.message) || String(error || 'unknown error');
  const glibc = /GLIBC_(\d+\.\d+)/.exec(errMessage);
  if (glibc) {
    return {
      kind: 'glibc-too-old',
      message: `the SQLCipher driver needs glibc ${GLIBC_FLOOR} or newer ` +
        `(this host lacks GLIBC_${glibc[1]}).`,
      hint: 'Use Ubuntu 22.04, Debian 12, RHEL 9 or newer, or run the Quilltap Docker image.',
    };
  }
  return {
    kind: 'load-failed',
    message: `the SQLCipher driver failed to load: ${errMessage.split('\n')[0]}`,
    hint: 'Reinstall the quilltap package; if it persists, file an issue quoting the line above.',
  };
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

// Fast pre-flight for the SQLCipher driver every DB path needs. Loads the
// binding the driver would pick; when it won't load, prints why and what to do.
// Prints nothing when healthy, never rebuilds, never throws. Returns true when
// the binding loads, false otherwise.
function ensureDatabaseNativeModule() {
  let prebuildPath = null;
  let error = null;
  try {
    prebuildPath = betterSqlite3BindingPath();
    if (prebuildPath) require(prebuildPath);
  } catch (err) {
    error = err;
  }
  if (prebuildPath && !error) return true;

  const { message, hint } = classifyDriverLoadFailure({
    platform: process.platform,
    arch: process.arch,
    prebuildPath,
    error,
  });
  console.error('');
  console.error(`  Warning: ${message}`);
  console.error(`  Try: ${hint}`);
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

// Check that native modules load under the current Node.js version. sharp and
// node-pty are rebuilt when npx cached them under an older Node; the SQLCipher
// driver is only checked and explained (see ensureDatabaseNativeModule).
// Returns true if everything was healthy or successfully rebuilt; false
// otherwise. Never throws.
function ensureNativeModules() {
  const driverOk = ensureDatabaseNativeModule();
  const needsRebuild = [];

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
    return driverOk;
  }

  return rebuildModules(needsRebuild) && driverOk;
}

module.exports = {
  resolveModuleDir,
  betterSqlite3BindingPath,
  classifyDriverLoadFailure,
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
