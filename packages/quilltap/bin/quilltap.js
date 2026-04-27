#!/usr/bin/env node
'use strict';

const { fork, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getCacheDir, isCacheValid, ensureStandalone } = require('../lib/download-manager');
const { resolveDataDir, promptPassphrase, loadDbKey } = require('../lib/db-helpers');

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
        // Allow subcommands to pass through (they're handled before parseArgs)
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

Subcommands:
  db                            Query encrypted databases
  themes                        Manage theme bundles
  docs                          Inspect, read, and export document mounts

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

  // Link better-sqlite3-multiple-ciphers as 'better-sqlite3' (the app imports it
  // via npm alias). Prefer the SQLCipher build; fall back to plain better-sqlite3.
  const betterSqlite3Dir = resolveModuleDir('better-sqlite3-multiple-ciphers')
                        || resolveModuleDir('better-sqlite3');
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

// ============================================================================
// db subcommand helpers (resolveDataDir, promptPassphrase, loadDbKey) live in
// ../lib/db-helpers.js so the docs subcommand can share them.
// ============================================================================

// ============================================================================
// Instance Lock CLI Commands
// ============================================================================

/**
 * Check whether a PID is alive using signal 0.
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM = exists but no permission
  }
}

/**
 * Verify a PID looks like a Node/Quilltap process (best-effort).
 */
