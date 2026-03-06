/**
 * Theme Bundle Loader
 *
 * Handles validation, installation, uninstallation, and loading of
 * .qtap-theme bundles (logic-free zip archives containing CSS, JSON tokens, and fonts).
 *
 * @module themes/bundle-loader
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yauzl from 'yauzl';
import { logger } from '@/lib/logger';
import { getThemesDir } from '@/lib/paths';
import { getErrorMessage } from '@/lib/errors';
import {
  type QtapThemeManifest,
  type ThemeBundleIndex,
  type ThemeBundleIndexEntry,
  type ThemeTokens,
  safeValidateQtapThemeManifest,
  safeValidateThemeTokens,
} from './types';

const bundleLogger = logger.child({ module: 'theme-bundle-loader' });

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB total
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILE_COUNT = 200;
const INDEX_FILENAME = 'themes-index.json';

const ALLOWED_EXTENSIONS = new Set([
  '.json', '.css',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.txt', '.md', '.license',
]);

const BLOCKED_EXTENSIONS = new Set([
  '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx',
  '.wasm', '.sh', '.bash', '.bat', '.cmd', '.ps1', '.exe',
  '.dll', '.so', '.dylib', '.py', '.rb', '.php',
]);

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  manifest?: QtapThemeManifest;
  errors: string[];
  warnings: string[];
  fileCount: number;
  totalSize: number;
}

export interface InstallResult {
  success: boolean;
  themeId?: string;
  version?: string;
  installPath?: string;
  error?: string;
}

export interface UninstallResult {
  success: boolean;
  themeId: string;
  error?: string;
}

export interface LoadedBundleTheme {
  manifest: QtapThemeManifest;
  tokens: ThemeTokens;
  cssOverrides?: string;
  installPath: string;
  indexEntry: ThemeBundleIndexEntry;
}

// ============================================================================
// INDEX MANAGEMENT
// ============================================================================

function getIndexPath(): string {
  return path.join(getThemesDir(), INDEX_FILENAME);
}

async function readIndex(): Promise<ThemeBundleIndex> {
  const indexPath = getIndexPath();
  try {
    const data = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(data) as ThemeBundleIndex;
  } catch {
    return { version: 1, themes: [] };
  }
}

async function writeIndex(index: ThemeBundleIndex): Promise<void> {
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
// ZIP EXTRACTION UTILITIES
// ============================================================================

interface ZipEntry {
  fileName: string;
  uncompressedSize: number;
  isDirectory: boolean;
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
      if (err) reject(err);
      else resolve(zipFile!);
    });
  });
}

function readZipEntries(zipFile: yauzl.ZipFile): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: ZipEntry[] = [];
    zipFile.readEntry();
    zipFile.on('entry', (entry: yauzl.Entry) => {
      entries.push({
        fileName: entry.fileName,
        uncompressedSize: entry.uncompressedSize,
        isDirectory: /\/$/.test(entry.fileName),
      });
      zipFile.readEntry();
    });
    zipFile.on('end', () => resolve(entries));
    zipFile.on('error', reject);
  });
}

function extractZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, readStream) => {
      if (err) {
        reject(err);
        return;
      }
      const chunks: Buffer[] = [];
      readStream!.on('data', (chunk: Buffer) => chunks.push(chunk));
      readStream!.on('end', () => resolve(Buffer.concat(chunks)));
      readStream!.on('error', reject);
    });
  });
}

async function extractZipToDir(zipPath: string, destDir: string): Promise<void> {
  const zipFile = await openZip(zipPath);

  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.readEntry();
      zipFile.on('entry', async (entry: yauzl.Entry) => {
        try {
          const entryPath = path.join(destDir, entry.fileName);

          // Security: prevent path traversal
          if (!entryPath.startsWith(destDir + path.sep) && entryPath !== destDir) {
            reject(new Error(`Path traversal detected: ${entry.fileName}`));
            return;
          }

          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            await fs.mkdir(entryPath, { recursive: true });
            zipFile.readEntry();
          } else {
            // File entry
            await fs.mkdir(path.dirname(entryPath), { recursive: true });
            const data = await extractZipEntry(zipFile, entry);
            await fs.writeFile(entryPath, data);
            zipFile.readEntry();
          }
        } catch (err) {
          reject(err);
        }
      });
      zipFile.on('end', resolve);
      zipFile.on('error', reject);
    });
  } finally {
    zipFile.close();
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a .qtap-theme bundle file
 */
