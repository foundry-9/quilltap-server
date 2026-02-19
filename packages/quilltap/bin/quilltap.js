#!/usr/bin/env node
'use strict';

const { fork, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PACKAGE_DIR = path.resolve(__dirname, '..');
const STANDALONE_DIR = path.join(PACKAGE_DIR, 'standalone');
const SERVER_JS = path.join(STANDALONE_DIR, 'server.js');

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
  -h, --help              Show this help message

Data directory defaults:
  macOS:    ~/Library/Application Support/Quilltap
  Linux:    ~/.quilltap
  Windows:  %APPDATA%\\Quilltap

Examples:
  npx quilltap                          # Start on port 3000
  npx quilltap -p 8080                  # Start on port 8080
  npx quilltap -d /mnt/data/quilltap    # Custom data directory
  npx quilltap -o                       # Start and open browser

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

// Main
const opts = parseArgs(process.argv);

if (opts.help) {
  printHelp();
  process.exit(0);
}

if (opts.version) {
  console.log(getVersion());
  process.exit(0);
}

// Verify standalone directory exists
if (!fs.existsSync(SERVER_JS)) {
  console.error('Error: standalone/server.js not found.');
  console.error('The package may not have been built correctly.');
  console.error('If you installed from npm, please report this issue at:');
  console.error('  https://github.com/foundry-9/quilltap/issues');
  process.exit(1);
}

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

// Set NODE_PATH so native modules resolve from the package's own node_modules
// This is critical: standalone/node_modules has native modules stripped,
// so Node must walk up to packages/quilltap/node_modules to find them
const packageNodeModules = path.join(PACKAGE_DIR, 'node_modules');
env.NODE_PATH = env.NODE_PATH
  ? `${packageNodeModules}${path.delimiter}${env.NODE_PATH}`
  : packageNodeModules;

const version = getVersion();
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
const child = fork(SERVER_JS, [], {
  cwd: STANDALONE_DIR,
  env,
  stdio: 'inherit',
});

// Open browser once server is listening
if (opts.open) {
  // Give the server a moment to start
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
