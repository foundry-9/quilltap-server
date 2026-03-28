#!/usr/bin/env node
'use strict';

/**
 * Theme Bundle Validation (Standalone)
 *
 * Lightweight validation for .qtap-theme bundles that can run
 * without the Next.js app or Zod dependency.
 *
 * @module quilltap/lib/theme-validation
 */

const path = require('path');

// ============================================================================
// CONSTANTS (mirrored from lib/themes/bundle-loader.ts)
// ============================================================================

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB total
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILE_COUNT = 200;

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

// Theme ID must be lowercase alphanumeric with hyphens
const THEME_ID_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Required color keys in a palette
const REQUIRED_COLOR_KEYS = [
  'background', 'foreground', 'primary', 'primaryForeground',
  'secondary', 'secondaryForeground', 'muted', 'mutedForeground',
  'accent', 'accentForeground', 'destructive', 'destructiveForeground',
  'card', 'cardForeground', 'popover', 'popoverForeground',
  'border', 'input', 'ring',
];

// ============================================================================
// MANIFEST VALIDATION
// ============================================================================

/**
 * Validate a theme.json manifest object
 * @param {Record<string, unknown>} manifest
 * @returns {{ valid: boolean; errors: string[]; warnings: string[] }}
 */
function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (manifest.format !== 'qtap-theme') {
    errors.push(`format must be "qtap-theme", got "${manifest.format}"`);
  }
  if (manifest.formatVersion !== 1) {
    errors.push(`formatVersion must be 1, got ${manifest.formatVersion}`);
  }
  if (!manifest.id || typeof manifest.id !== 'string') {
    errors.push('id is required and must be a string');
  } else if (!THEME_ID_REGEX.test(manifest.id)) {
    errors.push(`id "${manifest.id}" must be lowercase alphanumeric with hyphens`);
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('name is required and must be a string');
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('version is required and must be a string');
  }
  if (typeof manifest.supportsDarkMode !== 'boolean') {
    errors.push('supportsDarkMode is required and must be a boolean');
  }

  // Must have tokens or tokensPath
  if (!manifest.tokens && !manifest.tokensPath) {
    errors.push('Either tokens (inline) or tokensPath (file reference) is required');
  }

  // Validate inline tokens if present
  if (manifest.tokens) {
    validateTokens(manifest.tokens, errors, warnings);
  }

  // Optional string fields
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    errors.push('description must be a string');
  }
  if (manifest.author !== undefined && typeof manifest.author !== 'string') {
    errors.push('author must be a string');
  }

  // Optional array fields
  if (manifest.tags !== undefined) {
    if (!Array.isArray(manifest.tags)) {
      errors.push('tags must be an array of strings');
    } else if (manifest.tags.some(t => typeof t !== 'string')) {
      errors.push('tags must contain only strings');
    }
  }

  // Fonts validation
  if (manifest.fonts !== undefined) {
    if (!Array.isArray(manifest.fonts)) {
      errors.push('fonts must be an array');
    } else {
      for (let i = 0; i < manifest.fonts.length; i++) {
        const font = manifest.fonts[i];
        if (!font.family || typeof font.family !== 'string') {
          errors.push(`fonts[${i}].family is required and must be a string`);
        }
        if (!font.src || typeof font.src !== 'string') {
          errors.push(`fonts[${i}].src is required and must be a string`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate theme tokens object
 */
function validateTokens(tokens, errors, warnings) {
  if (!tokens || typeof tokens !== 'object') {
    errors.push('tokens must be an object');
    return;
  }

  // Colors are required
  if (!tokens.colors || typeof tokens.colors !== 'object') {
    errors.push('tokens.colors is required');
    return;
  }

  // Validate light palette
  if (!tokens.colors.light || typeof tokens.colors.light !== 'object') {
    errors.push('tokens.colors.light is required');
  } else {
    for (const key of REQUIRED_COLOR_KEYS) {
      if (!tokens.colors.light[key] || typeof tokens.colors.light[key] !== 'string') {
        errors.push(`tokens.colors.light.${key} is required and must be a string`);
      }
    }
  }

  // Validate dark palette
  if (!tokens.colors.dark || typeof tokens.colors.dark !== 'object') {
    errors.push('tokens.colors.dark is required');
  } else {
    for (const key of REQUIRED_COLOR_KEYS) {
      if (!tokens.colors.dark[key] || typeof tokens.colors.dark[key] !== 'string') {
        errors.push(`tokens.colors.dark.${key} is required and must be a string`);
      }
    }
  }

  // Typography, spacing, effects are optional
  if (tokens.typography && typeof tokens.typography !== 'object') {
    warnings.push('tokens.typography should be an object');
  }
  if (tokens.spacing && typeof tokens.spacing !== 'object') {
    warnings.push('tokens.spacing should be an object');
  }
  if (tokens.effects && typeof tokens.effects !== 'object') {
    warnings.push('tokens.effects should be an object');
  }
}

// ============================================================================
// ZIP VALIDATION
// ============================================================================

/**
 * Validate a .qtap-theme zip file
 * @param {string} zipPath - Path to the .qtap-theme file
 * @returns {Promise<{ valid: boolean; manifest?: object; errors: string[]; warnings: string[]; fileCount: number; totalSize: number }>}
 */
async function validateThemeBundle(zipPath) {
  const fs = require('fs/promises');
  const errors = [];
  const warnings = [];
  let fileCount = 0;
  let totalSize = 0;

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
  let yauzl;
  try {
    yauzl = require('yauzl');
  } catch {
    errors.push('yauzl module not available - cannot validate zip files');
    return { valid: false, errors, warnings, fileCount: 0, totalSize };
  }

  let zipFile;
  try {
    zipFile = await new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zf) => {
        if (err) reject(err);
        else resolve(zf);
      });
    });
  } catch (err) {
    errors.push(`Invalid zip file: ${err.message}`);
    return { valid: false, errors, warnings, fileCount: 0, totalSize };
  }

  try {
    // Read all entries
    const entries = await new Promise((resolve, reject) => {
      const result = [];
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        result.push({
          fileName: entry.fileName,
          uncompressedSize: entry.uncompressedSize,
          isDirectory: /\/$/.test(entry.fileName),
        });
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolve(result));
      zipFile.on('error', reject);
    });

    fileCount = entries.filter(e => !e.isDirectory).length;

    if (fileCount > MAX_FILE_COUNT) {
      errors.push(`Bundle contains ${fileCount} files, exceeding limit of ${MAX_FILE_COUNT}`);
      return { valid: false, errors, warnings, fileCount, totalSize };
    }

    let hasThemeJson = false;
    let totalUncompressed = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      // Path traversal check
      if (entry.fileName.includes('..') || path.isAbsolute(entry.fileName)) {
        errors.push(`Unsafe path detected: ${entry.fileName}`);
        continue;
      }

      // File size check
      if (entry.uncompressedSize > MAX_FILE_SIZE) {
        errors.push(`File ${entry.fileName} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      }
      totalUncompressed += entry.uncompressedSize;

      // Extension check
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

    // Zip bomb protection
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

    // Extract theme.json to validate manifest
    const manifest = await extractAndValidateManifest(zipFile, zipPath, entries, errors, warnings);

    return {
      valid: errors.length === 0,
      manifest: errors.length === 0 ? manifest : undefined,
      errors,
      warnings,
      fileCount,
      totalSize,
    };
  } finally {
    zipFile.close();
  }
}

/**
 * Extract and validate theme.json from zip
 */
async function extractAndValidateManifest(zipFile, zipPath, entries, errors, warnings) {
  const yauzl = require('yauzl');
  const themeJsonEntry = entries.find(
    e => e.fileName === 'theme.json' || e.fileName.endsWith('/theme.json')
  );
  if (!themeJsonEntry) return null;

  // Re-open to read specific entry
  const zf = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, z) => {
      if (err) reject(err);
      else resolve(z);
    });
  });

  try {
    const content = await new Promise((resolve, reject) => {
      zf.readEntry();
      zf.on('entry', (entry) => {
        if (entry.fileName === themeJsonEntry.fileName) {
          zf.openReadStream(entry, (err, stream) => {
            if (err) { reject(err); return; }
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            stream.on('error', reject);
          });
        } else {
          zf.readEntry();
        }
      });
      zf.on('error', reject);
    });

    let manifestJson;
    try {
      manifestJson = JSON.parse(content);
    } catch (err) {
      errors.push(`Failed to parse theme.json: ${err.message}`);
      return null;
    }

    const result = validateManifest(manifestJson);
    errors.push(...result.errors);
    warnings.push(...result.warnings);

    return result.valid ? manifestJson : null;
  } finally {
    zf.close();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  validateThemeBundle,
  validateManifest,
  validateTokens,
  MAX_BUNDLE_SIZE,
  MAX_FILE_SIZE,
  MAX_FILE_COUNT,
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  THEME_ID_REGEX,
};
