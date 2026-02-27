#!/usr/bin/env node
'use strict';

const { fork, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getCacheDir, isCacheValid, ensureStandalone } = require('../lib/download-manager');

const PACKAGE_DIR = path.resolve(__dirname, '..');

// Read version from package.json
function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

// Parse CLI arguments
function parseArgs(argv) {
  const opts = {
    port: 3000,
    dataDir: '',
    open: false,
    help: false,
    version: false,
    update: false,
  };

  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--port':
      case '-p':
        opts.port = parseInt(args[++i], 10);
        if (isNaN(opts.port) || opts.port < 1 || opts.port > 65535) {
          console.error('Error: --port must be a number between 1 and 65535');
          process.exit(1);
        }
        break;
      case '--data-dir':
      case '-d':
        opts.dataDir = args[++i];
        break;
      case '--open':
      case '-o':
        opts.open = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      case '--update':
        opts.update = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        console.error('Run "quilltap --help" for usage information.');
        process.exit(1);
    }
    i++;
  }

  return opts;
}

function printHelp() {
  console.log(`
Quilltap - Self-hosted AI workspace

Usage: quilltap [options]

Options:
  -p, --port <number>     Port to listen on (default: 3000)
  -d, --data-dir <path>   Data directory (default: platform-specific)
  -o, --open              Open browser after server starts
  -v, --version           Show version number
  --update                Force re-download of application files
  -h, --help              Show this help message

Data directory defaults:
  macOS:    ~/Library/Application Support/Quilltap
  Linux:    ~/.quilltap
  Windows:  %APPDATA%\\Quilltap

Examples:
  quilltap                              # Start on port 3000
  quilltap -p 8080                      # Start on port 8080
  quilltap -d /mnt/data/quilltap        # Custom data directory
  quilltap -o                           # Start and open browser
  quilltap --update                     # Re-download app files

More info: https://quilltap.ai
`);
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(`Could not open browser automatically. Visit: ${url}`);
    }
  });
}

// Resolve a native module's directory, handling npm hoisting.
// Returns the directory containing package.json, or null if not found.
function resolveModuleDir(moduleName) {
  try {
    const pkgJson = require.resolve(moduleName + '/package.json');
    return path.dirname(pkgJson);
  } catch {
    return null;
  }
}

// Check if native modules are compiled for the current Node.js version.
// This handles the case where npx caches the package but the user upgrades
// Node.js — the cached native modules will have a stale NODE_MODULE_VERSION.
function ensureNativeModules() {
  const needsRebuild = [];

  // Check better-sqlite3: it lazy-loads the native .node binary only when you
  // create a Database, so a bare require('better-sqlite3') always succeeds.
  // We must load the native binding directly to detect NODE_MODULE_VERSION mismatches.
  // Use require.resolve to find it regardless of npm hoisting.
  try {
    const modDir = resolveModuleDir('better-sqlite3');
    if (!modDir) throw Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' });
    const bindingsPath = path.join(modDir, 'build', 'Release', 'better_sqlite3.node');
    require(bindingsPath);
  } catch (err) {
    if (err.message && err.message.includes('NODE_MODULE_VERSION')) {
      needsRebuild.push('better-sqlite3');
    } else if (err.code === 'MODULE_NOT_FOUND') {
      needsRebuild.push('better-sqlite3');
    }
  }

  // Check sharp: loads its native binding eagerly on require, but we use
  // the same explicit-path approach for consistency and reliability.
  try {
    require('sharp');
  } catch (err) {
    if (err.message && err.message.includes('NODE_MODULE_VERSION')) {
      needsRebuild.push('sharp');
    } else if (err.code === 'MODULE_NOT_FOUND') {
      needsRebuild.push('sharp');
    }
  }

  if (needsRebuild.length === 0) return;

  console.log(`  Rebuilding native modules for Node.js ${process.version}...`);

  try {
    execSync(`npm rebuild ${needsRebuild.join(' ')}`, {
      cwd: PACKAGE_DIR,
      stdio: 'inherit',
    });
    console.log('  Done.');
    console.log('');
  } catch (err) {
    console.error('');
    console.error(`  Warning: Failed to rebuild native modules: ${err.message}`);
    console.error('  Try running: npm rebuild --prefix ' + PACKAGE_DIR);
    console.error('');
  }
}