function verifyPidIsNode(pid, expectedArgv0) {
  try {
    if (process.platform === 'linux') {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        const cmd = cmdline.split('\0')[0] || '';
        return /node|electron|quilltap|next-server/i.test(cmd);
      } catch {
        return true; // Can't read — assume match
      }
    }
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      const output = execSync(`ps -p ${pid} -o comm=`, {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return /node|electron|quilltap|next-server/i.test(output);
    }
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
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
 * Handle --lock-status, --lock-clean, --lock-override commands.
 */
function handleLockCommand(dataDir, opts) {
  const lockPath = path.join(dataDir, 'quilltap.lock');
  const hostname = require('os').hostname();

  // Read lock file
  let lock = null;
  try {
    if (fs.existsSync(lockPath)) {
      const raw = fs.readFileSync(lockPath, 'utf8');
      lock = JSON.parse(raw);
    }
  } catch (err) {
    if (opts.lockStatus) {
      console.log('Lock file exists but is corrupt or unreadable.');
      console.log(`  Path: ${lockPath}`);
      if (opts.lockClean) {
        fs.unlinkSync(lockPath);
        console.log('  Removed corrupt lock file.');
      }
    }
    return;
  }

  // --lock-status: display current lock state
  if (opts.lockStatus) {
    if (!lock) {
      console.log('No instance lock found. Database is not currently claimed.');
      console.log(`  Lock path: ${lockPath}`);
      return;
    }

    const sameHost = lock.hostname === hostname;
    const alive = sameHost && isPidAlive(lock.pid);
    const isNode = alive ? verifyPidIsNode(lock.pid, lock.processArgv0 || '') : false;

    // Status line
    let status;
    if (alive && isNode) {
      status = '\x1b[32mACTIVE\x1b[0m (process confirmed running)';
    } else if (alive && !isNode) {
      status = '\x1b[33mSUSPECT\x1b[0m (PID alive but does not look like Quilltap — possible PID reuse)';
    } else if (!sameHost) {
      // Different hostname — could be a VM/container on this machine
      const isVMOrContainer = ['docker', 'lima', 'wsl2'].includes(lock.environment);
      const heartbeatAgeMs = lock.lastHeartbeat
        ? Date.now() - new Date(lock.lastHeartbeat).getTime()
        : Infinity;
      const heartbeatFreshMs = 5 * 60 * 1000;

      if (isVMOrContainer && heartbeatAgeMs < heartbeatFreshMs) {
        const ageStr = Math.round(heartbeatAgeMs / 1000) + 's';
        status = `\x1b[32mACTIVE (${lock.environment}, heartbeat ${ageStr} ago)\x1b[0m`;
      } else if (isVMOrContainer) {
        status = `\x1b[33mSTALE (${lock.environment}, no recent heartbeat)\x1b[0m — will be auto-claimed on next startup`;
      } else {
        status = '\x1b[33mSTALE (different host)\x1b[0m — will be auto-claimed on next startup';
      }
    } else {
      status = '\x1b[31mSTALE (process dead)\x1b[0m — will be auto-claimed on next startup';
    }

    console.log(`Instance Lock Status: ${status}`);
    console.log();
    console.log(`  PID:          ${lock.pid}`);
    console.log(`  Hostname:     ${lock.hostname}${sameHost ? ' (this host)' : ' (different host)'}`);
    console.log(`  Environment:  ${lock.environment || 'unknown'}`);
    console.log(`  Process:      ${lock.processTitle || 'unknown'}`);
    console.log(`  Started:      ${lock.startedAt || 'unknown'}`);

    // Show heartbeat age if available
    if (lock.lastHeartbeat) {
      const heartbeatAge = Math.round((Date.now() - new Date(lock.lastHeartbeat).getTime()) / 1000);
      let heartbeatDisplay;
      if (heartbeatAge < 120) {
        heartbeatDisplay = `${heartbeatAge}s ago`;
      } else if (heartbeatAge < 7200) {
        heartbeatDisplay = `${Math.round(heartbeatAge / 60)}m ago`;
      } else {
        heartbeatDisplay = `${Math.round(heartbeatAge / 3600)}h ago`;
      }
      // Warn if heartbeat is older than 5 minutes (process may be hung)
      if (alive && heartbeatAge > 300) {
        heartbeatDisplay = `\x1b[33m${heartbeatDisplay} (stale — process may be hung)\x1b[0m`;
      }
      console.log(`  Heartbeat:    ${heartbeatDisplay}`);
    }

    console.log(`  Lock file:    ${lockPath}`);

    if (lock.history && lock.history.length > 0) {
      console.log();
      console.log(`  Recent history (${lock.history.length} entries):`);
      const recent = lock.history.slice(-10);
      for (const entry of recent) {
        const ts = entry.timestamp ? entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '?';
        const detail = entry.detail ? ` — ${entry.detail}` : '';
        console.log(`    [${ts}] ${entry.event} (PID ${entry.pid})${detail}`);
      }
      if (lock.history.length > 10) {
        console.log(`    ... and ${lock.history.length - 10} earlier entries`);
      }
    }
    return;
  }

  // --lock-clean: remove stale locks only
  if (opts.lockClean) {
    if (!lock) {
      console.log('No lock file found. Nothing to clean.');
      return;
    }

    const sameHost = lock.hostname === hostname;
    const alive = sameHost && isPidAlive(lock.pid);

    if (alive) {
      const isNode = verifyPidIsNode(lock.pid, lock.processArgv0 || '');
      if (isNode) {
        console.log(`Lock is held by a live Quilltap process (PID ${lock.pid}). Cannot clean.`);
        console.log('Stop the running instance first, or use --lock-override to force.');
        process.exit(1);
      } else {
        console.log(`Lock references PID ${lock.pid} which is alive but does NOT look like a Quilltap process.`);
        console.log('This is likely a stale lock with a reused PID. Removing.');
      }
    } else if (!sameHost) {
      // Different hostname — check if it's a VM/container with a recent heartbeat
      const isVMOrContainer = ['docker', 'lima', 'wsl2'].includes(lock.environment);
      const heartbeatAgeMs = lock.lastHeartbeat
        ? Date.now() - new Date(lock.lastHeartbeat).getTime()
        : Infinity;
      const heartbeatFreshMs = 5 * 60 * 1000;

      if (isVMOrContainer && heartbeatAgeMs < heartbeatFreshMs) {
        const ageStr = Math.round(heartbeatAgeMs / 1000) + 's';
        console.log(`Lock is held by a live ${lock.environment} instance (heartbeat ${ageStr} ago). Cannot clean.`);
        console.log('Stop the other instance first, or use --lock-override to force.');
        process.exit(1);
      } else if (isVMOrContainer) {
        console.log(`Lock was held by ${lock.environment} (${lock.hostname}) with no recent heartbeat. Removing stale lock.`);
      } else {
        console.log(`Lock was held by a different host (${lock.hostname}). Removing stale lock.`);
      }
    } else {
      console.log(`Lock was held by PID ${lock.pid} which is no longer running. Removing stale lock.`);
    }

    // Write a final history entry before deleting
    if (!lock.history) lock.history = [];
    lock.history.push({
      event: 'stale-claimed',
      pid: process.pid,
      hostname: hostname,
      timestamp: new Date().toISOString(),
      detail: `Cleaned via CLI (quilltap db --lock-clean)`,
    });

    // Write final state then remove
    try {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    } catch { /* best effort */ }

    try {
      fs.unlinkSync(lockPath);
      console.log('Lock file removed.');
    } catch (err) {
      console.error(`Failed to remove lock file: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // --lock-override: forcibly claim the lock
  if (opts.lockOverride) {
    if (!lock) {
      console.log('No lock file found. Nothing to override.');
      return;
    }

    const sameHost = lock.hostname === hostname;
    const alive = sameHost && isPidAlive(lock.pid);

    if (alive) {
      const isNode = verifyPidIsNode(lock.pid, lock.processArgv0 || '');
      if (!isNode) {
        console.error(`Lock override rejected: PID ${lock.pid} is alive but does not appear to be`);
        console.error('a Quilltap/Node process. The PID may have been reused. Verify manually.');
        process.exit(1);
      }
      console.log(`WARNING: Overriding lock held by live process (PID ${lock.pid}, ${lock.environment || 'unknown'}).`);
      console.log('The other instance may corrupt the database if it is still writing.');
    } else {
      console.log(`Overriding stale lock (PID ${lock.pid} is no longer running).`);
    }

    // Record override in history
    if (!lock.history) lock.history = [];
    lock.history.push({
      event: 'override',
      pid: process.pid,
      hostname: hostname,
      timestamp: new Date().toISOString(),
      detail: `Manual override via CLI (quilltap db --lock-override)` +
              (alive ? ` — overriding live PID ${lock.pid}` : ` — PID ${lock.pid} was dead`),
    });

    // Write final state then remove so next startup gets a clean acquire
    try {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    } catch { /* best effort */ }

    try {
      fs.unlinkSync(lockPath);
      console.log('Lock file removed. Next Quilltap startup will acquire a fresh lock.');
    } catch (err) {
      console.error(`Failed to remove lock file: ${err.message}`);
      process.exit(1);
    }
    return;
  }
}

function printDbHelp() {
  console.log(`
Quilltap Database Tool

Usage: quilltap db [options] [sql]

Query your encrypted Quilltap database directly.

Options:
  --tables              List all tables
  --count <table>       Show row count for a table
  --repl                Interactive SQL prompt
  --llm-logs            Target the LLM logs database
  --mount-points        Target the document mount-index database
  --data-dir <path>     Override data directory
  --passphrase <pass>   Provide passphrase for encrypted .dbkey
  -h, --help            Show this help

Instance Lock Commands:
  --lock-status         Show the current instance lock state
  --lock-clean          Remove stale locks (dead processes only)
  --lock-override       Forcibly claim the lock for this process

If a passphrase is required and not provided via --passphrase, the tool
will check the QUILLTAP_DB_PASSPHRASE environment variable, then prompt
interactively (with hidden input) if a TTY is available.

Examples:
  quilltap db --tables
  quilltap db "SELECT count(*) FROM characters"
  quilltap db --count messages
  quilltap db --repl
  quilltap db --llm-logs --tables
  quilltap db --mount-points --tables
  quilltap db --mount-points "SELECT id, name FROM doc_mount_points"
  quilltap db --lock-status
  quilltap db --lock-clean
  QUILLTAP_DB_PASSPHRASE=secret quilltap db --tables
`);
}

async function dbCommand(args) {
  let dataDirOverride = '';
  let passphrase = '';
  let useLlmLogs = false;
  let useMountPoints = false;
  let showTables = false;
  let countTable = '';
  let repl = false;
  let sql = '';
  let showHelp = false;
  let lockStatus = false;
  let lockClean = false;
  let lockOverride = false;

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--data-dir': case '-d': dataDirOverride = args[++i]; break;
      case '--passphrase': passphrase = args[++i]; break;
      case '--llm-logs': useLlmLogs = true; break;
      case '--mount-points': useMountPoints = true; break;
      case '--tables': showTables = true; break;
      case '--count': countTable = args[++i]; break;
      case '--repl': repl = true; break;
      case '--help': case '-h': showHelp = true; break;
      case '--lock-status': lockStatus = true; break;
      case '--lock-clean': lockClean = true; break;
      case '--lock-override': lockOverride = true; break;
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
        sql = args[i];
        break;
    }
    i++;
  }

  if (showHelp) {
    printDbHelp();
    process.exit(0);
  }

  const dataDir = resolveDataDir(dataDirOverride);

  // ---- Instance lock commands (no database open required) ----
  if (lockStatus || lockClean || lockOverride) {
    handleLockCommand(dataDir, { lockStatus, lockClean, lockOverride });
    return;
  }

  if (useLlmLogs && useMountPoints) {
    console.error('Error: --llm-logs and --mount-points are mutually exclusive');
    process.exit(1);
  }

  let dbFilename;
  if (useLlmLogs) dbFilename = 'quilltap-llm-logs.db';
  else if (useMountPoints) dbFilename = 'quilltap-mount-index.db';
  else dbFilename = 'quilltap.db';
  const dbPath = path.join(dataDir, dbFilename);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  // Load encryption key
  let pepper;
  try {
    pepper = await loadDbKey(dataDir, passphrase);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  // Open database — prefer SQLCipher-capable build
  let Database;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
  } catch {
    Database = require('better-sqlite3');
  }
  const db = new Database(dbPath, { readonly: !repl });

  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }

  try {
    // Verify database is readable
    db.prepare('SELECT 1').get();
  } catch (err) {
    console.error(`Cannot open database: ${err.message}`);
    console.error('The database may be encrypted with a different key, or the .dbkey file may be missing.');
    db.close();
    process.exit(1);
  }

  try {
    if (showTables) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      for (const t of tables) console.log(t.name);
    } else if (countTable) {
      const row = db.prepare(`SELECT count(*) as count FROM "${countTable}"`).get();
      console.log(row.count);
    } else if (sql) {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all();
        if (rows.length === 0) {
          console.log('(no results)');
        } else {
          console.table(rows);
        }
      } else {
        const info = stmt.run();
        console.log(`Changes: ${info.changes}`);
      }
    } else if (repl) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'quilltap> ' });
      console.log(`Connected to ${dbPath}`);
      console.log('Type .tables, .schema <table>, or SQL. Ctrl+D to exit.\n');
      rl.prompt();
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) { rl.prompt(); return; }
        try {
          if (trimmed === '.tables') {
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
            for (const t of tables) console.log(t.name);
          } else if (trimmed.startsWith('.schema')) {
            const table = trimmed.split(/\s+/)[1];
            if (!table) { console.log('Usage: .schema <table>'); }
            else {
              const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table);
              console.log(row ? row.sql : `Table '${table}' not found`);
            }
          } else {
            const stmt = db.prepare(trimmed);
            if (stmt.reader) {
              const rows = stmt.all();
              if (rows.length === 0) console.log('(no results)');
              else console.table(rows);
            } else {
              const info = stmt.run();
              console.log(`Changes: ${info.changes}`);
            }
          }
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
        rl.prompt();
      });
      rl.on('close', () => {
        db.close();
        process.exit(0);
      });
      return; // Don't close db yet — REPL is interactive
    } else {
      printDbHelp();
    }
  } finally {
    if (!repl) db.close();
  }
}

// Route to subcommand or main
if (process.argv[2] === 'db') {
  dbCommand(process.argv.slice(3));
} else if (process.argv[2] === 'themes') {
  const { themesCommand } = require('../lib/theme-commands');
  themesCommand(process.argv.slice(3));
} else if (process.argv[2] === 'docs') {
  const { docsCommand } = require('../lib/docs-commands');
  docsCommand(process.argv.slice(3));
} else {
  main();
}
