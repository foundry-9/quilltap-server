#!/usr/bin/env tsx
/**
 * Build Quilltap npm Package
 *
 * Syncs the version number from the root package.json to the
 * quilltap npm package. The npm package is now a thin CLI launcher
 * that downloads the standalone output from GitHub Releases on first
 * run, so no build artifacts need to be bundled.
 *
 * Usage:
 *   npm run build:package
 *   tsx scripts/build-quilltap-package.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..');
const PACKAGE_DIR = join(PROJECT_ROOT, 'packages', 'quilltap');

// Read root version
const rootPackage = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const version: string = rootPackage.version;

console.log('==> Building Quilltap npm package');
console.log(`    Version: ${version}`);
console.log('');

// Sync version
console.log('==> Syncing version');
const packageJsonPath = join(PACKAGE_DIR, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
packageJson.version = version;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`    Version synced: ${version}`);

// Summary
console.log('');
console.log('==> Done! Package ready at packages/quilltap/');
console.log(`    Version: ${version}`);
console.log('');
console.log('Next steps:');
console.log('  cd packages/quilltap && npm pack    # Create tarball');
console.log('  cd packages/quilltap && npm publish  # Publish to npm');
