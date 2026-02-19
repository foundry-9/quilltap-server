#!/usr/bin/env tsx
/**
 * Build Quilltap npm Package
 *
 * Assembles the `quilltap` npm package by building the Next.js standalone
 * output and copying it into packages/quilltap/standalone/ along with
 * static assets, public files, and bundled plugins.
 *
 * Native modules (better-sqlite3, sharp) are stripped from the standalone
 * node_modules — they're listed as real npm dependencies in the package so
 * they compile/download for the user's platform at install time.
 *
 * Usage:
 *   npm run build:package
 *   tsx scripts/build-quilltap-package.ts
 *   tsx scripts/build-quilltap-package.ts --skip-build   # reuse existing .next/standalone
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..');
const PACKAGE_DIR = join(PROJECT_ROOT, 'packages', 'quilltap');
const STANDALONE_DIR = join(PACKAGE_DIR, 'standalone');
const NEXT_STANDALONE = join(PROJECT_ROOT, '.next', 'standalone');
const NEXT_STATIC = join(PROJECT_ROOT, '.next', 'static');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const PLUGINS_DIST = join(PROJECT_ROOT, 'plugins', 'dist');

// Parse arguments
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

console.log('==> Building Quilltap npm package');
console.log(`    Version: ${version}`);
console.log('');

// Step 1: Clean standalone directory
console.log('==> Step 1/8: Cleaning packages/quilltap/standalone/');
if (existsSync(STANDALONE_DIR)) {
  rmSync(STANDALONE_DIR, { recursive: true, force: true });
}
mkdirSync(STANDALONE_DIR, { recursive: true });

if (!skipBuild) {
  // Step 2: Build plugins
  console.log('==> Step 2/8: Building plugins');
  run('npm run build:plugins', 'Building plugins');

  // Step 3: Build Next.js standalone
  console.log('==> Step 3/8: Building Next.js (standalone output)');
  run('npx next build --webpack', 'Building Next.js');
} else {
  console.log('==> Step 2/8: Skipping plugin build (--skip-build)');
  console.log('==> Step 3/8: Skipping Next.js build (--skip-build)');
}

// Verify standalone output exists
if (!existsSync(NEXT_STANDALONE)) {
  console.error('Error: .next/standalone/ not found. Run without --skip-build first.');
  process.exit(1);
}

// Step 4: Copy standalone output
console.log('==> Step 4/8: Copying .next/standalone/ to package');
copyDir(`${NEXT_STANDALONE}/.`, STANDALONE_DIR);

// Step 5: Copy static assets
console.log('==> Step 5/8: Copying static assets');
const staticDest = join(STANDALONE_DIR, '.next', 'static');
mkdirSync(staticDest, { recursive: true });
copyDir(`${NEXT_STATIC}/.`, staticDest);

// Copy public directory
if (existsSync(PUBLIC_DIR)) {
  const publicDest = join(STANDALONE_DIR, 'public');
  mkdirSync(publicDest, { recursive: true });
  copyDir(`${PUBLIC_DIR}/.`, publicDest);
}

// Step 6: Copy bundled plugins
console.log('==> Step 6/8: Copying bundled plugins');
if (existsSync(PLUGINS_DIST)) {
  const pluginsDest = join(STANDALONE_DIR, 'plugins', 'dist');
  mkdirSync(pluginsDest, { recursive: true });
  copyDir(`${PLUGINS_DIST}/.`, pluginsDest);
}

// Step 7: Strip native modules and clean up
console.log('==> Step 7/8: Stripping native modules and cleaning up');
const standaloneNodeModules = join(STANDALONE_DIR, 'node_modules');

if (existsSync(standaloneNodeModules)) {
  // Remove native modules that will be resolved from package's own node_modules
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
        // Remove cache directories
        if (entry.name === '.cache') {
          rmSync(fullPath, { recursive: true, force: true });
          continue;
        }
        cleanDir(fullPath);
      } else if (entry.isFile()) {
        // Remove source maps and TypeScript declarations
        if (entry.name.endsWith('.map') || entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) {
          rmSync(fullPath, { force: true });
        }
      }
    }
  };

  cleanDir(standaloneNodeModules);
}

// Step 8: Sync version
console.log('==> Step 8/8: Syncing version');
const packageJsonPath = join(PACKAGE_DIR, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
packageJson.version = version;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`    Version synced: ${version}`);

// Summary
console.log('');
console.log('==> Done! Package ready at packages/quilltap/');
console.log(`    Standalone: ${dirSize(STANDALONE_DIR)}`);
console.log(`    Version:    ${version}`);
console.log('');
console.log('Next steps:');
console.log('  cd packages/quilltap && npm pack    # Create tarball');
console.log('  cd packages/quilltap && npm publish  # Publish to npm');
