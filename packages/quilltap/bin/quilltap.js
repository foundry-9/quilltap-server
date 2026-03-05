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
// db subcommand — query encrypted databases directly
// ============================================================================

/**
 * Resolve the data directory using the same platform logic as lib/paths.ts.
 */
function resolveDataDir(overrideDir) {
  if (overrideDir) {
    const resolved = overrideDir.startsWith('~')
      ? path.join(require('os').homedir(), overrideDir.slice(1))
      : overrideDir;
    return path.join(resolved, 'data');
  }
  const os = require('os');
  if (process.env.QUILLTAP_DATA_DIR) {
    return path.join(process.env.QUILLTAP_DATA_DIR, 'data');
  }
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Quilltap', 'data');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Quilltap', 'data');
  return path.join(home, '.quilltap', 'data');
}

/**
 * Read and decrypt the .dbkey file to get the SQLCipher key.
 */
function loadDbKey(dataDir, passphrase) {
  const crypto = require('crypto');
  const dbkeyPath = path.join(dataDir, 'quilltap.dbkey');
  if (!fs.existsSync(dbkeyPath)) {
    return null; // No .dbkey file — DB may be unencrypted
  }

  const data = JSON.parse(fs.readFileSync(dbkeyPath, 'utf8'));
  const INTERNAL_PASSPHRASE = '__quilltap_no_passphrase__';

  // Strip legacy hasPassphrase field if present
  if ('hasPassphrase' in data) {
    delete data.hasPassphrase;
    fs.writeFileSync(dbkeyPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  // Helper to attempt decryption with a given passphrase
  function tryDecrypt(pass) {
    const salt = Buffer.from(data.salt, 'hex');
    const key = crypto.pbkdf2Sync(pass, new Uint8Array(salt), data.kdfIterations, 32, data.kdfDigest);
    const iv = Buffer.from(data.iv, 'hex');
    const decipher = crypto.createDecipheriv(data.algorithm, new Uint8Array(key), new Uint8Array(iv));
    decipher.setAuthTag(new Uint8Array(Buffer.from(data.authTag, 'hex')));
    let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    if (hash !== data.pepperHash) {
      throw new Error('Pepper hash mismatch');
    }
    return plaintext;
  }

  // Try internal passphrase first (no user passphrase case)
  try {
    return tryDecrypt(INTERNAL_PASSPHRASE);
  } catch {
    // Internal passphrase failed — need user passphrase
  }

  // User passphrase required
  if (!passphrase) {
    throw new Error('This database requires a passphrase. Use --passphrase <pass>');
  }

  return tryDecrypt(passphrase);
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
  --data-dir <path>     Override data directory
  --passphrase <pass>   Provide passphrase for encrypted .dbkey
  -h, --help            Show this help

Examples:
  quilltap db --tables
  quilltap db "SELECT count(*) FROM characters"
  quilltap db --count messages
  quilltap db --repl
  quilltap db --llm-logs --tables
`);
}

async function dbCommand(args) {
  let dataDirOverride = '';
  let passphrase = '';
  let useLlmLogs = false;
  let showTables = false;
  let countTable = '';
  let repl = false;
  let sql = '';
  let showHelp = false;

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--data-dir': case '-d': dataDirOverride = args[++i]; break;
      case '--passphrase': passphrase = args[++i]; break;
      case '--llm-logs': useLlmLogs = true; break;
      case '--tables': showTables = true; break;
      case '--count': countTable = args[++i]; break;
      case '--repl': repl = true; break;
      case '--help': case '-h': showHelp = true; break;
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
  const dbFilename = useLlmLogs ? 'quilltap-llm-logs.db' : 'quilltap.db';
  const dbPath = path.join(dataDir, dbFilename);

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  // Load encryption key
  let pepper;
  try {
    pepper = loadDbKey(dataDir, passphrase);
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
} else {
  main();
}
