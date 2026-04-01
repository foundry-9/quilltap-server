#!/usr/bin/env tsx
/**
 * Stage Lima Binaries for Electron Bundling
 *
 * Cross-platform script that downloads Lima from GitHub Releases (cached
 * locally) and stages the binaries into electron/resources/lima/ for
 * Electron packaging.
 *
 * Replaces the former stage-lima.sh script.
 *
 * Usage:
 *   npm run electron:stage-lima
 *   tsx scripts/stage-lima.ts
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { LIMA_VERSION, LIMA_CACHE_DIR } from '../electron/constants';

const PROJECT_ROOT = join(__dirname, '..');
const DEST = join(PROJECT_ROOT, 'electron', 'resources', 'lima');

function run(cmd: string, description: string): void {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

// Detect architecture
let limaArch: string;
if (process.arch === 'arm64') {
  limaArch = 'arm64';
} else if (process.arch === 'x64') {
  limaArch = 'x86_64';
} else {
  console.error(`Unsupported architecture: ${process.arch}`);
  process.exit(1);
}

console.log(`Lima version: ${LIMA_VERSION}`);
console.log(`Architecture: ${limaArch}`);
console.log('');

// Cache directory and tarball path
const tarballName = `lima-${LIMA_VERSION}-Darwin-${limaArch}.tar.gz`;
const tarballPath = join(LIMA_CACHE_DIR, tarballName);
const downloadUrl = `https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/${tarballName}`;

// Download if not cached
mkdirSync(LIMA_CACHE_DIR, { recursive: true });

if (existsSync(tarballPath)) {
  console.log(`Using cached tarball: ${tarballPath}`);
} else {
  console.log(`Downloading Lima ${LIMA_VERSION} from GitHub Releases...`);
  console.log(`URL: ${downloadUrl}`);
  run(
    `curl -fSL --progress-bar -o "${tarballPath}.tmp" "${downloadUrl}"`,
    'Downloading Lima tarball'
  );
  run(`mv "${tarballPath}.tmp" "${tarballPath}"`, 'Moving tarball to cache');
  console.log(`Downloaded to: ${tarballPath}`);
}

// Clean and create destination directory structure
if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true });
}
mkdirSync(join(DEST, 'bin'), { recursive: true });
mkdirSync(join(DEST, 'share', 'lima'), { recursive: true });

// Extract only the files we need:
//   bin/limactl
//   share/lima/lima-guestagent.Linux-*.gz
console.log('Extracting Lima binaries...');

// Extract limactl
run(
  `tar -xzf "${tarballPath}" -C "${DEST}" bin/limactl`,
  'Extracting limactl'
);
run(`chmod +x "${join(DEST, 'bin', 'limactl')}"`, 'Making limactl executable');

// Extract all guest agents (supports both aarch64 and x86_64 guests)
try {
  execSync(
    `tar -xzf "${tarballPath}" -C "${DEST}" --include='share/lima/lima-guestagent.Linux-*.gz'`,
    { stdio: 'inherit' }
  );
} catch {
  try {
    execSync(
      `tar -xzf "${tarballPath}" -C "${DEST}" share/lima/lima-guestagent.Linux-aarch64.gz share/lima/lima-guestagent.Linux-x86_64.gz`,
      { stdio: 'inherit' }
    );
  } catch {
    console.warn('WARNING: Could not extract guest agents — VM provisioning may fail');
  }
}

// Sign limactl with Developer ID for notarization compliance
const codesignIdentity = process.env.CODESIGN_IDENTITY || '';
if (codesignIdentity) {
  run(
    `codesign --force --sign "${codesignIdentity}" --options runtime --timestamp "${join(DEST, 'bin', 'limactl')}"`,
    'Signing limactl with Developer ID'
  );
  console.log('limactl signed.');
} else {
  console.log('Skipping limactl signing: CODESIGN_IDENTITY not set');
}

// Summary
console.log('');
console.log('Staged Lima files:');
function listFiles(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listFiles(full);
    } else {
      const sizeKb = (stat.size / 1024).toFixed(0);
      console.log(`  ${full} (${sizeKb} KB)`);
    }
  }
}
listFiles(DEST);
console.log('');
console.log('Done. Run electron:build:mac to package the app.');
