/**
 * Theme Bundle Loader
 *
 * Handles validation, installation, uninstallation, and loading of
 * .qtap-theme bundles (logic-free zip archives: theme.json, tokens.json,
 * custom CSS, fonts and images). Only version 2 bundles load; a bundle made
 * for an earlier Quilltap is refused at install and recorded, not registered,
 * when found among the installed themes (lib/themes/refused.ts).
 *
 * @module themes/bundle-loader
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from '@/lib/logger';
import { safeFetch, SafeFetchError } from '@/lib/net/safe-fetch';
import { getThemesDir } from '@/lib/paths';
import { resolveInside } from '@/lib/paths/resolve-inside';
import { getErrorMessage } from '@/lib/error-utils';
import { loadThemeFromDir } from './theme-bundle';
import {
  extractThemeBundle,
  MAX_BUNDLE_SIZE,
  packThemeDirectory,
  validateThemeBundle,
} from './bundle-archive';
import type { CompiledTheme } from './engine';
import { refusalForManifest, type RefusedTheme } from './refused';
import {
  type QtapThemeManifest,
  type ThemeBundleIndex,
  type ThemeBundleIndexEntry,
  ThemeBundleIndexSchema,
  safeValidateQtapThemeManifest,
} from './types';

const bundleLogger = logger.child({ module: 'theme-bundle-loader' });

export { validateThemeBundle, validateThemeDirectory, type ValidationResult } from './bundle-archive';

// ============================================================================
// CONSTANTS
// ============================================================================

const INDEX_FILENAME = 'themes-index.json';

// ============================================================================
// TYPES
// ============================================================================

export interface InstallResult {
  success: boolean;
  themeId?: string;
  version?: string;
  installPath?: string;
  error?: string;
  /** Set when the bundle was refused as made for an earlier Quilltap. */
  refused?: RefusedTheme;
}

export interface UninstallResult {
  success: boolean;
  themeId: string;
  error?: string;
}

/** A loaded bundle, validated and compiled by the theme engine. */
export interface LoadedBundleTheme {
  manifest: QtapThemeManifest;
  compiled: CompiledTheme;
  installPath: string;
  indexEntry: ThemeBundleIndexEntry;
}

/** What a directory of bundles held: themes that load, and themes refused. */
export interface LoadedBundleSet {
  loaded: LoadedBundleTheme[];
  refused: RefusedTheme[];
}

// ============================================================================
// INDEX MANAGEMENT
// ============================================================================

function getIndexPath(): string {
  return path.join(getThemesDir(), INDEX_FILENAME);
}

/** A fresh index entry for a bundle found on disk without one. */
function entryFromDisk(id: string, version: string): ThemeBundleIndexEntry {
  return {
    id,
    version,
    installedAt: new Date().toISOString(),
    source: 'file',
    sourceUrl: null,
    registrySource: null,
    signatureVerified: false,
  };
}

/**
 * Rebuild the index from the installed bundle directories, after the stored
 * one could not be read as an index. Every bundle is recorded as installed
 * from a file; where it came from is not known any more.
 */
async function rebuildIndex(): Promise<ThemeBundleIndex> {
  const themes: ThemeBundleIndexEntry[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(getThemesDir(), { withFileTypes: true }))
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch {
    // No themes directory: an empty index.
  }
  for (const dir of dirs) {
    try {
      const json = JSON.parse(await fs.readFile(path.join(getThemesDir(), dir, 'theme.json'), 'utf-8')) as { id?: unknown; version?: unknown };
      const id = typeof json.id === 'string' ? json.id : dir;
      const version = typeof json.version === 'string' ? json.version : 'unknown';
      themes.push(entryFromDisk(id, version));
    } catch {
      bundleLogger.debug('Skipping a theme directory without a readable theme.json while rebuilding the index', { dir });
    }
  }
  return { version: 1, themes };
}

/**
 * Read themes-index.json through its schema. A missing index is empty; one
 * that is not valid JSON or not an index is rebuilt from the directories and
 * written back.
 */
export async function readIndex(): Promise<ThemeBundleIndex> {
  const indexPath = getIndexPath();
  let data: string;
  try {
    data = await fs.readFile(indexPath, 'utf-8');
  } catch {
    return { version: 1, themes: [] };
  }
  let parsed: ReturnType<typeof ThemeBundleIndexSchema.safeParse> | undefined;
  try {
    parsed = ThemeBundleIndexSchema.safeParse(JSON.parse(data));
  } catch {
    parsed = undefined;
  }
  if (parsed?.success) return parsed.data;
  bundleLogger.warn('Theme bundle index is malformed; rebuilding it from the installed bundles', {
    indexPath,
    issues: parsed && !parsed.success ? parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) : ['not valid JSON'],
  });
  const rebuilt = await rebuildIndex();
  await writeIndex(rebuilt);
  return rebuilt;
}

