/**
 * Dynamic Plugin Loader
 *
 * Shared utilities for dynamically loading external plugin modules at runtime.
 * Handles peer dependency resolution (React, etc.) so external npm-installed
 * plugins can use the host app's copies of shared dependencies.
 *
 * Used by both provider-registry.ts and search-provider-registry.ts.
 *
 * @module plugins/dynamic-loader
 */

import { logger } from '@/lib/logger';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { PluginManifest } from '@/lib/schemas/plugin-manifest';

// ============================================================================
// DYNAMIC REQUIRE BOOTSTRAP
// ============================================================================

// Dynamic plugin loading requires native Node.js require, not the bundler's.
// - Webpack (dev): provides __non_webpack_require__ for native require access
// - Turbopack (Next.js 16+ production) / plain Node.js: use createRequire from node:module
//   accessed via require('node:module') so webpack sees it as dead code
interface NodeModuleParent {
  filename?: string;
  paths?: string[];
}
interface NodeModuleInternal {
  _resolveFilename: (request: string, parent: NodeModuleParent | null, isMain: boolean, options?: object) => string;
  _nodeModulePaths: (from: string) => string[];
}

let dynamicRequire: NodeRequire;
let Module: NodeModuleInternal;

if (typeof __non_webpack_require__ !== 'undefined') {
  dynamicRequire = __non_webpack_require__;
  Module = __non_webpack_require__('module') as unknown as NodeModuleInternal;
} else {
  const nodeModule = require('node:module');
  dynamicRequire = nodeModule.createRequire(/*turbopackIgnore: true*/ process.cwd() + '/') as NodeRequire;
  Module = nodeModule as unknown as NodeModuleInternal;
}

// Get the app's node_modules path for peer dependency resolution
const appNodeModules = join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules');

// Peer dependencies that external plugins can use from the host app
const PEER_DEPENDENCIES = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
]);

function clearRequireCache(modulePath: string): void {
  try {
    const resolvedPath = dynamicRequire.resolve(/*turbopackIgnore: true*/ modulePath);
    delete dynamicRequire.cache[resolvedPath];
  } catch {
    // Module may not be in cache yet
  }
}

function isExternalPluginPath(pluginPath: string): boolean {
  return pluginPath.includes('node_modules') && !pluginPath.includes(join('plugins', 'dist'));
}

// ============================================================================
// EXTERNAL MODULE LOADING
// ============================================================================

/**
 * Load an external plugin module with peer dependency resolution.
 *
 * Temporarily patches Module._resolveFilename so that when an external plugin
 * (installed via npm) tries to `require('react')` etc., it resolves to the
 * host app's copy rather than failing with MODULE_NOT_FOUND.
 *
 * @param modulePath - Absolute path to the plugin's main JS file
 * @returns The loaded module exports
 */
export function loadExternalPluginModule(modulePath: string): unknown {
  const originalResolveFilename = Module._resolveFilename;
  const appModulePaths = Module._nodeModulePaths(appNodeModules);

  Module._resolveFilename = function(
    request: string,
    parent: { filename?: string; paths?: string[] } | null,
    isMain: boolean,
    options?: object
  ) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      if (PEER_DEPENDENCIES.has(request) && parent?.filename && !parent.filename.includes(join('plugins', 'dist'))) {
        try {
          const fakeParent = {
            filename: join(appNodeModules, 'react', 'index.js'),
            paths: appModulePaths,
          };
          return originalResolveFilename.call(this, request, fakeParent, isMain, options);
        } catch {
          // Fall through
        }
      }
      throw error;
    }
  };

  clearRequireCache(modulePath);

  try {
    return dynamicRequire(/*turbopackIgnore: true*/ modulePath);
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
}

// ============================================================================
// PLUGIN MODULE LOADING
// ============================================================================

/**
 * Load a plugin module from disk, handling both external (npm-installed)
 * and bundled (plugins/dist) plugins.
 *
 * External plugins get peer dependency resolution via loadExternalPluginModule.
 * Bundled plugins are loaded directly with cache clearing.
 *
 * @param pluginPath - Path to the plugin directory
 * @param manifest - The validated plugin manifest
 * @returns The loaded module, or null if the main file was not found
 */
export function loadPluginModule(pluginPath: string, manifest: PluginManifest): unknown | null {
  const mainFile = manifest.main || 'index.js';
  const modulePath = resolve(/*turbopackIgnore: true*/ pluginPath, mainFile);

  if (!existsSync(/*turbopackIgnore: true*/ modulePath)) {
    logger.error('Plugin main file not found', {
      context: 'dynamic-loader',
      plugin: manifest.name,
      expectedPath: modulePath,
    });
    return null;
  }

  // External plugins have paths containing node_modules but not in plugins/dist
  const isExternalPlugin = isExternalPluginPath(pluginPath);

  if (isExternalPlugin) {
    return loadExternalPluginModule(modulePath);
  }

  // Bundled plugin: clear require cache and load directly
  clearRequireCache(modulePath);
  return dynamicRequire(/*turbopackIgnore: true*/ modulePath);
}

/**
 * Extract a named export from a loaded plugin module.
 *
 * Checks both `module.plugin` and `module.default.plugin` patterns,
 * which covers both CommonJS and ESM-transpiled plugin exports.
 *
 * @param pluginModule - The loaded module object
 * @param exportName - The export name to look for (default: 'plugin')
 * @returns The extracted export, or undefined if not found
 */
export function extractPluginExport(pluginModule: unknown, exportName: string = 'plugin'): unknown | undefined {
  const mod = pluginModule as Record<string, unknown>;
  return mod?.[exportName] ?? (mod?.default as Record<string, unknown>)?.[exportName];
}
