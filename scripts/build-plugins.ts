#!/usr/bin/env tsx
/**
 * Build Plugins Script
 *
 * Builds all TypeScript plugins by running `npm run build` in each plugin directory.
 * Each plugin is responsible for its own build configuration (esbuild.config.mjs).
 *
 * Usage:
 *   npm run build:plugins
 *   tsx scripts/build-plugins.ts
 *
 * Options:
 *   --install    Run npm install in each plugin directory before building
 *   --parallel   Build plugins in parallel (faster but harder to debug)
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { findForeignResolutions, formatResolutionViolations } from './lib/plugin-resolution-guard';

interface PluginManifest {
  name: string;
  main?: string;
  typescript?: boolean;
}

interface BuildResult {
  name: string;
  success: boolean;
  error?: string;
  skipped?: boolean;
}

const args = process.argv.slice(2);
const shouldInstall = args.includes('--install');
const runParallel = args.includes('--parallel');

/**
 * Discover all TypeScript plugins in the plugins/dist directory
 */
function discoverPlugins(): Array<{ name: string; path: string }> {
  const cwd = process.cwd();
  const pluginsDir = join(cwd, 'plugins', 'dist');
  const plugins: Array<{ name: string; path: string }> = [];

  try {
    const entries = readdirSync(pluginsDir);

    for (const entry of entries) {
      const fullPath = join(pluginsDir, entry);

      if (!statSync(fullPath).isDirectory()) {
        continue;
      }

      // Check for manifest.json with typescript: true
      const manifestPath = join(fullPath, 'manifest.json');
      try {
        const manifestContent = readFileSync(manifestPath, 'utf-8');
        const manifest: PluginManifest = JSON.parse(manifestContent);

        if (manifest.typescript) {
          plugins.push({
            name: manifest.name || entry,
            path: fullPath,
          });
        }
      } catch {
        // Skip plugins without valid manifest
      }
    }

    return plugins;
  } catch (err) {
    console.error('Failed to discover plugins:', err);
    return [];
  }
}

/**
 * Check if a plugin has a build script in package.json
 */
function hasBuildScript(pluginPath: string): boolean {
  const packageJsonPath = join(pluginPath, 'package.json');
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return !!pkg.scripts?.build;
  } catch {
    return false;
  }
}

/**
 * Check if a plugin has a typecheck script in package.json
 */
function hasTypecheckScript(pluginPath: string): boolean {
  const packageJsonPath = join(pluginPath, 'package.json');
  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return !!pkg.scripts?.typecheck;
  } catch {
    return false;
  }
}

/**
 * After a plugin typechecks, make sure it typechecked against its *own* copy of
 * every dependency it declares (#145). Runs `tsc --explainFiles` once more and
 * resolves to an error message, or null when every declared dependency came
 * from the plugin's own node_modules. Skipped for plugins with no typecheck.
 */
function checkPluginResolution(plugin: { name: string; path: string }): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const { name, path: pluginPath } = plugin;
    if (!hasTypecheckScript(pluginPath)) {
      resolvePromise(null);
      return;
    }

    let dependencies: string[] = [];
    try {
      const pkg = JSON.parse(readFileSync(join(pluginPath, 'package.json'), 'utf-8'));
      dependencies = Object.keys(pkg.dependencies ?? {});
    } catch {
      resolvePromise(null);
      return;
    }
    if (dependencies.length === 0) {
      resolvePromise(null);
      return;
    }

    const tsc = spawn('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit', '--explainFiles'], {
      cwd: pluginPath,
      stdio: 'pipe',
    });
    let output = '';
    tsc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    tsc.stderr?.on('data', (data) => {
      output += data.toString();
    });
    tsc.on('close', (code) => {
      if (code !== 0) {
        resolvePromise(`${name}: tsc --explainFiles exited ${code}\n${output.slice(-2000)}`);
        return;
      }
      const violations = findForeignResolutions(output, pluginPath, dependencies);
      resolvePromise(violations.length > 0 ? formatResolutionViolations(name, violations) : null);
    });
    tsc.on('error', (err) => {
      resolvePromise(`${name}: could not run tsc --explainFiles: ${err.message}`);
    });
  });
}

/**
 * Check if a plugin needs npm install (no node_modules or package-lock.json changed)
 */
function needsInstall(pluginPath: string): boolean {
  const nodeModulesPath = join(pluginPath, 'node_modules');
  return !existsSync(nodeModulesPath);
}

/**
 * Build a single plugin
 */