export async function writeIndex(index: ThemeBundleIndex): Promise<void> {
  const indexPath = getIndexPath();
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  bundleLogger.debug('Theme bundle index updated', { themeCount: index.themes.length });
}

async function addToIndex(entry: ThemeBundleIndexEntry): Promise<void> {
  const index = await readIndex();
  // Remove existing entry for this theme if present
  index.themes = index.themes.filter(t => t.id !== entry.id);
  index.themes.push(entry);
  await writeIndex(index);
}

async function removeFromIndex(themeId: string): Promise<void> {
  const index = await readIndex();
  index.themes = index.themes.filter(t => t.id !== themeId);
  await writeIndex(index);
}

// ============================================================================
// INSTALLATION
// ============================================================================

/**
 * Install a .qtap-theme bundle from a local file path
 */
export async function installThemeBundle(zipPath: string): Promise<InstallResult> {
  bundleLogger.info('Installing theme bundle', { zipPath });

  // Validate first
  const validation = await validateThemeBundle(zipPath);
  if (!validation.valid || !validation.manifest) {
    const errorMsg = validation.errors.join('; ');
    bundleLogger.error('Theme bundle validation failed', { zipPath, errors: validation.errors });
    return { success: false, error: errorMsg, ...(validation.refused ? { refused: validation.refused } : {}) };
  }

  const manifest = validation.manifest;
  const themeId = manifest.id;
  const themesDir = getThemesDir();
  const installPath = path.join(themesDir, themeId);

  try {
    // Remove existing installation if present
    try {
      await fs.rm(installPath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    await extractThemeBundle(zipPath, installPath);

    // Update index
    const indexEntry: ThemeBundleIndexEntry = {
      id: themeId,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      source: 'file',
      sourceUrl: null,
      registrySource: null,
      signatureVerified: false,
    };
    await addToIndex(indexEntry);

    bundleLogger.info('Theme bundle installed successfully', {
      themeId,
      version: manifest.version,
      installPath,
    });

    return {
      success: true,
      themeId,
      version: manifest.version,
      installPath,
    };
  } catch (err) {
    // Clean up on failure
    try {
      await fs.rm(installPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    const errorMsg = getErrorMessage(err);
    bundleLogger.error('Failed to install theme bundle', { zipPath, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Install a .qtap-theme bundle from a URL
 */
export async function installThemeBundleFromUrl(url: string): Promise<InstallResult> {
  bundleLogger.info('Installing theme bundle from URL', { url });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-download-'));
  const tempFile = path.join(tempDir, 'theme.qtap-theme');

  try {
    // Download the file (public destinations only, body capped while streaming)
    let response;
    try {
      response = await safeFetch(url, { maxBytes: MAX_BUNDLE_SIZE, timeoutMs: 60_000 });
    } catch (err) {
      if (err instanceof SafeFetchError && err.code === 'TOO_LARGE') {
        return { success: false, error: `Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB` };
      }
      throw err;
    }
    if (!response.ok) {
      return { success: false, error: `Download failed: HTTP ${response.status}` };
    }

    await fs.writeFile(tempFile, response.body);

    // Install from local file
    const result = await installThemeBundle(tempFile);
    if (result.success) {
      // Update index to reflect URL source
      const index = await readIndex();
      const entry = index.themes.find(t => t.id === result.themeId);
      if (entry) {
        entry.source = 'url';
        entry.sourceUrl = url;
        await writeIndex(index);
      }
    }

    return result;
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    bundleLogger.error('Failed to install theme from URL', { url, error: errorMsg });
    return { success: false, error: errorMsg };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// ============================================================================
// UNINSTALLATION
// ============================================================================

/**
 * Uninstall a theme bundle
 */
export async function uninstallThemeBundle(themeId: string): Promise<UninstallResult> {
  bundleLogger.info('Uninstalling theme bundle', { themeId });

  try {
    const themesDir = getThemesDir();
    const installPath = await resolveInside(themesDir, themeId, { realpath: true });
    // One segment directly under the themes directory, never a nested path.
    // resolveInside returns the lexical path, so compare it with the lexical base.
    if (path.dirname(installPath) !== path.resolve(themesDir)) {
      return { success: false, themeId, error: 'Theme not found' };
    }

    // Check if theme exists
    try {
      await fs.access(installPath);
    } catch {
      return { success: false, themeId, error: 'Theme not found' };
    }

    // Remove theme directory
    await fs.rm(installPath, { recursive: true, force: true });

    // Update index
    await removeFromIndex(themeId);

    bundleLogger.info('Theme bundle uninstalled successfully', { themeId });
    return { success: true, themeId };
  } catch (err) {
    const errorMsg = getErrorMessage(err);
    bundleLogger.error('Failed to uninstall theme bundle', { themeId, error: errorMsg });
    return { success: false, themeId, error: errorMsg };
  }
}

// ============================================================================
// LOADING
// ============================================================================

/**
 * Load every bundle directory under `dir`. A bundle made for an earlier
 * Quilltap is returned as refused, never loaded; an invalid one is logged and
 * skipped.
 */
async function loadBundlesFromDir(
  dir: string,
  entryFor: (id: string, version: string) => ThemeBundleIndexEntry,
  label: string
): Promise<LoadedBundleSet> {
  const set: LoadedBundleSet = { loaded: [], refused: [] };

  let entries: string[];
  try {
    const dirEntries = await fs.readdir(dir, { withFileTypes: true });
    entries = dirEntries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch (err) {
    bundleLogger.debug(`No ${label} directory to read`, { dir, error: getErrorMessage(err) });
    return set;
  }

  for (const themeDir of entries) {
    const themePath = path.join(dir, themeDir);
    try {
      let manifestData: string;
      try {
        manifestData = await fs.readFile(await resolveInside(themePath, 'theme.json', { realpath: true }), 'utf-8');
      } catch {
        bundleLogger.debug(`Skipping ${label} directory without theme.json`, { themeDir });
        continue;
      }
      const manifestJson: unknown = JSON.parse(manifestData);

      const refused = refusalForManifest(manifestJson, themeDir);
      if (refused) {
        bundleLogger.warn(`Refusing ${label} made for an earlier Quilltap`, { themeDir, themeId: refused.id, version: refused.version });
        // Keyed by its directory, which is what uninstall removes.
        set.refused.push({ ...refused, id: themeDir });
        continue;
      }

      const manifestResult = safeValidateQtapThemeManifest(manifestJson);
      if (!manifestResult.success) {
        bundleLogger.warn(`Invalid theme.json in ${label}`, {
          themeDir,
          errors: manifestResult.errors.issues.map(e => `${e.path.join('.')}: ${e.message}`),
        });
        continue;
      }

      const { document, compiled } = await loadThemeFromDir(themePath, manifestJson);
      set.loaded.push({
        manifest: document.manifest,
        compiled,
        installPath: themePath,
        indexEntry: entryFor(document.manifest.id, document.manifest.version),
      });
      bundleLogger.debug(`Loaded ${label}`, { themeId: document.manifest.id, version: document.manifest.version });
    } catch (err) {
      bundleLogger.warn(`Failed to load ${label}`, { themeDir, error: getErrorMessage(err) });
    }
  }

  bundleLogger.info(`${label[0].toUpperCase()}${label.slice(1)}s loaded`, { dir, count: set.loaded.length, refused: set.refused.length });
  return set;
}

/** Load all installed theme bundles (the data directory's themes). */
export async function loadInstalledBundles(): Promise<LoadedBundleSet> {
  const index = await readIndex();
  return loadBundlesFromDir(
    getThemesDir(),
    (id, version) => index.themes.find(t => t.id === id) ?? entryFromDisk(id, version),
    'installed theme bundle'
  );
}

/** Load the themes shipped with the app from `dir`. */
export async function loadBundledThemesFromDir(dir: string): Promise<LoadedBundleSet> {
  return loadBundlesFromDir(dir, entryFromDisk, 'bundled theme');
}

/**
 * Export an installed theme: the bundle exactly as installed (theme.json,
 * tokens.json, custom CSS, assets), zipped. Symbolic links are not followed.
 */
export async function exportThemeAsBundle(themeId: string, installPath: string, outputPath: string): Promise<void> {
  bundleLogger.info('Exporting theme as bundle', { themeId, outputPath });
  await packThemeDirectory(installPath, outputPath);
  bundleLogger.info('Theme exported', { themeId, outputPath });
}
