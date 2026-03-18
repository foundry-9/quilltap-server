#!/usr/bin/env tsx
/**
 * Build Electron Embedded Server
 *
 * Prepares the Next.js standalone output for embedding inside the Electron app.
 * Unlike build-standalone-tarball.ts, this script:
 *   - Does NOT strip native modules (they stay for Electron's Node.js)
 *   - Runs electron-rebuild to recompile native bindings against Electron's Node ABI
 *   - Copies output to .electron-server-staging/ for electron-builder to pick up
 *
 * Usage:
 *   npx tsx scripts/build-electron-server.ts
 *   npx tsx scripts/build-electron-server.ts --skip-build
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..');
const STAGING_DIR = join(PROJECT_ROOT, '.electron-server-staging');
const NEXT_STANDALONE = join(PROJECT_ROOT, '.next', 'standalone');
const NEXT_STATIC = join(PROJECT_ROOT, '.next', 'static');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const PLUGINS_DIST = join(PROJECT_ROOT, 'plugins', 'dist');

const skipBuild = process.argv.includes('--skip-build');

function run(cmd: string, description: string): void {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

function copyDir(src: string, dest: string): void {
  execSync(`cp -R "${src}" "${dest}"`, { stdio: 'ignore' });
}

function dirSize(dir: string): string {
  try {
    return execSync(`du -sh "${dir}" | cut -f1`, { encoding: 'utf-8' }).trim();
  } catch {
    return '?';
  }
}

// Read root version
const rootPackage = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const version: string = rootPackage.version;

console.log('==> Building Electron embedded server');
console.log(`    Version: ${version}`);
console.log(`    Output:  ${STAGING_DIR}`);
console.log('');

// Step 1: Clean staging directory
console.log('==> Step 1/6: Cleaning staging directory');
if (existsSync(STAGING_DIR)) {
  rmSync(STAGING_DIR, { recursive: true, force: true });
}
mkdirSync(STAGING_DIR, { recursive: true });

if (!skipBuild) {
  // Step 2: Build plugins
  console.log('==> Step 2/6: Building plugins');
  run('npm run build:plugins', 'Building plugins');

  // Step 3: Build Next.js standalone
  console.log('==> Step 3/6: Building Next.js (standalone output)');
  run('npx next build --webpack', 'Building Next.js');
} else {
  console.log('==> Step 2/6: Skipping plugin build (--skip-build)');
  console.log('==> Step 3/6: Skipping Next.js build (--skip-build)');
}

// Verify standalone output exists
if (!existsSync(NEXT_STANDALONE)) {
  console.error('Error: .next/standalone/ not found. Run without --skip-build first.');
  process.exit(1);
}

// Step 4: Copy standalone output + static assets + public files + plugins
console.log('==> Step 4/6: Copying standalone output to staging');
copyDir(`${NEXT_STANDALONE}/.`, STAGING_DIR);

console.log('    Copying .next/static/');
const staticDest = join(STAGING_DIR, '.next', 'static');
mkdirSync(staticDest, { recursive: true });
copyDir(`${NEXT_STATIC}/.`, staticDest);

if (existsSync(PUBLIC_DIR)) {
  console.log('    Copying public/');
  const publicDest = join(STAGING_DIR, 'public');
  mkdirSync(publicDest, { recursive: true });
  copyDir(`${PUBLIC_DIR}/.`, publicDest);
}

if (existsSync(PLUGINS_DIST)) {
  console.log('    Copying plugins/dist/');
  const pluginsDest = join(STAGING_DIR, 'plugins', 'dist');
  mkdirSync(pluginsDest, { recursive: true });
  copyDir(`${PLUGINS_DIST}/.`, pluginsDest);
}

// Step 5: Clean unnecessary files (but keep native modules intact)
console.log('==> Step 5/6: Cleaning unnecessary files');
const standaloneNodeModules = join(STAGING_DIR, 'node_modules');
if (existsSync(standaloneNodeModules)) {
  const cleanDir = (dir: string): void => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.cache') {
          rmSync(fullPath, { recursive: true, force: true });
          continue;
        }
        cleanDir(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.map') || entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) {
          rmSync(fullPath, { force: true });
        }
      }
    }
  };

  cleanDir(standaloneNodeModules);
}

// Step 6: Rebuild native modules against Electron's Node ABI
console.log('==> Step 6/6: Rebuilding native modules for Electron');
run(
  `npx electron-rebuild --module-dir "${STAGING_DIR}" --force`,
  'Rebuilding native modules against Electron Node ABI'
);

// Summary
const totalSize = dirSize(STAGING_DIR);
console.log('');
console.log('==> Done!');
console.log(`    Staging: ${STAGING_DIR}`);
console.log(`    Size:    ${totalSize}`);
console.log(`    Version: ${version}`);
console.log('');
console.log('electron-builder will pick up this directory via extraResources.');