async function buildPlugin(plugin: { name: string; path: string }): Promise<BuildResult> {
  const { name, path: pluginPath } = plugin;

  // Check if plugin has a build script
  if (!hasBuildScript(pluginPath)) {
    return { name, success: true, skipped: true };
  }

  try {
    // Install dependencies if needed
    if (shouldInstall || needsInstall(pluginPath)) {
      console.log(`  📦 Installing dependencies for ${name}...`);
      execSync('npm install', {
        cwd: pluginPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    }

    // Typecheck before building. esbuild strips types without checking them, so
    // this is the only thing standing between a type error and a shipped bundle
    // — the root tsconfig.json excludes `plugins` entirely.
    if (hasTypecheckScript(pluginPath)) {
      console.log(`  🔎 Typechecking ${name}...`);
      execSync('npm run typecheck', {
        cwd: pluginPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      const resolutionError = await checkPluginResolution(plugin);
      if (resolutionError) {
        return { name, success: false, error: resolutionError };
      }
    }

    // Run the build
    console.log(`  🔨 Building ${name}...`);
    execSync('npm run build', {
      cwd: pluginPath,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    return { name, success: true };
  } catch (err) {
    // execSync's error carries the child's output on .stdout/.stderr; without
    // them the report is just "Command failed", which hides the tsc diagnostics
    // that say what actually broke.
    const piped = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    const details = [piped?.stdout, piped?.stderr]
      .map((chunk) => (chunk ? chunk.toString().trim() : ''))
      .filter(Boolean)
      .join('\n');
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { name, success: false, error: details || errorMessage };
  }
}

/**
 * Build a plugin using spawn (for parallel execution)
 */
function buildPluginAsync(plugin: { name: string; path: string }): Promise<BuildResult> {
  return new Promise((resolve) => {
    const { name, path: pluginPath } = plugin;

    if (!hasBuildScript(pluginPath)) {
      resolve({ name, success: true, skipped: true });
      return;
    }

    // Check if needs install
    const installFirst = shouldInstall || needsInstall(pluginPath);

    const runBuild = () => {
      const build = spawn('npm', ['run', 'build'], {
        cwd: pluginPath,
        stdio: 'pipe',
      });

      let stderr = '';
      build.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      build.on('close', (code) => {
        if (code === 0) {
          resolve({ name, success: true });
        } else {
          resolve({ name, success: false, error: stderr || `Exit code ${code}` });
        }
      });

      build.on('error', (err) => {
        resolve({ name, success: false, error: err.message });
      });
    };

    // Same gate as the serial path — otherwise --parallel would ship type
    // errors that a normal build refuses. tsc writes diagnostics to stdout.
    const runTypecheck = (onPass: () => void) => {
      if (!hasTypecheckScript(pluginPath)) {
        onPass();
        return;
      }

      const check = spawn('npm', ['run', 'typecheck'], {
        cwd: pluginPath,
        stdio: 'pipe',
      });

      let output = '';
      check.stdout?.on('data', (data) => {
        output += data.toString();
      });
      check.stderr?.on('data', (data) => {
        output += data.toString();
      });

      check.on('close', (code) => {
        if (code === 0) {
          void checkPluginResolution(plugin).then((resolutionError) => {
            if (resolutionError) {
              resolve({ name, success: false, error: resolutionError });
            } else {
              onPass();
            }
          });
        } else {
          resolve({ name, success: false, error: output || `Typecheck exit code ${code}` });
        }
      });

      check.on('error', (err) => {
        resolve({ name, success: false, error: err.message });
      });
    };

    if (installFirst) {
      const install = spawn('npm', ['install'], {
        cwd: pluginPath,
        stdio: 'pipe',
      });

      install.on('close', (code) => {
        if (code === 0) {
          runTypecheck(runBuild);
        } else {
          resolve({ name, success: false, error: 'npm install failed' });
        }
      });

      install.on('error', (err) => {
        resolve({ name, success: false, error: `npm install error: ${err.message}` });
      });
    } else {
      runTypecheck(runBuild);
    }
  });
}

/**
 * Main build function
 */
async function main() {
  console.log('🔨 Building TypeScript plugins...\n');

  if (shouldInstall) {
    console.log('  --install flag: Will run npm install in each plugin\n');
  }

  const plugins = discoverPlugins();

  if (plugins.length === 0) {
    console.log('No TypeScript plugins found to build.');
    return;
  }

  console.log(`Found ${plugins.length} TypeScript plugin(s) to build:\n`);
  for (const plugin of plugins) {
    console.log(`  - ${plugin.name}`);
  }
  console.log('');

  let results: BuildResult[];

  if (runParallel) {
    console.log('Building in parallel...\n');
    results = await Promise.all(plugins.map(buildPluginAsync));
  } else {
    results = [];
    for (const plugin of plugins) {
      const result = await buildPlugin(plugin);
      results.push(result);
    }
  }

  // Summary
  const succeeded = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;

  console.log('\n📊 Build Summary:');
  console.log(`  Total:     ${plugins.length}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Skipped:   ${skipped} (no build script)`);
  console.log(`  Failed:    ${failed}`);

  if (failed > 0) {
    console.error('\n❌ Some plugins failed to build:');
    for (const result of results) {
      if (!result.success) {
        console.error(`  - ${result.name}: ${result.error?.substring(0, 2000)}`);
      }
    }
    process.exit(1);
  }

  console.log('\n✅ All plugins built successfully!');
}

main().catch((err) => {
  console.error('Fatal error building plugins:', err);
  process.exit(1);
});