// Symlink native modules into the standalone directory's node_modules
// so that standard Node.js resolution finds them without relying on NODE_PATH.
function linkNativeModules(standaloneDir) {
  const standaloneNodeModules = path.join(standaloneDir, 'node_modules');

  // Ensure top-level node_modules exists in standalone dir
  if (!fs.existsSync(standaloneNodeModules)) {
    fs.mkdirSync(standaloneNodeModules, { recursive: true });
  }

  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

  // Link a single module directory into standaloneDir/node_modules/<name>
  function linkModule(name, sourceDir) {
    if (!sourceDir) return;
    const targetPath = path.join(standaloneNodeModules, name);

    // If already exists and points to the right place, skip
    if (fs.existsSync(targetPath)) {
      try {
        const existing = fs.realpathSync(targetPath);
        const source = fs.realpathSync(sourceDir);
        if (existing === source) return; // already linked correctly
      } catch {
        // If we can't resolve, remove and re-link
      }
      // Remove stale link/dir
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    // Ensure parent directory exists (for scoped packages like @img/sharp-*)
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      fs.symlinkSync(sourceDir, targetPath, symlinkType);
    } catch (err) {
      // If symlink fails (e.g. permissions), try copying as fallback
      console.error(`  Warning: Could not symlink ${name}: ${err.message}`);
    }
  }

  // Link better-sqlite3
  const betterSqlite3Dir = resolveModuleDir('better-sqlite3');
  linkModule('better-sqlite3', betterSqlite3Dir);

  // Link sharp
  const sharpDir = resolveModuleDir('sharp');
  linkModule('sharp', sharpDir);

  // Link sharp's @img platform packages — they live near sharp's location
  if (sharpDir) {
    const sharpParent = path.dirname(sharpDir);

    // If sharp is in a scoped dir or regular node_modules, look for @img there
    const imgDir = path.join(sharpParent, '@img');
    if (fs.existsSync(imgDir)) {
      try {
        const imgPackages = fs.readdirSync(imgDir).filter(name => name.startsWith('sharp-'));
        for (const pkg of imgPackages) {
          linkModule(`@img/${pkg}`, path.join(imgDir, pkg));
        }
      } catch {
        // Non-fatal — sharp may work without explicit @img links
      }
    }
  }
}

// Main
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const version = getVersion();

  if (opts.version) {
    console.log(version);
    process.exit(0);
  }

  // Ensure standalone files are downloaded and cached
  const cacheDir = getCacheDir();
  let standaloneDir;

  try {
    standaloneDir = await ensureStandalone(version, cacheDir, { force: opts.update });
  } catch (err) {
    console.error('');
    console.error(err.message);
    process.exit(1);
  }

  const serverJs = path.join(standaloneDir, 'server.js');

  if (!fs.existsSync(serverJs)) {
    console.error('Error: server.js not found in cached standalone directory.');
    console.error('Try running "quilltap --update" to re-download.');
    process.exit(1);
  }

  // Ensure native modules are compiled for the current Node.js version
  ensureNativeModules();

  // Symlink native modules into standalone dir so standard resolution finds them
  linkNativeModules(standaloneDir);

  // Set up environment
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(opts.port),
    HOSTNAME: '0.0.0.0',
  };

  if (opts.dataDir) {
    env.QUILLTAP_DATA_DIR = path.resolve(opts.dataDir);
  }

  // Set NODE_PATH as a fallback — native modules are symlinked into standaloneDir
  // but NODE_PATH covers any other dependencies. Include the parent node_modules
  // to handle npm hoisting (e.g. npx installs where deps are hoisted up a level).
  const packageNodeModules = path.join(PACKAGE_DIR, 'node_modules');
  const parentNodeModules = path.resolve(PACKAGE_DIR, '..');
  env.NODE_PATH = [packageNodeModules, parentNodeModules, env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);

  const url = `http://localhost:${opts.port}`;

  console.log('');
  console.log(`  Quilltap v${version}`);
  console.log('');
  console.log(`  URL:       ${url}`);
  if (opts.dataDir) {
    console.log(`  Data dir:  ${env.QUILLTAP_DATA_DIR}`);
  }
  console.log('');
  console.log('  Starting server...');
  console.log('');

  // Fork the Next.js standalone server
  const child = fork(serverJs, [], {
    cwd: standaloneDir,
    env,
    stdio: 'inherit',
  });

  // Open browser once server is listening
  if (opts.open) {
    setTimeout(() => openBrowser(url), 2000);
  }

  // Forward signals for graceful shutdown
  function shutdown(signal) {
    child.kill(signal);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
    }
    process.exit(code || 0);
  });

  child.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

main();
