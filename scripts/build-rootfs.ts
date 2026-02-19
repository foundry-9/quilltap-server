#!/usr/bin/env tsx
/**
 * Build Rootfs Tarball
 *
 * Cross-platform script that builds the Quilltap Docker image and exports
 * it as a rootfs tarball for use in Lima (macOS) or WSL2 (Windows) VMs.
 *
 * Replaces the former build-rootfs.sh script.
 *
 * Usage:
 *   npm run build:electron:rootfs
 *   tsx scripts/build-rootfs.ts                         # build for host arch
 *   tsx scripts/build-rootfs.ts --platform linux/amd64  # build amd64 rootfs
 *   tsx scripts/build-rootfs.ts --no-rebuild            # skip build if image exists
 *   tsx scripts/build-rootfs.ts --image TAG             # export from existing image
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECT_ROOT = join(__dirname, '..');

// Read version from package.json
const packageJson = require(join(PROJECT_ROOT, 'package.json'));
const version: string = packageJson.version;

// --- Argument parsing ---

function printHelp(): void {
  console.log(`Usage: tsx scripts/build-rootfs.ts [options]

Options:
  --no-rebuild            Skip Docker build if image already exists
  --platform PLAT         Target platform (default: auto-detected from host)
  --image TAG             Export from an existing Docker image instead of building
  -h, --help              Show this help message`);
}

let skipRebuild = false;
let customImage = '';

// Detect default platform from host
let platform: string;
if (process.arch === 'arm64') {
  platform = 'linux/arm64';
} else {
  platform = 'linux/amd64';
}

const args = process.argv.slice(2);
let i = 0;
while (i < args.length) {
  switch (args[i]) {
    case '--no-rebuild':
      skipRebuild = true;
      break;
    case '--platform':
      platform = args[++i];
      break;
    case '--image':
      customImage = args[++i];
      break;
    case '-h':
    case '--help':
      printHelp();
      process.exit(0);
      break;
    default:
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
  }
  i++;
}

// Derive arch label and Docker target from platform
let archLabel: string;
let dockerTarget: string;

switch (platform) {
  case 'linux/arm64':
    archLabel = 'arm64';
    dockerTarget = 'production';
    break;
  case 'linux/amd64':
    archLabel = 'amd64';
    dockerTarget = 'wsl2';
    break;
  default:
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
}

const imageTag = customImage || `quilltap-rootfs-${archLabel}:${version}`;
const containerName = `quilltap-rootfs-export-${process.pid}`;
const outputFilename = `quilltap-linux-${archLabel}.tar.gz`;
const outputFile = join(PROJECT_ROOT, outputFilename);

// Determine cache directory based on OS
let imagesDir: string;
if (process.platform === 'darwin') {
  imagesDir = join(homedir(), 'Library', 'Caches', 'Quilltap', 'lima-images');
} else if (process.platform === 'win32') {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  imagesDir = join(localAppData, 'Quilltap', 'vm-images');
} else {
  // Linux / fallback
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  imagesDir = join(cacheHome, 'quilltap', 'vm-images');
}

console.log('==> Building Quilltap rootfs tarball');
console.log(`    Version:  ${version}`);
console.log(`    Platform: ${platform}`);
console.log(`    Target:   ${dockerTarget}`);
console.log(`    Image:    ${imageTag}`);
console.log(`    Output:   ${outputFile}`);
console.log('');

function run(cmd: string, description: string): void {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

function runCapture(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

function imageExists(tag: string): boolean {
  try {
    execSync(`docker image inspect "${tag}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Step 1: Build the Docker image (if needed)
if (!customImage) {
  if (imageExists(imageTag) && skipRebuild) {
    console.log(`==> Step 1/5: Docker image '${imageTag}' already exists, skipping build (--no-rebuild)`);
  } else {
    run(
      `docker build --platform "${platform}" --target "${dockerTarget}" -t "${imageTag}" "${PROJECT_ROOT}"`,
      `Step 1/5: Building Docker ${dockerTarget} image`
    );
  }
} else {
  console.log(`==> Step 1/5: Using existing image '${imageTag}'`);
}

// Step 2: Create a temporary container (not started)
console.log('==> Step 2/5: Creating temporary container...');
const containerId = runCapture(
  `docker create --platform "${platform}" --name "${containerName}" "${imageTag}"`
);

// Step 3: Export the filesystem and add VERSION file
console.log('==> Step 3/5: Exporting filesystem...');
run(
  `docker export "${containerId}" | gzip > "${outputFile}.tmp"`,
  'Exporting container filesystem'
);

// Add VERSION file into the tarball
const tmpDir = runCapture('mktemp -d');
mkdirSync(join(tmpDir, 'app'), { recursive: true });
writeFileSync(join(tmpDir, 'app', 'VERSION'), version + '\n');

// Decompress, append VERSION, recompress
run(`gunzip -c "${outputFile}.tmp" > "${outputFile}.tar.tmp"`, 'Decompressing tarball');
run(`tar -rf "${outputFile}.tar.tmp" -C "${tmpDir}" app/VERSION`, 'Appending VERSION file');
run(`gzip -c "${outputFile}.tar.tmp" > "${outputFile}"`, 'Recompressing tarball');
run(`rm -f "${outputFile}.tmp" "${outputFile}.tar.tmp"`, 'Cleaning up temp files');
run(`rm -rf "${tmpDir}"`, 'Cleaning up temp directory');

// Step 4: Copy to cache directory and write build ID sidecar
console.log('==> Step 4/5: Copying to cache directory...');
mkdirSync(imagesDir, { recursive: true });
run(`cp "${outputFile}" "${join(imagesDir, outputFilename)}"`, 'Copying to cache');

// Write build ID sidecar so Electron can detect tarball updates
const buildId = `${version}+${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
const buildIdFile = join(imagesDir, `${outputFilename}.build-id`);
writeFileSync(buildIdFile, buildId + '\n');
console.log(`    Build ID: ${buildId}`);

// Step 5: Clean up Docker container
console.log('==> Step 5/5: Cleaning up...');
run(`docker rm "${containerId}"`, 'Removing temporary container');

// Summary
console.log('');
console.log('==> Done! Rootfs tarball ready.');
console.log(`    Local copy: ${outputFile}`);
console.log(`    Cache:      ${join(imagesDir, outputFilename)}`);
console.log(`    Build ID:   ${buildIdFile}`);
try {
  const size = runCapture(`du -h "${outputFile}" | cut -f1`);
  console.log(`    Size: ${size}`);
} catch {
  // du/cut may not be available on all platforms
}
console.log(`    Version: ${version}`);