export async function validateThemeBundle(zipPath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fileCount = 0;
  let totalSize = 0;

  bundleLogger.debug('Validating theme bundle', { zipPath });

  // Check file exists and size
  try {
    const stat = await fs.stat(zipPath);
    if (stat.size > MAX_BUNDLE_SIZE) {
      errors.push(`Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB`);
      return { valid: false, errors, warnings, fileCount: 0, totalSize: stat.size };
    }
    totalSize = stat.size;
  } catch {
    errors.push('Bundle file not found or not readable');
    return { valid: false, errors, warnings, fileCount: 0, totalSize: 0 };
  }

  // Open and validate zip structure
  let zipFile: yauzl.ZipFile;
  try {
    zipFile = await openZip(zipPath);
  } catch (err) {
    errors.push(`Invalid zip file: ${getErrorMessage(err)}`);
    return { valid: false, errors, warnings, fileCount: 0, totalSize };
  }

  try {
    const entries = await readZipEntries(zipFile);
    fileCount = entries.filter(e => !e.isDirectory).length;

    // Check file count limit
    if (fileCount > MAX_FILE_COUNT) {
      errors.push(`Bundle contains ${fileCount} files, exceeding limit of ${MAX_FILE_COUNT}`);
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    // Validate each entry
    let hasThemeJson = false;
    let totalUncompressed = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      // Check for path traversal
      if (entry.fileName.includes('..') || path.isAbsolute(entry.fileName)) {
        errors.push(`Unsafe path detected: ${entry.fileName}`);
        continue;
      }

      // Check for symlinks (yauzl doesn't extract symlinks by default, but be explicit)
      // yauzl handles this safely

      // Check file size
      if (entry.uncompressedSize > MAX_FILE_SIZE) {
        errors.push(`File ${entry.fileName} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      }
      totalUncompressed += entry.uncompressedSize;

      // Check extension
      const ext = path.extname(entry.fileName).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        errors.push(`Blocked file type: ${entry.fileName} (${ext} files are not allowed)`);
      } else if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
        warnings.push(`Unrecognized file type: ${entry.fileName} (${ext})`);
      }

      // Track theme.json
      if (entry.fileName === 'theme.json' || entry.fileName.endsWith('/theme.json')) {
        hasThemeJson = true;
      }
    }

    // Check total uncompressed size (zip bomb protection)
    if (totalUncompressed > MAX_BUNDLE_SIZE * 10) {
      errors.push('Suspicious compression ratio detected (potential zip bomb)');
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    if (!hasThemeJson) {
      errors.push('Bundle must contain a theme.json file');
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    if (errors.length > 0) {
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    // Extract to temp dir for manifest validation
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-validate-'));
    try {
      await extractZipToDir(zipPath, tempDir);

      // Find and validate theme.json
      const manifest = await findAndValidateManifest(tempDir, errors, warnings);
      if (!manifest) {
        return { valid: false, errors, warnings, fileCount, totalSize };
      }

      // Validate tokens if referenced by path
      if (manifest.tokensPath) {
        const tokensFilePath = path.join(tempDir, manifest.tokensPath);
        try {
          const tokensData = await fs.readFile(tokensFilePath, 'utf-8');
          const tokensJson = JSON.parse(tokensData);
          const tokensResult = safeValidateThemeTokens(tokensJson);
          if (!tokensResult.success) {
            errors.push(`Invalid tokens in ${manifest.tokensPath}: ${tokensResult.errors.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
          }
        } catch (err) {
          errors.push(`Failed to read tokens file ${manifest.tokensPath}: ${getErrorMessage(err)}`);
        }
      }

      // Validate referenced font files exist
      if (manifest.fonts) {
        for (const font of manifest.fonts) {
          const fontPath = path.join(tempDir, font.src);
          try {
            await fs.access(fontPath);
          } catch {
            errors.push(`Font file not found: ${font.src}`);
          }
        }
      }

      // Validate preview image exists if referenced
      if (manifest.previewImage) {
        const previewPath = path.join(tempDir, manifest.previewImage);
        try {
          await fs.access(previewPath);
        } catch {
          warnings.push(`Preview image not found: ${manifest.previewImage}`);
        }
      }

      return {
        valid: errors.length === 0,
        manifest: errors.length === 0 ? manifest : undefined,
        errors,
        warnings,
        fileCount,
        totalSize,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    zipFile.close();
  }
}

async function findAndValidateManifest(
  dir: string,
  errors: string[],
  warnings: string[]
): Promise<QtapThemeManifest | null> {
  // Look for theme.json at root level
  const themeJsonPath = path.join(dir, 'theme.json');
  let manifestPath = themeJsonPath;

  try {
    await fs.access(themeJsonPath);
  } catch {
    // Look in subdirectories (some zips have a root folder)
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const subdirs = entries.filter(e => e.isDirectory());
    let found = false;
    for (const subdir of subdirs) {
      const subPath = path.join(dir, subdir.name, 'theme.json');
      try {
        await fs.access(subPath);
        manifestPath = subPath;
        found = true;
        break;
      } catch {
        continue;
      }
    }
    if (!found) {
      errors.push('theme.json not found in bundle');
      return null;
    }
  }

  try {
    const manifestData = await fs.readFile(manifestPath, 'utf-8');
    const manifestJson = JSON.parse(manifestData);
    const result = safeValidateQtapThemeManifest(manifestJson);

    if (!result.success) {
      for (const issue of result.errors.issues) {
        errors.push(`theme.json validation error: ${issue.path.join('.')}: ${issue.message}`);
      }
      return null;
    }

    return result.data;
  } catch (err) {
    errors.push(`Failed to parse theme.json: ${getErrorMessage(err)}`);
    return null;
  }
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
    return { success: false, error: errorMsg };
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

    // Create theme directory
    await fs.mkdir(installPath, { recursive: true });

    // Extract bundle
    await extractZipToDir(zipPath, installPath);

    // If theme.json is in a subdirectory, move contents up
    const directThemeJson = path.join(installPath, 'theme.json');
    try {
      await fs.access(directThemeJson);
    } catch {
      // Find and move from subdirectory
      const entries = await fs.readdir(installPath, { withFileTypes: true });
      const subdirs = entries.filter(e => e.isDirectory());
      for (const subdir of subdirs) {
        const subThemeJson = path.join(installPath, subdir.name, 'theme.json');
        try {
          await fs.access(subThemeJson);
          // Move all contents from subdir to installPath
          const subPath = path.join(installPath, subdir.name);
          const subEntries = await fs.readdir(subPath);
          for (const entry of subEntries) {
            await fs.rename(
              path.join(subPath, entry),
              path.join(installPath, entry)
            );
          }
          await fs.rmdir(subPath);
          break;
        } catch {
          continue;
        }
      }
    }

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
    // Download the file
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `Download failed: HTTP ${response.status}` };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_BUNDLE_SIZE) {
      return { success: false, error: `Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB` };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BUNDLE_SIZE) {
      return { success: false, error: `Bundle exceeds maximum size of ${MAX_BUNDLE_SIZE / 1024 / 1024}MB` };
    }

    await fs.writeFile(tempFile, Buffer.from(arrayBuffer));

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

  const installPath = path.join(getThemesDir(), themeId);

  try {
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
 * Load all installed theme bundles
 */
export async function loadInstalledBundles(): Promise<LoadedBundleTheme[]> {
  const themesDir = getThemesDir();
  const loaded: LoadedBundleTheme[] = [];

  bundleLogger.debug('Loading installed theme bundles', { themesDir });

  // Read index
  const index = await readIndex();

  // Check themes directory exists
  try {
    await fs.access(themesDir);
  } catch {
    bundleLogger.debug('Themes directory does not exist yet', { themesDir });
    return loaded;
  }

  // Read theme directories
  let entries: string[];
  try {
    const dirEntries = await fs.readdir(themesDir, { withFileTypes: true });
    entries = dirEntries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch (err) {
    bundleLogger.warn('Failed to read themes directory', { error: getErrorMessage(err) });
    return loaded;
  }

  for (const themeDir of entries) {
    const themePath = path.join(themesDir, themeDir);
    const themeJsonPath = path.join(themePath, 'theme.json');

    try {
      // Check theme.json exists
      await fs.access(themeJsonPath);

      // Read and validate manifest
      const manifestData = await fs.readFile(themeJsonPath, 'utf-8');
      const manifestJson = JSON.parse(manifestData);
      const manifestResult = safeValidateQtapThemeManifest(manifestJson);

      if (!manifestResult.success) {
        bundleLogger.warn('Invalid theme.json in bundle', {
          themeDir,
          errors: manifestResult.errors.issues.map(e => e.message),
        });
        continue;
      }

      const manifest = manifestResult.data;

      // Load tokens
      let tokens: ThemeTokens;
      if (manifest.tokens) {
        tokens = manifest.tokens;
      } else if (manifest.tokensPath) {
        const tokensPath = path.join(themePath, manifest.tokensPath);
        const tokensData = await fs.readFile(tokensPath, 'utf-8');
        const tokensJson = JSON.parse(tokensData);
        const tokensResult = safeValidateThemeTokens(tokensJson);
        if (!tokensResult.success) {
          bundleLogger.warn('Invalid tokens in bundle', {
            themeId: manifest.id,
            errors: tokensResult.errors.issues.map(e => e.message),
          });
          continue;
        }
        tokens = tokensResult.data;
      } else {
        bundleLogger.warn('No tokens found in bundle', { themeId: manifest.id });
        continue;
      }

      // Load CSS overrides
      let cssOverrides: string | undefined;
      if (manifest.stylesPath) {
        try {
          cssOverrides = await fs.readFile(
            path.join(themePath, manifest.stylesPath),
            'utf-8'
          );
        } catch {
          bundleLogger.warn('CSS overrides file not found', {
            themeId: manifest.id,
            stylesPath: manifest.stylesPath,
          });
        }
      }

      // Find index entry
      const indexEntry = index.themes.find(t => t.id === manifest.id) || {
        id: manifest.id,
        version: manifest.version,
        installedAt: new Date().toISOString(),
        source: 'file' as const,
        sourceUrl: null,
        registrySource: null,
        signatureVerified: false,
      };

      loaded.push({
        manifest,
        tokens,
        cssOverrides,
        installPath: themePath,
        indexEntry,
      });

      bundleLogger.debug('Loaded theme bundle', {
        themeId: manifest.id,
        version: manifest.version,
      });
    } catch (err) {
      bundleLogger.warn('Failed to load theme bundle', {
        themeDir,
        error: getErrorMessage(err),
      });
    }
  }

  bundleLogger.info('Theme bundles loaded', { count: loaded.length });
  return loaded;
}

/**
 * Load theme bundles from a specific directory (e.g., app-bundled themes).
 * Same logic as loadInstalledBundles but reads from a given directory path
 * rather than the user data themes directory.
 */
export async function loadBundledThemesFromDir(dir: string): Promise<LoadedBundleTheme[]> {
  const loaded: LoadedBundleTheme[] = [];

  bundleLogger.debug('Loading bundled themes from directory', { dir });

  // Check directory exists
  try {
    await fs.access(dir);
  } catch {
    bundleLogger.debug('Bundled themes directory does not exist', { dir });
    return loaded;
  }

  let entries: string[];
  try {
    const dirEntries = await fs.readdir(dir, { withFileTypes: true });
    entries = dirEntries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch (err) {
    bundleLogger.warn('Failed to read bundled themes directory', { error: getErrorMessage(err) });
    return loaded;
  }

  for (const themeDir of entries) {
    const themePath = path.join(dir, themeDir);
    const themeJsonPath = path.join(themePath, 'theme.json');

    try {
      await fs.access(themeJsonPath);

      const manifestData = await fs.readFile(themeJsonPath, 'utf-8');
      const manifestJson = JSON.parse(manifestData);
      const manifestResult = safeValidateQtapThemeManifest(manifestJson);

      if (!manifestResult.success) {
        bundleLogger.warn('Invalid theme.json in bundled theme', {
          themeDir,
          errors: manifestResult.errors.issues.map(e => e.message),
        });
        continue;
      }

      const manifest = manifestResult.data;

      // Load tokens
      let tokens: ThemeTokens;
      if (manifest.tokens) {
        tokens = manifest.tokens;
      } else if (manifest.tokensPath) {
        const tokensPath = path.join(themePath, manifest.tokensPath);
        const tokensData = await fs.readFile(tokensPath, 'utf-8');
        const tokensJson = JSON.parse(tokensData);
        const tokensResult = safeValidateThemeTokens(tokensJson);
        if (!tokensResult.success) {
          bundleLogger.warn('Invalid tokens in bundled theme', {
            themeId: manifest.id,
            errors: tokensResult.errors.issues.map(e => e.message),
          });
          continue;
        }
        tokens = tokensResult.data;
      } else {
        bundleLogger.warn('No tokens found in bundled theme', { themeId: manifest.id });
        continue;
      }

      // Load CSS overrides
      let cssOverrides: string | undefined;
      if (manifest.stylesPath) {
        try {
          cssOverrides = await fs.readFile(
            path.join(themePath, manifest.stylesPath),
            'utf-8'
          );
        } catch {
          bundleLogger.warn('CSS overrides file not found in bundled theme', {
            themeId: manifest.id,
            stylesPath: manifest.stylesPath,
          });
        }
      }

      const indexEntry: ThemeBundleIndexEntry = {
        id: manifest.id,
        version: manifest.version,
        installedAt: new Date().toISOString(),
        source: 'file' as const,
        sourceUrl: null,
        registrySource: null,
        signatureVerified: false,
      };

      loaded.push({
        manifest,
        tokens,
        cssOverrides,
        installPath: themePath,
        indexEntry,
      });

      bundleLogger.debug('Loaded bundled theme', {
        themeId: manifest.id,
        version: manifest.version,
      });
    } catch (err) {
      bundleLogger.warn('Failed to load bundled theme', {
        themeDir,
        error: getErrorMessage(err),
      });
    }
  }

  bundleLogger.info('Bundled themes loaded', { count: loaded.length });
  return loaded;
}

/**
 * Export an installed theme as a .qtap-theme bundle
 */
export async function exportThemeAsBundle(
  themeId: string,
  outputPath: string,
  themeData: {
    manifest: QtapThemeManifest;
    tokens: ThemeTokens;
    cssOverrides?: string;
    fonts?: Array<{ src: string; filePath: string; family: string; weight: string; style: string; display: string }>;
    installPath?: string;
  }
): Promise<void> {
  bundleLogger.info('Exporting theme as bundle', { themeId, outputPath });

  // We'll use the archiver library if available, otherwise create a simple zip
  // For now, create the export directory and package it
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-export-'));

  try {
    // Write theme.json
    const manifestData: QtapThemeManifest = {
      ...themeData.manifest,
      $schema: './qtap-theme.schema.json',
      format: 'qtap-theme',
      formatVersion: 1,
      tokens: themeData.tokens,
    };
    // Remove tokensPath if tokens are inline
    delete (manifestData as Record<string, unknown>).tokensPath;

    await fs.writeFile(
      path.join(tempDir, 'theme.json'),
      JSON.stringify(manifestData, null, 2),
      'utf-8'
    );

    // Write CSS overrides
    if (themeData.cssOverrides) {
      await fs.writeFile(
        path.join(tempDir, 'styles.css'),
        themeData.cssOverrides,
        'utf-8'
      );
    }

    // Copy font files
    if (themeData.fonts) {
      for (const font of themeData.fonts) {
        if (font.filePath) {
          const destPath = path.join(tempDir, font.src);
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          try {
            await fs.copyFile(font.filePath, destPath);
          } catch {
            bundleLogger.warn('Failed to copy font file for export', {
              themeId,
              fontSrc: font.src,
            });
          }
        }
      }
    }

    // If the theme has an existing install directory, copy assets from there
    if (themeData.installPath) {
      const sourceDir = themeData.installPath;
      try {
        const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
        for (const entry of sourceEntries) {
          const sourcePath = path.join(sourceDir, entry.name);
          const destPath = path.join(tempDir, entry.name);
          // Don't overwrite files we already wrote
          try {
            await fs.access(destPath);
            continue; // Already exists
          } catch {
            // Doesn't exist, copy it
          }
          if (entry.isDirectory()) {
            await copyDir(sourcePath, destPath);
          } else {
            await fs.copyFile(sourcePath, destPath);
          }
        }
      } catch {
        // Source dir may not exist for plugin themes
      }
    }

    // Create zip using a simple approach with Node.js zlib
    // We use the archiver approach via a spawned process since we already have yauzl for reading
    const { execSync } = await import('node:child_process');

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Use the zip command (available on macOS and Linux)
    execSync(`cd "${tempDir}" && zip -r "${path.resolve(outputPath)}" .`, {
      stdio: 'pipe',
    });

    bundleLogger.info('Theme exported successfully', { themeId, outputPath });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
