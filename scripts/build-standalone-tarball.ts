#!/usr/bin/env tsx
/**
 * Build Quilltap Standalone Tarball
 *
 * Builds the Next.js standalone output and packages it as a tarball
 * for distribution via GitHub Releases. The `quilltap` npm package
 * downloads this tarball on first run.
 *
 * The output is platform-agnostic (pure JavaScript). Native modules
 * (better-sqlite3, sharp) are stripped — they're installed as npm
 * dependencies on the user's machine.
 *
 * Usage:
 *   npx tsx scripts/build-standalone-tarball.ts
 *   npx tsx scripts/build-standalone-tarball.ts --skip-build
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..');
const STAGING_DIR = join(PROJECT_ROOT, '.standalone-staging');
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
const tarballName = `quilltap-standalone-${version}.tar.gz`;
const tarballPath = join(PROJECT_ROOT, tarballName);

console.log('==> Building Quilltap standalone tarball');
console.log(`    Version: ${version}`);
console.log(`    Output:  ${tarballName}`);
console.log('');

// Step 1: Clean staging directory
console.log('==> Step 1/7: Cleaning staging directory');
if (existsSync(STAGING_DIR)) {
  rmSync(STAGING_DIR, { recursive: true, force: true });
}
mkdirSync(STAGING_DIR, { recursive: true });

if (!skipBuild) {
  // Step 2: Build plugins
  console.log('==> Step 2/7: Building plugins');
  run('npm run build:plugins', 'Building plugins');

  // Step 3: Build Next.js standalone
  console.log('==> Step 3/7: Building Next.js (standalone output)');
  run('npx next build --webpack', 'Building Next.js');
} else {
  console.log('==> Step 2/7: Skipping plugin build (--skip-build)');
  console.log('==> Step 3/7: Skipping Next.js build (--skip-build)');
}

// Verify standalone output exists
if (!existsSync(NEXT_STANDALONE)) {
  console.error('Error: .next/standalone/ not found. Run without --skip-build first.');
  process.exit(1);
}

// Step 4: Copy standalone output
console.log('==> Step 4/7: Copying .next/standalone/ to staging');
copyDir(`${NEXT_STANDALONE}/.`, STAGING_DIR);

// Step 5: Copy static assets and public files
console.log('==> Step 5/7: Copying static assets and public files');
const staticDest = join(STAGING_DIR, '.next', 'static');
mkdirSync(staticDest, { recursive: true });
copyDir(`${NEXT_STATIC}/.`, staticDest);

if (existsSync(PUBLIC_DIR)) {
  const publicDest = join(STAGING_DIR, 'public');
  mkdirSync(publicDest, { recursive: true });
  copyDir(`${PUBLIC_DIR}/.`, publicDest);
}

// Step 6: Copy bundled plugins and strip native modules
console.log('==> Step 6/7: Copying plugins and stripping native modules');
if (existsSync(PLUGINS_DIST)) {
  const pluginsDest = join(STAGING_DIR, 'plugins', 'dist');
  mkdirSync(pluginsDest, { recursive: true });
  copyDir(`${PLUGINS_DIST}/.`, pluginsDest);
}

const standaloneNodeModules = join(STAGING_DIR, 'node_modules');
if (existsSync(standaloneNodeModules)) {
  // Remove native modules — they'll be resolved from the npm package's node_modules
  const nativeModulesToStrip = ['better-sqlite3', 'sharp'];
  for (const mod of nativeModulesToStrip) {
    const modPath = join(standaloneNodeModules, mod);
    if (existsSync(modPath)) {
      rmSync(modPath, { recursive: true, force: true });
      console.log(`    Stripped: ${mod}`);
    }
  }

  // Remove @img/sharp-* platform-specific packages
  const imgDir = join(standaloneNodeModules, '@img');
  if (existsSync(imgDir)) {
    rmSync(imgDir, { recursive: true, force: true });
    console.log('    Stripped: @img/sharp-*');
  }

  // Clean up unnecessary files to reduce size
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

// Step 7: Create tarball
console.log('==> Step 7/7: Creating tarball');
// Remove old tarball if it exists
if (existsSync(tarballPath)) {
  rmSync(tarballPath, { force: true });
}

// Create tarball from staging directory contents (not the directory itself)
run(`tar -czf "${tarballPath}" -C "${STAGING_DIR}" .`, 'Creating tarball');

// Clean up staging
rmSync(STAGING_DIR, { recursive: true, force: true });

// Summary
const tarballSize = (() => {
  try {
    const stat = statSync(tarballPath);
    const mb = stat.size / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  } catch {
    return '?';
  }
})();

console.log('');
console.log('==> Done!');
console.log(`    Tarball: ${tarballName}`);
console.log(`    Size:    ${tarballSize}`);
console.log(`    Version: ${version}`);
console.log('');
console.log('This tarball is uploaded to GitHub Releases and downloaded');
console.log('by the quilltap npm package on first run.');
