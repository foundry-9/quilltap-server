#!/usr/bin/env tsx
/**
 * Start Quilltap Docker Container
 *
 * Cross-platform script that detects the host platform, sets sensible defaults,
 * and starts the Quilltap Docker container.
 *
 * Replaces the Docker-startup parts of the former start-quilltap.sh and
 * start-quilltap.ps1 scripts. (Those shell scripts are kept for curl|bash usage.)
 *
 * Usage:
 *   npm run start:docker
 *   tsx scripts/start-quilltap-docker.ts [options]
 *
 * Options:
 *   -d, --data-dir DIR      Data directory on host (default: platform-specific)
 *   -p, --port PORT         Host port (default: 3000)
 *   -n, --name NAME         Container name (default: quilltap)
 *   -t, --tag TAG           Image tag (default: latest)
 *   -e, --env KEY=VALUE     Extra environment variable (repeatable)
 *   --restart POLICY        Restart policy (default: unless-stopped)
 *   --dry-run               Print the docker command without running it
 *   -h, --help              Show this help message
 *
 * Environment variables (override defaults):
 *   QUILLTAP_DATA_DIR           Data directory
 *   QUILLTAP_PORT               Host port
 *   QUILLTAP_CONTAINER_NAME     Container name
 *   QUILLTAP_IMAGE_TAG          Image tag
 */

import { execFileSync, execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const IMAGE = 'foundry9/quilltap';

// --- Platform detection ---

type Platform = 'macos' | 'linux' | 'windows';

function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

function defaultDataDir(platform: Platform): string {
  const home = homedir();
  switch (platform) {
    case 'macos': return join(home, 'Library', 'Application Support', 'Quilltap');
    case 'windows': return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Quilltap');
    default: return join(home, '.quilltap');
  }
}

// --- Argument parsing ---

function printHelp(): void {
  console.log(`Usage: tsx scripts/start-quilltap-docker.ts [options]

Options:
  -d, --data-dir DIR      Data directory on host (default: platform-specific)
  -p, --port PORT         Host port (default: 3000)
  -n, --name NAME         Container name (default: quilltap)
  -t, --tag TAG           Image tag (default: latest)
  -e, --env KEY=VALUE     Extra environment variable (repeatable)
  --restart POLICY        Restart policy (default: unless-stopped)
  --dry-run               Print the docker command without running it
  -h, --help              Show this help message

Environment variables (override defaults):
  QUILLTAP_DATA_DIR           Data directory
  QUILLTAP_PORT               Host port
  QUILLTAP_CONTAINER_NAME     Container name
  QUILLTAP_IMAGE_TAG          Image tag`);
}

interface Options {
  dataDir: string;
  port: number;
  name: string;
  tag: string;
  extraEnvs: string[];
  restartPolicy: string;
  dryRun: boolean;
}

function parseArgs(platform: Platform): Options {
  const args = process.argv.slice(2);

  const opts: Options = {
    dataDir: process.env.QUILLTAP_DATA_DIR || defaultDataDir(platform),
    port: parseInt(process.env.QUILLTAP_PORT || '3000', 10),
    name: process.env.QUILLTAP_CONTAINER_NAME || 'quilltap',
    tag: process.env.QUILLTAP_IMAGE_TAG || 'latest',
    extraEnvs: [],
    restartPolicy: 'unless-stopped',
    dryRun: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '-d':
      case '--data-dir':
        opts.dataDir = args[++i];
        break;
      case '-p':
      case '--port':
        opts.port = parseInt(args[++i], 10);
        break;
      case '-n':
      case '--name':
        opts.name = args[++i];
        break;
      case '-t':
      case '--tag':
        opts.tag = args[++i];
        break;
      case '-e':
      case '--env':
        opts.extraEnvs.push(args[++i]);
        break;
      case '--restart':
        opts.restartPolicy = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error('Run with --help for usage.');
        process.exit(1);
    }
    i++;
  }

  return opts;
}

// --- Docker helpers ---

function dockerContainerExists(name: string): boolean {
  try {
    const out = execSync(`docker ps -a --format "{{.Names}}"`, { encoding: 'utf-8' });
    return out.split('\n').some(line => line.trim() === name);
  } catch {
    return false;
  }
}

function dockerContainerRunning(name: string): boolean {
  try {
    const out = execSync(`docker ps --format "{{.Names}}"`, { encoding: 'utf-8' });
    return out.split('\n').some(line => line.trim() === name);
  } catch {
    return false;
  }
}

// --- Main ---

const platform = detectPlatform();
const opts = parseArgs(platform);

console.log(`Platform:  ${platform}`);
console.log(`Data dir:  ${opts.dataDir}`);
console.log(`Port:      ${opts.port}`);
console.log(`Container: ${opts.name}`);
console.log(`Image:     ${IMAGE}:${opts.tag}`);
console.log('');

// Create data directory if needed
if (!opts.dryRun) {
  mkdirSync(opts.dataDir, { recursive: true });
}

// Build docker run command
const cmd: string[] = [
  'docker', 'run', '-d',
  '--name', opts.name,
  '--restart', opts.restartPolicy,
  '-p', `${opts.port}:3000`,
  '-v', `${opts.dataDir}:/app/quilltap`,
];

// Pass the host-side data directory so the app can display it in the UI
cmd.push('-e', `QUILLTAP_HOST_DATA_DIR=${opts.dataDir}`);

// Linux needs explicit host.docker.internal mapping for localhost URL rewriting
if (platform === 'linux') {
  cmd.push('--add-host=host.docker.internal:host-gateway');
}

// Extra environment variables
for (const env of opts.extraEnvs) {
  cmd.push('-e', env);
}

// Image
cmd.push(`${IMAGE}:${opts.tag}`);

if (opts.dryRun) {
  console.log('Dry run — would execute:');
  const quoted = cmd.map(a => a.includes(' ') ? `"${a}"` : a);
  console.log(`  ${quoted.join(' ')}`);
  process.exit(0);
}

// Check if container already exists
if (dockerContainerExists(opts.name)) {
  console.log(`Container '${opts.name}' already exists.`);
  if (dockerContainerRunning(opts.name)) {
    console.log(`It's already running. Use 'docker stop ${opts.name} && docker rm ${opts.name}' to recreate.`);
  } else {
    console.log('Starting existing container...');
    execSync(`docker start ${opts.name}`, { stdio: 'inherit' });
  }
  process.exit(0);
}

console.log('Starting Quilltap...');
try {
  execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' });
} catch {
  console.error('Failed to start container.');
  process.exit(1);
}

console.log('');
console.log(`Quilltap is running at http://localhost:${opts.port}`);
