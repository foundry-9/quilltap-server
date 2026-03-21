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
import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, readFileSync, rmSync, copyFileSync } from 'fs';
import { join, resolve, dirname } from 'path';

const PROJECT_ROOT = join(__dirname, '..');
const STAGING_DIR = join(PROJECT_ROOT, '.electron-server-staging');
const NEXT_STANDALONE = join(PROJECT_ROOT, '.next', 'standalone');
const NEXT_STATIC = join(PROJECT_ROOT, '.next', 'static');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');
const PLUGINS_DIST = join(PROJECT_ROOT, 'plugins', 'dist');
const IS_WINDOWS = process.platform === 'win32';

const skipBuild = process.argv.includes('--skip-build');

function run(cmd: string, description: string, env?: NodeJS.ProcessEnv, cwd?: string): void {
  console.log(`> ${description}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: cwd || PROJECT_ROOT, env: env || process.env });
  } catch {
    console.error(`Failed: ${description}`);
    process.exit(1);
  }
}

function copyDir(src: string, dest: string): void {
  cpSync(src, dest, { recursive: true, dereference: true });
}

function dirSize(dir: string): string {
  try {
    if (IS_WINDOWS) {
      // PowerShell: get directory size in human-readable format
      const bytes = execSync(
        `powershell -Command "(Get-ChildItem -Recurse '${dir}' | Measure-Object -Property Length -Sum).Sum"`,
        { encoding: 'utf-8' },
      ).trim();
      const mb = Math.round(parseInt(bytes, 10) / 1024 / 1024);
      return `${mb}M`;
    }
    return execSync(`du -sh "${dir}" | cut -f1`, { encoding: 'utf-8' }).trim();
  } catch {
    return '?';
  }
}

/**
 * Build environment for `next build` on Windows CI.
 *
 * On GitHub Actions Windows runners, the user profile at C:\Users\runneradmin\
 * contains legacy junction points (Application Data, Local Settings, etc.) that
 * have restricted permissions. Next.js file tracing scans these directories
 * during standalone builds and fails with EPERM. Redirecting USERPROFILE to a
 * stub directory within the project prevents the tracer from encountering them.
 */
function getNextBuildEnv(): NodeJS.ProcessEnv {
  if (!IS_WINDOWS || !process.env.CI) {
    return process.env;
  }

  const safeHome = join(PROJECT_ROOT, '.next-build-home');
  mkdirSync(safeHome, { recursive: true });

  console.log(`    [Windows CI] Redirecting USERPROFILE to ${safeHome} for next build`);

  return {
    ...process.env,
    USERPROFILE: safeHome,
    HOME: safeHome,
    APPDATA: join(safeHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(safeHome, 'AppData', 'Local'),
  };
}

// Read root version and Electron version
const rootPackage = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
const version: string = rootPackage.version;

// Resolve installed Electron version for native module rebuild targeting
const electronPackage = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json'), 'utf-8')
);
const electronVersion: string = electronPackage.version;

console.log('==> Building Electron embedded server');
console.log(`    Version:  ${version}`);
console.log(`    Electron: ${electronVersion}`);
console.log(`    Output:   ${STAGING_DIR}`);
console.log('');

// Step 1: Clean staging directory
console.log('==> Step 1/9: Cleaning staging directory');
if (existsSync(STAGING_DIR)) {
  rmSync(STAGING_DIR, { recursive: true, force: true });
}
mkdirSync(STAGING_DIR, { recursive: true });

if (!skipBuild) {
  // Step 2: Build plugins
  console.log('==> Step 2/9: Building plugins');
  run('npm run build:plugins', 'Building plugins');

  // Step 3: Build Next.js standalone
  console.log('==> Step 3/9: Building Next.js (standalone output)');
  run('npx next build --webpack', 'Building Next.js', getNextBuildEnv());
} else {
  console.log('==> Step 2/9: Skipping plugin build (--skip-build)');
  console.log('==> Step 3/9: Skipping Next.js build (--skip-build)');
}

// Verify standalone output exists
if (!existsSync(NEXT_STANDALONE)) {
  console.error('Error: .next/standalone/ not found. Run without --skip-build first.');
  process.exit(1);
}

// Step 4: Copy standalone output + static assets + public files + plugins
console.log('==> Step 4/9: Copying standalone output to staging');
copyDir(NEXT_STANDALONE, STAGING_DIR);

console.log('    Copying .next/static/');
const staticDest = join(STAGING_DIR, '.next', 'static');
mkdirSync(staticDest, { recursive: true });
copyDir(NEXT_STATIC, staticDest);

if (existsSync(PUBLIC_DIR)) {
  console.log('    Copying public/');
  const publicDest = join(STAGING_DIR, 'public');
  mkdirSync(publicDest, { recursive: true });
  copyDir(PUBLIC_DIR, publicDest);
}

if (existsSync(PLUGINS_DIST)) {
  console.log('    Copying plugins/dist/');
  const pluginsDest = join(STAGING_DIR, 'plugins', 'dist');
  mkdirSync(pluginsDest, { recursive: true });
  copyDir(PLUGINS_DIST, pluginsDest);
}

// Reusable cleanup: removes source maps, type declarations, and other files
// that aren't needed at runtime but bloat the package and cause EMFILE during
// macOS codesign. Called after initial copy AND again after npm install steps
// that can reintroduce these files.
const BUILD_ONLY_PACKAGES = ['caniuse-lite', 'browserslist', 'electron'];

function cleanNodeModules(nodeModulesDir: string, label: string): void {
  if (!existsSync(nodeModulesDir)) return;

  console.log(`    Cleaning ${label}...`);
  let removedFiles = 0;

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
          removedFiles++;
        }
      }
    }
  };

  cleanDir(nodeModulesDir);

  // Remove build-time-only packages that Next.js traces but aren't needed at runtime.
  for (const pkg of BUILD_ONLY_PACKAGES) {
    const pkgPath = join(nodeModulesDir, pkg);
    if (existsSync(pkgPath)) {
      rmSync(pkgPath, { recursive: true, force: true });
      console.log(`    Removed build-only package: ${pkg}`);
    }
  }

  console.log(`    Removed ${removedFiles} unnecessary files`);
}

// Step 5: Clean unnecessary files (but keep native modules intact)
console.log('==> Step 5/9: Cleaning unnecessary files');
const standaloneNodeModules = join(STAGING_DIR, 'node_modules');
cleanNodeModules(standaloneNodeModules, 'staging node_modules (initial)');

// Step 6: Rebuild native modules against Electron's Node ABI
console.log('==> Step 6/9: Rebuilding native modules for Electron');

// Verify better-sqlite3 exists in staging before rebuild
const bsqlPath = join(STAGING_DIR, 'node_modules', 'better-sqlite3');
const bsqlNodeFile = join(bsqlPath, 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(bsqlPath)) {
  console.error('    ERROR: better-sqlite3 NOT found in staging node_modules');
  console.error('    Check outputFileTracingIncludes in next.config.js');
  process.exit(1);
}
if (!existsSync(join(bsqlPath, 'binding.gyp'))) {
  console.error('    ERROR: binding.gyp NOT found in better-sqlite3 — cannot rebuild');
  process.exit(1);
}
console.log('    better-sqlite3 found with binding.gyp');

// electron-rebuild can't find this module because the npm alias means the
// directory is named "better-sqlite3" but the package.json says
// "better-sqlite3-multiple-ciphers". Use node-gyp directly with Electron headers.
const electronDistUrl = 'https://electronjs.org/headers';
const targetArch = process.arch;

console.log(`    Rebuilding better-sqlite3 for Electron ${electronVersion} (${targetArch})`);
console.log(`    Using Electron headers from ${electronDistUrl}`);

// node-gyp rebuild targeting Electron's Node ABI
run(
  [
    'npx node-gyp rebuild',
    '--release',
    `--target=${electronVersion}`,
    `--arch=${targetArch}`,
    `--dist-url=${electronDistUrl}`,
    '--build-from-source',
  ].join(' '),
  'Rebuilding better-sqlite3 against Electron Node ABI',
  { ...process.env, HOME: process.env.HOME || '' },
  bsqlPath,  // run from the module directory
);

// Verify the native binary was rebuilt
if (!existsSync(bsqlNodeFile)) {
  console.error('    ERROR: better-sqlite3.node not found after rebuild');
  process.exit(1);
}
console.log('    ✓ better-sqlite3.node rebuilt successfully');

// Step 7/9: Install correct platform-specific sharp binaries
// sharp uses pre-built platform binaries distributed as @img/sharp-{platform}-{arch}.
// When CI builds on Linux and shares artifacts across platforms, only the Linux
// binaries are included. We need to replace them with the correct ones for the
// current build platform.
console.log('==> Step 7/9: Installing platform-specific sharp binaries');

const sharpPlatform = process.platform === 'win32' ? 'win32' : process.platform;
const sharpArch = targetArch;
const sharpPkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'node_modules', 'sharp', 'package.json'), 'utf-8'));
const sharpVersion: string = sharpPkg.version;

// Determine which @img packages we need for this platform
const requiredSharpPackages: { name: string; version: string }[] = [];
const optDeps: Record<string, string> = sharpPkg.optionalDependencies || {};
for (const [name, ver] of Object.entries(optDeps)) {
  // Match packages for our platform/arch (e.g., @img/sharp-darwin-arm64, @img/sharp-libvips-darwin-arm64)
  if (name.includes(`${sharpPlatform}-${sharpArch}`)) {
    requiredSharpPackages.push({ name, version: ver });
  }
}

if (requiredSharpPackages.length === 0) {
  console.warn(`    WARNING: No sharp platform packages found for ${sharpPlatform}-${sharpArch}`);
} else {
  console.log(`    Platform: ${sharpPlatform}-${sharpArch}`);
  console.log(`    Sharp version: ${sharpVersion}`);
  console.log(`    Required packages: ${requiredSharpPackages.map(p => p.name).join(', ')}`);

  // Remove any existing @img platform packages from staging (may be for wrong platform)
  const stagingImgDir = join(STAGING_DIR, 'node_modules', '@img');
  if (existsSync(stagingImgDir)) {
    for (const entry of readdirSync(stagingImgDir)) {
      // Remove platform-specific packages (sharp-linux-x64, sharp-libvips-linux-x64, etc.)
      // Keep non-platform packages like @img/colour
      if (entry.startsWith('sharp-') && !entry.includes(`${sharpPlatform}-${sharpArch}`)) {
        const fullPath = join(stagingImgDir, entry);
        console.log(`    Removing wrong-platform package: @img/${entry}`);
        rmSync(fullPath, { recursive: true, force: true });
      }
    }
  }

  // Install the correct platform packages into staging node_modules
  const installSpecs = requiredSharpPackages.map(p => `${p.name}@${p.version}`).join(' ');
  run(
    `npm install --no-save --no-package-lock --prefix "${STAGING_DIR}" ${installSpecs}`,
    `Installing sharp platform binaries for ${sharpPlatform}-${sharpArch}`,
  );

  // Verify installation
  let allFound = true;
  for (const pkg of requiredSharpPackages) {
    const pkgDir = join(STAGING_DIR, 'node_modules', ...pkg.name.split('/'));
    if (!existsSync(pkgDir)) {
      console.error(`    ERROR: ${pkg.name} not found after install`);
      allFound = false;
    }
  }
  if (allFound) {
    console.log('    ✓ Sharp platform binaries installed successfully');
  } else {
    console.error('    ERROR: Some sharp platform packages failed to install');
    process.exit(1);
  }
}

// Ensure sharp core JS files are in staging (may be missing if CI built on different platform)
const stagingSharpDir = join(STAGING_DIR, 'node_modules', 'sharp');
if (!existsSync(stagingSharpDir)) {
  console.log('    sharp core not in staging, copying from project node_modules');
  const srcSharpDir = join(PROJECT_ROOT, 'node_modules', 'sharp');
  cpSync(srcSharpDir, stagingSharpDir, { recursive: true, dereference: true });
}

// Re-run cleanup: npm install (sharp) and cpSync (sharp core) in steps 6-7 can
// reintroduce .map/.d.ts/.d.mts files that step 5 already removed.
cleanNodeModules(join(STAGING_DIR, 'node_modules'), 'staging node_modules (post-install)');

// Step 8/9: Resolve any remaining symlinks (electron-rebuild or npm may create them)
console.log('==> Step 8/9: Resolving symlinks in staging directory');
let symlinkCount = 0;
function resolveSymlinks(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(fullPath);
      const resolvedTarget = resolve(dirname(fullPath), target);
      rmSync(fullPath);
      if (existsSync(resolvedTarget)) {
        const targetStat = lstatSync(resolvedTarget);
        if (targetStat.isDirectory()) {
          cpSync(resolvedTarget, fullPath, { recursive: true, dereference: true });
        } else {
          copyFileSync(resolvedTarget, fullPath);
        }
        symlinkCount++;
      }
      // If target doesn't exist, the symlink was dangling — just remove it
    } else if (entry.isDirectory()) {
      resolveSymlinks(fullPath);
    }
  }
}
resolveSymlinks(STAGING_DIR);
console.log(`    Resolved ${symlinkCount} symlink(s)`);

// Step 8: Rename node_modules to _modules
// electron-builder has a hardcoded exclusion for "node_modules" in extraResources.
// Renaming to "_modules" bypasses this filter. The embedded server sets NODE_PATH
// to point to this directory so require() still resolves modules correctly.
console.log('==> Step 9/9: Renaming node_modules to _modules (electron-builder workaround)');
const stagingNodeModules = join(STAGING_DIR, 'node_modules');
const stagingModules = join(STAGING_DIR, '_modules');
if (existsSync(stagingNodeModules)) {
  if (existsSync(stagingModules)) {
    rmSync(stagingModules, { recursive: true, force: true });
  }
  cpSync(stagingNodeModules, stagingModules, { recursive: true, dereference: true });
  rmSync(stagingNodeModules, { recursive: true, force: true });
  console.log('    ✓ node_modules → _modules');
} else {
  console.warn('    WARNING: no node_modules found in staging');
}

// Summary
const totalSize = dirSize(STAGING_DIR);
console.log('');
console.log('==> Done!');
console.log(`    Staging: ${STAGING_DIR}`);
console.log(`    Size:    ${totalSize}`);
console.log(`    Version: ${version}`);
console.log('');
console.log('electron-builder will pick up this directory via extraResources.');
