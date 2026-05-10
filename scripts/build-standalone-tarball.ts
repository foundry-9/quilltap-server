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
console.log('==> Step 1/8: Cleaning staging directory');
if (existsSync(STAGING_DIR)) {
  rmSync(STAGING_DIR, { recursive: true, force: true });
}
mkdirSync(STAGING_DIR, { recursive: true });

if (!skipBuild) {
  // Step 2: Build plugins
  console.log('==> Step 2/8: Building plugins');
  run('npm run build:plugins', 'Building plugins');

  // Step 3: Build Next.js standalone
  console.log('==> Step 3/8: Building Next.js (standalone output)');
  run('npx next build', 'Building Next.js');
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
console.log('==> Step 4/8: Copying .next/standalone/ to staging');
copyDir(`${NEXT_STANDALONE}/.`, STAGING_DIR);

// Step 4.5: Compile server.ts and overwrite Next's generated server.js
//
// We bundle local imports (so ./lib/logger gets inlined) but keep node_modules
// deps external (--packages=external) so they resolve from the staged
// node_modules at runtime. ./lib/terminal/ws is kept external on purpose: it
// pulls in node-pty at module load, and server.ts loads it dynamically only
// when a terminal upgrade arrives. We compile it as a separate sibling file
// so the dynamic import resolves at runtime.
//
// The bundle goes to server-impl.js. server.js itself is a tiny bootstrapper
// that sets __NEXT_PRIVATE_STANDALONE_CONFIG before requiring the bundle —
// without it, Next's loadWebpackHook throws because next/dist/compiled/webpack
// isn't traced into the standalone output.
console.log('==> Step 5/8: Compiling server.ts to custom server');
const esbuildBase = '--platform=node --target=node24 --format=cjs --bundle --packages=external --tsconfig=tsconfig.json';
run(
  `npx esbuild server.ts ${esbuildBase} --external:./lib/terminal/ws --outfile="${join(STAGING_DIR, 'server-impl.js')}"`,
  'Compiling server.ts with esbuild',
);
run(
  `npx esbuild lib/terminal/ws.ts ${esbuildBase} --outfile="${join(STAGING_DIR, 'lib', 'terminal', 'ws.js')}"`,
  'Compiling lib/terminal/ws.ts with esbuild',
);
// Compile the background-jobs child entry. The host forks this file via
// child_process.fork; in standalone there's no tsx loader to handle the .ts
// source or its @/ path aliases, so the child crashes on import resolution.
// Bundling here inlines the handler graph (handlers/index.ts re-exports all
// 18 handlers) while keeping npm deps external for the staged node_modules.
run(
  `npx esbuild lib/background-jobs/child/child-entry.ts ${esbuildBase} --outfile="${join(STAGING_DIR, 'lib', 'background-jobs', 'child', 'child-entry.js')}"`,
  'Compiling lib/background-jobs/child/child-entry.ts with esbuild',
);

// Bootstrap shim is shared with the local Dockerfile and CI release workflow;
// see scripts/standalone-server-bootstrap.js for the source of truth.
const bootstrapJs = readFileSync(join(PROJECT_ROOT, 'scripts', 'standalone-server-bootstrap.js'), 'utf-8');
writeFileSync(join(STAGING_DIR, 'server.js'), bootstrapJs);

// Step 6: Copy static assets and public files
console.log('==> Step 6/8: Copying static assets and public files');
const staticDest = join(STAGING_DIR, '.next', 'static');
mkdirSync(staticDest, { recursive: true });
copyDir(`${NEXT_STATIC}/.`, staticDest);

if (existsSync(PUBLIC_DIR)) {
  const publicDest = join(STAGING_DIR, 'public');
  mkdirSync(publicDest, { recursive: true });
  copyDir(`${PUBLIC_DIR}/.`, publicDest);
}

// Step 7: Copy bundled plugins and strip native modules
console.log('==> Step 7/8: Copying plugins and stripping native modules');
if (existsSync(PLUGINS_DIST)) {
  const pluginsDest = join(STAGING_DIR, 'plugins', 'dist');
  mkdirSync(pluginsDest, { recursive: true });
  copyDir(`${PLUGINS_DIST}/.`, pluginsDest);
}

const standaloneNodeModules = join(STAGING_DIR, 'node_modules');
if (existsSync(standaloneNodeModules)) {
  // Remove native-only modules — they'll be resolved from the npm package's node_modules.
  // NOTE: sharp's JS wrapper and its pure-JS dependency @img/colour are kept in the
  // tarball. Only the platform-specific native binaries (@img/sharp-*, @img/sharp-libvips-*)
  // and platform-specific native modules (better-sqlite3, node-pty) are stripped.
  // They're reinstalled on the user's machine via npm install, which compiles them for the target platform.
  const nativeModulesToStrip = ['better-sqlite3', 'node-pty'];
  for (const mod of nativeModulesToStrip) {
    const modPath = join(standaloneNodeModules, mod);
    if (existsSync(modPath)) {
      rmSync(modPath, { recursive: true, force: true });
      console.log(`    Stripped: ${mod}`);
    }
  }

  // Strip native .node binaries from sharp (keep JS wrapper)
  const sharpBuildDir = join(standaloneNodeModules, 'sharp', 'build');
  if (existsSync(sharpBuildDir)) {
    rmSync(sharpBuildDir, { recursive: true, force: true });
    console.log('    Stripped: sharp/build (native binaries)');
  }
  const sharpPrebuildsDir = join(standaloneNodeModules, 'sharp', 'prebuilds');
  if (existsSync(sharpPrebuildsDir)) {
    rmSync(sharpPrebuildsDir, { recursive: true, force: true });
    console.log('    Stripped: sharp/prebuilds (native binaries)');
  }

  // Remove @img/sharp-* platform-specific native packages but keep @img/colour (pure JS)
  const imgDir = join(standaloneNodeModules, '@img');
  if (existsSync(imgDir)) {
    for (const entry of readdirSync(imgDir)) {
      if (entry.startsWith('sharp-')) {
        const entryPath = join(imgDir, entry);
        rmSync(entryPath, { recursive: true, force: true });
        console.log(`    Stripped: @img/${entry}`);
      }
    }
  }

  // Remove @napi-rs/canvas-* platform-specific native packages but keep the JS
  // wrapper (@napi-rs/canvas) and pure-JS siblings like @napi-rs/wasm-runtime.
  const napiDir = join(standaloneNodeModules, '@napi-rs');
  if (existsSync(napiDir)) {
    for (const entry of readdirSync(napiDir)) {
      if (entry.startsWith('canvas-')) {
        const entryPath = join(napiDir, entry);
        rmSync(entryPath, { recursive: true, force: true });
        console.log(`    Stripped: @napi-rs/${entry}`);
      }
    }
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

// Step 8: Create tarball
console.log('==> Step 8/8: Creating tarball');
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
