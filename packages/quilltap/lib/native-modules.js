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
  // We must load the native binding directly to detect NODE_MODULE_VERSION mismatches.
  try {
    const modDir = resolveModuleDir('better-sqlite3-multiple-ciphers')
                || resolveModuleDir('better-sqlite3');
    if (!modDir) throw Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' });
    const bindingsPath = path.join(modDir, 'build', 'Release', 'better_sqlite3.node');
    require(bindingsPath);
  } catch (err) {
    if (err.message && err.message.includes('NODE_MODULE_VERSION')) {
      needsRebuild.push('better-sqlite3-multiple-ciphers');
    } else if (err.code === 'MODULE_NOT_FOUND') {
      needsRebuild.push('better-sqlite3-multiple-ciphers');
    }
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

  if (needsRebuild.length === 0) return true;

  console.log(`  Rebuilding native modules for Node.js ${process.version}...`);

  try {
    execSync(`npm rebuild ${needsRebuild.join(' ')}`, {
      cwd: PACKAGE_DIR,
      stdio: 'inherit',
    });
    console.log('  Done.');
    console.log('');
    return true;
  } catch (err) {
    console.error('');
    console.error(`  Warning: Failed to rebuild native modules: ${err.message}`);
    console.error('  Try running: npm rebuild --prefix ' + PACKAGE_DIR);
    console.error('');
    return false;
  }
}

module.exports = { resolveModuleDir, ensureNativeModules, PACKAGE_DIR };

// Allow this file to be invoked directly as a postinstall script:
//   node lib/native-modules.js
// Exits 0 on success or graceful warning; never blocks npm install on failure.
if (require.main === module) {
  ensureNativeModules();
  process.exit(0);
}
