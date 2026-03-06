#!/usr/bin/env node
'use strict';

/**
 * Theme CLI Commands
 *
 * Handles theme management from the command line:
 * - list: Show installed themes
 * - install: Install a .qtap-theme bundle
 * - uninstall: Remove a bundle theme
 * - validate: Check a .qtap-theme file
 * - export: Export a theme as .qtap-theme
 *
 * @module quilltap/lib/theme-commands
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { validateThemeBundle, validateManifest } = require('./theme-validation');

// ============================================================================
// COLOR HELPERS
// ============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

// ============================================================================
// PATH RESOLUTION
// ============================================================================

/**
 * Resolve the base data directory
 */
function resolveBaseDir(overrideDir) {
  if (overrideDir) {
    const resolved = overrideDir.startsWith('~')
      ? path.join(os.homedir(), overrideDir.slice(1))
      : overrideDir;
    return resolved;
  }
  if (process.env.QUILLTAP_DATA_DIR) {
    return process.env.QUILLTAP_DATA_DIR;
  }
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Quilltap');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Quilltap');
  return path.join(home, '.quilltap');
}

function getThemesDir(overrideDir) {
  return path.join(resolveBaseDir(overrideDir), 'themes');
}

function getIndexPath(overrideDir) {
  return path.join(getThemesDir(overrideDir), 'themes-index.json');
}

// ============================================================================
// INDEX MANAGEMENT
// ============================================================================

async function readIndex(overrideDir) {
  const indexPath = getIndexPath(overrideDir);
  try {
    const data = await fsp.readFile(indexPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { version: 1, themes: [] };
  }
}

async function writeIndex(index, overrideDir) {
  const indexPath = getIndexPath(overrideDir);
  await fsp.mkdir(path.dirname(indexPath), { recursive: true });
  await fsp.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

// ============================================================================
// ZIP EXTRACTION (uses yauzl)
// ============================================================================

async function extractZipToDir(zipPath, destDir) {
  const yauzl = require('yauzl');

  const zipFile = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zf) => {
      if (err) reject(err);
      else resolve(zf);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      zipFile.readEntry();
      zipFile.on('entry', async (entry) => {
        try {
          const entryPath = path.join(destDir, entry.fileName);

          // Security: prevent path traversal
          if (!entryPath.startsWith(destDir + path.sep) && entryPath !== destDir) {
            reject(new Error(`Path traversal detected: ${entry.fileName}`));
            return;
          }

          if (/\/$/.test(entry.fileName)) {
            await fsp.mkdir(entryPath, { recursive: true });
            zipFile.readEntry();
          } else {
            await fsp.mkdir(path.dirname(entryPath), { recursive: true });
            const data = await new Promise((res, rej) => {
              zipFile.openReadStream(entry, (err, stream) => {
                if (err) { rej(err); return; }
                const chunks = [];
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => res(Buffer.concat(chunks)));
                stream.on('error', rej);
              });
            });
            await fsp.writeFile(entryPath, data);
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
// COMMANDS
// ============================================================================

/**
 * List installed themes
 */
async function listThemes(dataDir) {
  const themesDir = getThemesDir(dataDir);
  const index = await readIndex(dataDir);

  console.log(`\n${c.bold}Installed Theme Bundles${c.reset}\n`);

  if (index.themes.length === 0) {
    console.log(`  ${c.dim}No theme bundles installed.${c.reset}`);
    console.log(`  ${c.dim}Use "quilltap themes install <file>" to install a .qtap-theme bundle.${c.reset}`);
    console.log('');
    return;
  }

  for (const entry of index.themes) {
    const themeDir = path.join(themesDir, entry.id);
    const themeJsonPath = path.join(themeDir, 'theme.json');

    let name = entry.id;
    let description = '';
    let version = entry.version;
    let source = entry.source || 'file';

    try {
      const manifest = JSON.parse(await fsp.readFile(themeJsonPath, 'utf-8'));
      name = manifest.name || entry.id;
      description = manifest.description || '';
      version = manifest.version || entry.version;
    } catch {
      // Use index data
    }

    const installedDate = entry.installedAt
      ? new Date(entry.installedAt).toLocaleDateString()
      : 'unknown';

    console.log(`  ${c.bold}${name}${c.reset} ${c.dim}(${entry.id})${c.reset}`);
    console.log(`    Version: ${version}  Source: ${source}  Installed: ${installedDate}`);
    if (description) {
      console.log(`    ${c.dim}${description.substring(0, 80)}${description.length > 80 ? '...' : ''}${c.reset}`);
    }
    console.log('');
  }
}

/**
 * Validate a .qtap-theme file
 */
async function validateTheme(filePath) {
  const resolvedPath = path.resolve(filePath);

  console.log(`\n${c.bold}Validating:${c.reset} ${resolvedPath}\n`);

  const result = await validateThemeBundle(resolvedPath);

  if (result.valid) {
    console.log(`  ${c.green}Valid${c.reset} .qtap-theme bundle\n`);
    if (result.manifest) {
      console.log(`  Name:        ${result.manifest.name}`);
      console.log(`  ID:          ${result.manifest.id}`);
      console.log(`  Version:     ${result.manifest.version}`);
      console.log(`  Dark Mode:   ${result.manifest.supportsDarkMode ? 'Yes' : 'No'}`);
      if (result.manifest.author) console.log(`  Author:      ${result.manifest.author}`);
      if (result.manifest.description) {
        console.log(`  Description: ${result.manifest.description.substring(0, 60)}${result.manifest.description.length > 60 ? '...' : ''}`);
      }
    }
    console.log(`  Files:       ${result.fileCount}`);
    console.log(`  Size:        ${(result.totalSize / 1024).toFixed(1)} KB`);
  } else {
    console.log(`  ${c.red}Invalid${c.reset} .qtap-theme bundle\n`);
    for (const error of result.errors) {
      console.log(`  ${c.red}Error:${c.reset} ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('');
    for (const warning of result.warnings) {
      console.log(`  ${c.yellow}Warning:${c.reset} ${warning}`);
    }
  }

  console.log('');
  return result.valid;
}

/**
 * Install a .qtap-theme file
 */
async function installTheme(source, dataDir) {
  const resolvedSource = path.resolve(source);

  console.log(`\n${c.bold}Installing theme from:${c.reset} ${resolvedSource}\n`);

  // Validate first
  const validation = await validateThemeBundle(resolvedSource);
  if (!validation.valid || !validation.manifest) {
    console.log(`  ${c.red}Validation failed:${c.reset}`);
    for (const error of validation.errors) {
      console.log(`    ${c.red}-${c.reset} ${error}`);
    }
    console.log('');
    return false;
  }

  const manifest = validation.manifest;
  const themeId = manifest.id;
  const themesDir = getThemesDir(dataDir);
  const installPath = path.join(themesDir, themeId);

  // Remove existing installation
  try {
    await fsp.rm(installPath, { recursive: true, force: true });
  } catch {
    // Ignore
  }

  // Create directory and extract
  await fsp.mkdir(installPath, { recursive: true });

  try {
    await extractZipToDir(resolvedSource, installPath);

    // If theme.json is in a subdirectory, move contents up
    const directThemeJson = path.join(installPath, 'theme.json');
    try {
      await fsp.access(directThemeJson);
    } catch {
      const entries = await fsp.readdir(installPath, { withFileTypes: true });
      const subdirs = entries.filter(e => e.isDirectory());
      for (const subdir of subdirs) {
        const subThemeJson = path.join(installPath, subdir.name, 'theme.json');
        try {
          await fsp.access(subThemeJson);
          const subPath = path.join(installPath, subdir.name);
          const subEntries = await fsp.readdir(subPath);
          for (const entry of subEntries) {
            await fsp.rename(
              path.join(subPath, entry),
              path.join(installPath, entry)
            );
          }
          await fsp.rmdir(subPath);
          break;
        } catch {
          continue;
        }
      }
    }

    // Update index
    const index = await readIndex(dataDir);
    index.themes = index.themes.filter(t => t.id !== themeId);
    index.themes.push({
      id: themeId,
      version: manifest.version,
      installedAt: new Date().toISOString(),
      source: 'file',
      sourceUrl: null,
      registrySource: null,
      signatureVerified: false,
    });
    await writeIndex(index, dataDir);

    console.log(`  ${c.green}Installed successfully${c.reset}`);
    console.log(`  Theme: ${manifest.name} (${themeId}) v${manifest.version}`);
    console.log(`  Path:  ${installPath}`);
    console.log('');
    return true;
  } catch (err) {
    // Clean up on failure
    try { await fsp.rm(installPath, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`  ${c.red}Installation failed:${c.reset} ${err.message}`);
    console.log('');
    return false;
  }
}

/**
 * Uninstall a theme bundle
 */
async function uninstallTheme(themeId, dataDir) {
  const themesDir = getThemesDir(dataDir);
  const installPath = path.join(themesDir, themeId);

  console.log(`\n${c.bold}Uninstalling theme:${c.reset} ${themeId}\n`);

  // Check if theme exists
  try {
    await fsp.access(installPath);
  } catch {
    console.log(`  ${c.red}Theme "${themeId}" not found.${c.reset}`);
    console.log('');
    return false;
  }

  // Remove directory
  await fsp.rm(installPath, { recursive: true, force: true });

  // Update index
  const index = await readIndex(dataDir);
  index.themes = index.themes.filter(t => t.id !== themeId);
  await writeIndex(index, dataDir);

  console.log(`  ${c.green}Uninstalled successfully.${c.reset}`);
  console.log('');
  return true;
}

/**
 * Export a theme as .qtap-theme bundle
 */
async function exportTheme(themeId, outputPath, dataDir) {
  const themesDir = getThemesDir(dataDir);
  const themePath = path.join(themesDir, themeId);

  console.log(`\n${c.bold}Exporting theme:${c.reset} ${themeId}\n`);

  // Check if theme exists
  try {
    await fsp.access(path.join(themePath, 'theme.json'));
  } catch {
    console.log(`  ${c.red}Theme "${themeId}" not found in ${themesDir}.${c.reset}`);
    console.log(`  ${c.dim}Note: Only installed bundle themes can be exported from the CLI.${c.reset}`);
    console.log(`  ${c.dim}To export plugin themes, use the web UI export button.${c.reset}`);
    console.log('');
    return false;
  }

  // Default output path
  const finalOutput = outputPath || `${themeId}.qtap-theme`;
  const resolvedOutput = path.resolve(finalOutput);

  // Create zip
  try {
    execSync(`cd "${themePath}" && zip -r "${resolvedOutput}" .`, { stdio: 'pipe' });
    console.log(`  ${c.green}Exported successfully${c.reset}`);
    console.log(`  Output: ${resolvedOutput}`);
    console.log('');
    return true;
  } catch (err) {
    console.log(`  ${c.red}Export failed:${c.reset} ${err.message}`);
    console.log('');
    return false;
  }
}

// ============================================================================
// SOURCES / REGISTRY HELPERS
// ============================================================================

function getSourcesPath(dataDir) {
  return path.join(getThemesDir(dataDir), 'sources.json');
}

function getCacheDir(dataDir) {
  return path.join(getThemesDir(dataDir), '.cache');
}

async function readSources(dataDir) {
  const sourcesPath = getSourcesPath(dataDir);
  try {
    const data = await fsp.readFile(sourcesPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { version: 1, sources: [] };
  }
}

async function writeSources(sources, dataDir) {
  const sourcesPath = getSourcesPath(dataDir);
  await fsp.mkdir(path.dirname(sourcesPath), { recursive: true });
  await fsp.writeFile(sourcesPath, JSON.stringify(sources, null, 2), 'utf-8');
}

// ============================================================================
// REGISTRY COMMANDS
// ============================================================================

/**
 * List configured registries
 */
async function registryList(dataDir) {
  const sources = await readSources(dataDir);

  console.log(`\n${c.bold}Configured Theme Registries${c.reset}\n`);

  if (sources.sources.length === 0) {
    console.log(`  ${c.dim}No registries configured.${c.reset}`);
    console.log(`  ${c.dim}Use "quilltap themes registry add <url>" to add one.${c.reset}`);
    console.log('');
    return;
  }

  for (const source of sources.sources) {
    const status = source.enabled !== false ? `${c.green}enabled${c.reset}` : `${c.red}disabled${c.reset}`;
    const keyDisplay = source.publicKey
      ? `${source.publicKey.substring(0, 20)}...`
      : `${c.dim}none${c.reset}`;
    const lastFetched = source.lastFetched
      ? new Date(source.lastFetched).toLocaleString()
      : `${c.dim}never${c.reset}`;

    console.log(`  ${c.bold}${source.name}${c.reset}  [${status}]`);
    console.log(`    URL:          ${source.url}`);
    console.log(`    Public Key:   ${keyDisplay}`);
    console.log(`    Last Fetched: ${lastFetched}`);
    console.log('');
  }
}

/**
 * Add a new registry source
 */
async function registryAdd(url, options, dataDir) {
  if (!url) {
    console.error('Error: registry add requires a URL');
    console.error('Usage: quilltap themes registry add <url> [--key <pubkey>] [--name <name>]');
    process.exit(1);
  }

  const sources = await readSources(dataDir);

  // Derive name from URL hostname if not provided
  let name = options.name;
  if (!name) {
    try {
      const parsed = new URL(url);
      name = parsed.hostname.replace(/\./g, '-');
    } catch {
      name = 'registry-' + Date.now();
    }
  }

  // Check for duplicate name
  if (sources.sources.find(s => s.name === name)) {
    console.error(`\n  ${c.red}Error:${c.reset} A registry named "${name}" already exists.`);
    console.error(`  Use "quilltap themes registry remove ${name}" first, or choose a different --name.\n`);
    process.exit(1);
  }

  const newSource = {
    name,
    url,
    enabled: true,
    publicKey: options.key || null,
    lastFetched: null,
  };

  sources.sources.push(newSource);
  await writeSources(sources, dataDir);

  console.log(`\n  ${c.green}Registry added successfully${c.reset}`);
  console.log(`  Name: ${name}`);
  console.log(`  URL:  ${url}`);
  if (options.key) {
    console.log(`  Key:  ${options.key.substring(0, 20)}...`);
  }
  console.log('');
}

/**
 * Remove a registry source by name
 */
async function registryRemove(name, dataDir) {
  if (!name) {
    console.error('Error: registry remove requires a registry name');
    console.error('Usage: quilltap themes registry remove <name>');
    process.exit(1);
  }

  const sources = await readSources(dataDir);
  const before = sources.sources.length;
  sources.sources = sources.sources.filter(s => s.name !== name);

  if (sources.sources.length === before) {
    console.error(`\n  ${c.red}Error:${c.reset} No registry named "${name}" found.\n`);
    process.exit(1);
  }

  await writeSources(sources, dataDir);

  // Also remove cached index if present
  const cacheFile = path.join(getCacheDir(dataDir), `${name}.json`);
  try {
    await fsp.unlink(cacheFile);
  } catch {
    // Ignore if not cached
  }

  console.log(`\n  ${c.green}Registry "${name}" removed.${c.reset}\n`);
}

/**
 * Refresh all registry indexes
 */
async function registryRefresh(dataDir) {
  const sources = await readSources(dataDir);
  const cacheDir = getCacheDir(dataDir);
  await fsp.mkdir(cacheDir, { recursive: true });

  const enabledSources = sources.sources.filter(s => s.enabled !== false);

  if (enabledSources.length === 0) {
    console.log(`\n  ${c.dim}No enabled registries to refresh.${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}Refreshing registries...${c.reset}\n`);

  for (const source of enabledSources) {
    process.stdout.write(`  ${source.name}: `);
    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        console.log(`${c.red}HTTP ${response.status}${c.reset}`);
        continue;
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.log(`${c.red}invalid JSON${c.reset}`);
        continue;
      }

      // Basic structure validation
      if (!data.themes || !Array.isArray(data.themes)) {
        console.log(`${c.red}invalid registry format (missing themes array)${c.reset}`);
        continue;
      }

      // Write cache
      const cacheFile = path.join(cacheDir, `${source.name}.json`);
      await fsp.writeFile(cacheFile, JSON.stringify(data, null, 2), 'utf-8');

      // Update lastFetched
      source.lastFetched = new Date().toISOString();

      console.log(`${c.green}OK${c.reset} (${data.themes.length} themes)`);
    } catch (err) {
      console.log(`${c.red}${err.message}${c.reset}`);
    }
  }

  await writeSources(sources, dataDir);
  console.log('');
}

/**
 * Search across cached registry indexes
 */
async function searchThemes(query, dataDir) {
  if (!query) {
    console.error('Error: search requires a query');
    console.error('Usage: quilltap themes search <query>');
    process.exit(1);
  }

  const cacheDir = getCacheDir(dataDir);
  const queryLower = query.toLowerCase();
  const results = [];

  let cacheFiles;
  try {
    cacheFiles = await fsp.readdir(cacheDir);
  } catch {
    console.log(`\n  ${c.dim}No cached registry data. Run "quilltap themes registry refresh" first.${c.reset}\n`);
    return;
  }

  for (const file of cacheFiles) {
    if (!file.endsWith('.json')) continue;
    const registryName = path.basename(file, '.json');
    try {
      const data = JSON.parse(await fsp.readFile(path.join(cacheDir, file), 'utf-8'));
      if (!data.themes || !Array.isArray(data.themes)) continue;

      for (const theme of data.themes) {
        const searchable = [
          theme.id || '',
          theme.name || '',
          theme.description || '',
          ...(theme.tags || []),
        ].join(' ').toLowerCase();

        if (searchable.includes(queryLower)) {
          results.push({ ...theme, _registry: registryName });
        }
      }
    } catch {
      // Skip malformed cache files
    }
  }

  console.log(`\n${c.bold}Search Results for "${query}"${c.reset}\n`);

  if (results.length === 0) {
    console.log(`  ${c.dim}No themes found matching "${query}".${c.reset}\n`);
    return;
  }

  for (const theme of results) {
    console.log(`  ${c.bold}${theme.name || theme.id}${c.reset} ${c.dim}(${theme.id})${c.reset}`);
    console.log(`    Version: ${theme.version || 'unknown'}  Author: ${theme.author || 'unknown'}  Registry: ${theme._registry}`);
    if (theme.description) {
      console.log(`    ${c.dim}${theme.description.substring(0, 80)}${theme.description.length > 80 ? '...' : ''}${c.reset}`);
    }
    console.log('');
  }
}

/**
 * Update themes from registry
 */
async function updateThemes(themeId, dataDir) {
  const cacheDir = getCacheDir(dataDir);
  const index = await readIndex(dataDir);

  // Build registry lookup from cached indexes
  const registryThemes = {};
  let cacheFiles;
  try {
    cacheFiles = await fsp.readdir(cacheDir);
  } catch {
    console.log(`\n  ${c.dim}No cached registry data. Run "quilltap themes registry refresh" first.${c.reset}\n`);
    return;
  }

  for (const file of cacheFiles) {
    if (!file.endsWith('.json')) continue;
    const registryName = path.basename(file, '.json');
    try {
      const data = JSON.parse(await fsp.readFile(path.join(cacheDir, file), 'utf-8'));
      if (!data.themes || !Array.isArray(data.themes)) continue;
      for (const theme of data.themes) {
        if (theme.id) {
          registryThemes[theme.id] = { ...theme, _registry: registryName };
        }
      }
    } catch {
      // Skip malformed cache files
    }
  }

  // Find updates
  const updates = [];
  const themesToCheck = themeId
    ? index.themes.filter(t => t.id === themeId)
    : index.themes;

  if (themeId && themesToCheck.length === 0) {
    console.log(`\n  ${c.red}Theme "${themeId}" is not installed.${c.reset}\n`);
    return;
  }

  for (const installed of themesToCheck) {
    const available = registryThemes[installed.id];
    if (available && available.version && available.version !== installed.version) {
      updates.push({ installed, available });
    }
  }

  if (updates.length === 0) {
    console.log(`\n  ${c.green}All themes are up to date.${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}Available Updates${c.reset}\n`);

  for (const { installed, available } of updates) {
    console.log(`  ${c.bold}${available.name || installed.id}${c.reset}`);
    console.log(`    ${installed.version} -> ${c.green}${available.version}${c.reset}`);

    if (!available.downloadUrl) {
      console.log(`    ${c.yellow}No download URL available, skipping.${c.reset}`);
      console.log('');
      continue;
    }

    process.stdout.write(`    Downloading... `);
    try {
      const response = await fetch(available.downloadUrl);
      if (!response.ok) {
        console.log(`${c.red}HTTP ${response.status}${c.reset}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Verify SHA-256 hash if provided
      if (available.sha256) {
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        if (hash !== available.sha256) {
          console.log(`${c.red}hash mismatch${c.reset}`);
          console.log(`      Expected: ${available.sha256}`);
          console.log(`      Got:      ${hash}`);
          continue;
        }
      }

      // Write to temp file and install
      const tmpFile = path.join(os.tmpdir(), `quilltap-update-${installed.id}-${Date.now()}.qtap-theme`);
      await fsp.writeFile(tmpFile, buffer);

      console.log(`${c.green}OK${c.reset}`);
      process.stdout.write(`    Installing... `);

      // Use existing install logic
      const validation = await validateThemeBundle(tmpFile);
      if (!validation.valid || !validation.manifest) {
        console.log(`${c.red}validation failed${c.reset}`);
        await fsp.unlink(tmpFile).catch(() => {});
        continue;
      }

      const manifest = validation.manifest;
      const themesDir = getThemesDir(dataDir);
      const installPath = path.join(themesDir, installed.id);

      await fsp.rm(installPath, { recursive: true, force: true });
      await fsp.mkdir(installPath, { recursive: true });
      await extractZipToDir(tmpFile, installPath);

      // Handle subdirectory layout
      const directThemeJson = path.join(installPath, 'theme.json');
      try {
        await fsp.access(directThemeJson);
      } catch {
        const entries = await fsp.readdir(installPath, { withFileTypes: true });
        const subdirs = entries.filter(e => e.isDirectory());
        for (const subdir of subdirs) {
          const subThemeJson = path.join(installPath, subdir.name, 'theme.json');
          try {
            await fsp.access(subThemeJson);
            const subPath = path.join(installPath, subdir.name);
            const subEntries = await fsp.readdir(subPath);
            for (const entry of subEntries) {
              await fsp.rename(
                path.join(subPath, entry),
                path.join(installPath, entry)
              );
            }
            await fsp.rmdir(subPath);
            break;
          } catch {
            continue;
          }
        }
      }

      // Update index entry
      const currentIndex = await readIndex(dataDir);
      currentIndex.themes = currentIndex.themes.filter(t => t.id !== installed.id);
      currentIndex.themes.push({
        id: installed.id,
        version: manifest.version,
        installedAt: new Date().toISOString(),
        source: 'registry',
        sourceUrl: available.downloadUrl,
        registrySource: available._registry,
        signatureVerified: false,
      });
      await writeIndex(currentIndex, dataDir);

      console.log(`${c.green}OK${c.reset} (v${manifest.version})`);

      // Clean up temp file
      await fsp.unlink(tmpFile).catch(() => {});
    } catch (err) {
      console.log(`${c.red}${err.message}${c.reset}`);
    }
    console.log('');
  }
}

/**
 * Generate Ed25519 keypair for registry signing
 */
async function registryKeygen(outputDir) {
  console.log(`\n${c.bold}Generating Ed25519 Keypair${c.reset}\n`);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  const pubKeyStr = `ed25519:${publicKey.toString('base64')}`;
  const privKeyStr = `ed25519:${privateKey.toString('base64')}`;

  if (outputDir) {
    const resolvedDir = path.resolve(outputDir);
    await fsp.mkdir(resolvedDir, { recursive: true });

    const pubPath = path.join(resolvedDir, 'registry-key.pub');
    const privPath = path.join(resolvedDir, 'registry-key.priv');

    await fsp.writeFile(pubPath, pubKeyStr + '\n', 'utf-8');
    await fsp.writeFile(privPath, privKeyStr + '\n', { mode: 0o600, encoding: 'utf-8' });

    console.log(`  ${c.green}Keys written:${c.reset}`);
    console.log(`    Public:  ${pubPath}`);
    console.log(`    Private: ${privPath}`);
    console.log(`\n  ${c.yellow}Keep the private key secret!${c.reset}`);
  } else {
    console.log(`  ${c.bold}Public Key:${c.reset}`);
    console.log(`  ${pubKeyStr}`);
    console.log('');
    console.log(`  ${c.bold}Private Key:${c.reset}`);
    console.log(`  ${privKeyStr}`);
    console.log(`\n  ${c.yellow}Keep the private key secret!${c.reset}`);
  }
  console.log('');
}

/**
 * Sign a registry directory with an Ed25519 private key
 */
async function registrySign(dir, privateKeyStr) {
  if (!dir) {
    console.error('Error: registry sign requires a directory path');
    console.error('Usage: quilltap themes registry sign <dir> --key <private-key>');
    process.exit(1);
  }
  if (!privateKeyStr) {
    console.error('Error: registry sign requires --key <private-key>');
    console.error('Usage: quilltap themes registry sign <dir> --key <private-key>');
    process.exit(1);
  }

  const resolvedDir = path.resolve(dir);
  console.log(`\n${c.bold}Signing registry directory:${c.reset} ${resolvedDir}\n`);

  // Parse the private key
  let keyBuffer;
  if (privateKeyStr.startsWith('ed25519:')) {
    keyBuffer = Buffer.from(privateKeyStr.slice(8), 'base64');
  } else {
    // Try reading as a file path
    try {
      const fileContent = (await fsp.readFile(privateKeyStr, 'utf-8')).trim();
      if (fileContent.startsWith('ed25519:')) {
        keyBuffer = Buffer.from(fileContent.slice(8), 'base64');
      } else {
        console.error(`  ${c.red}Error:${c.reset} Invalid key format. Expected "ed25519:<base64>".`);
        process.exit(1);
      }
    } catch {
      console.error(`  ${c.red}Error:${c.reset} Invalid key format and not a readable file path.`);
      process.exit(1);
    }
  }

  const privateKey = crypto.createPrivateKey({
    key: keyBuffer,
    format: 'der',
    type: 'pkcs8',
  });

  // Collect all files recursively (excluding signature.json)
  async function collectFiles(dirPath, basePath) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(basePath, fullPath);
      if (entry.isDirectory()) {
        files.push(...await collectFiles(fullPath, basePath));
      } else if (entry.name !== 'signature.json') {
        files.push(relPath);
      }
    }
    return files.sort();
  }

  const files = await collectFiles(resolvedDir, resolvedDir);
  const fileHashes = {};

  for (const relPath of files) {
    const fullPath = path.join(resolvedDir, relPath);
    const content = await fsp.readFile(fullPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    fileHashes[relPath] = hash;
  }

  // Create canonical hash data string
  const hashData = Object.entries(fileHashes)
    .map(([file, hash]) => `${hash}  ${file}`)
    .join('\n');

  // Sign the hash data
  const signature = crypto.sign(null, Buffer.from(hashData, 'utf-8'), privateKey);
  const signatureB64 = signature.toString('base64');

  // Write signature.json
  const signatureDoc = {
    version: 1,
    algorithm: 'ed25519',
    signature: signatureB64,
    files: fileHashes,
    signedAt: new Date().toISOString(),
  };

  const sigPath = path.join(resolvedDir, 'signature.json');
  await fsp.writeFile(sigPath, JSON.stringify(signatureDoc, null, 2), 'utf-8');

  console.log(`  ${c.green}Signed ${files.length} files${c.reset}`);
  console.log(`  Signature written to: ${sigPath}`);
  console.log('');
}

/**
 * Handle registry subcommands
 */
async function registryCommand(args, dataDir) {
  const subcommand = args[0] || '';
  const subArgs = args.slice(1);

  // Parse options from subArgs
  const positional = [];
  const options = {};
  let i = 0;
  while (i < subArgs.length) {
    switch (subArgs[i]) {
      case '--key': case '-k': options.key = subArgs[++i]; break;
      case '--name': case '-n': options.name = subArgs[++i]; break;
      case '--output': case '-o': options.output = subArgs[++i]; break;
      default:
        if (subArgs[i] && !subArgs[i].startsWith('-')) {
          positional.push(subArgs[i]);
        } else if (subArgs[i]) {
          console.error(`Unknown option: ${subArgs[i]}`);
          process.exit(1);
        }
        break;
    }
    i++;
  }

  switch (subcommand) {
    case 'list':
      await registryList(dataDir);
      break;

    case 'add':
      await registryAdd(positional[0], options, dataDir);
      break;

    case 'remove':
      await registryRemove(positional[0], dataDir);
      break;

    case 'refresh':
      await registryRefresh(dataDir);
      break;

    case 'keygen':
      await registryKeygen(options.output);
      break;

    case 'sign':
      await registrySign(positional[0], options.key);
      break;

    default:
      if (subcommand) {
        console.error(`Unknown registry command: ${subcommand}`);
      }
      console.log(`
${c.bold}Registry Commands${c.reset}

Usage: quilltap themes registry <command> [options]

${c.bold}Commands:${c.reset}
  list                              List configured registries
  add <url> [--key <pubkey>] [--name <name>]
                                    Add a new registry source
  remove <name>                     Remove a registry source
  refresh                           Refresh all registry indexes

${c.bold}For Registry Operators:${c.reset}
  keygen [--output <dir>]           Generate Ed25519 keypair
  sign <dir> --key <private-key>    Sign a registry directory
`);
      if (!subcommand) process.exit(0);
      process.exit(1);
  }
}

// ============================================================================
// HELP
// ============================================================================

function printHelp() {
  console.log(`
${c.bold}Quilltap Theme Manager${c.reset}

Usage: quilltap themes <command> [options]

${c.bold}Commands:${c.reset}
  list                         List installed theme bundles
  install <file>               Install a .qtap-theme bundle
  uninstall <id>               Uninstall a theme bundle
  validate <file>              Validate a .qtap-theme file
  export <id> [--output <path>]  Export a theme as .qtap-theme
  create <name>                Create a new theme (delegates to create-quilltap-theme)
  search <query>               Search across registries for themes
  update [id]                  Update one or all themes from registry

${c.bold}Registry Commands:${c.reset}
  registry list                List configured registries
  registry add <url>           Add a new registry source
    [--key <pubkey>]             Ed25519 public key for verification
    [--name <name>]              Display name (default: derived from URL)
  registry remove <name>       Remove a registry source
  registry refresh             Refresh all registry indexes

${c.bold}Registry Operator Commands:${c.reset}
  registry keygen [--output <dir>]           Generate Ed25519 keypair
  registry sign <dir> --key <private-key>    Sign a registry directory

${c.bold}Options:${c.reset}
  --data-dir <path>            Override data directory
  -h, --help                   Show this help

${c.bold}Examples:${c.reset}
  quilltap themes list
  quilltap themes validate my-theme.qtap-theme
  quilltap themes install my-theme.qtap-theme
  quilltap themes uninstall my-theme
  quilltap themes export my-theme --output ./my-theme.qtap-theme
  quilltap themes create sunset
  quilltap themes registry add https://themes.example.com/index.json --name example
  quilltap themes registry refresh
  quilltap themes search steampunk
  quilltap themes update my-theme
`);
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function themesCommand(args) {
  let dataDirOverride = '';
  let showHelp = false;
  let command = '';
  const positional = [];
  let outputPath = '';
  // Track where the command was found so we can pass remaining args to sub-dispatchers
  let commandIndex = -1;

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--data-dir': case '-d': dataDirOverride = args[++i]; break;
      case '--output': case '-o': outputPath = args[++i]; break;
      case '--help': case '-h': showHelp = true; break;
      default:
        if (args[i].startsWith('-')) {
          // For registry/search/update, pass unknown flags through
          if (command === 'registry' || command === 'search' || command === 'update') {
            positional.push(args[i]);
          } else {
            console.error(`Unknown option: ${args[i]}`);
            process.exit(1);
          }
        } else if (!command) {
          command = args[i];
          commandIndex = i;
        } else {
          positional.push(args[i]);
        }
        break;
    }
    i++;
  }

  if (showHelp || !command) {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case 'list':
      await listThemes(dataDirOverride);
      break;

    case 'validate': {
      if (positional.length === 0) {
        console.error('Error: validate requires a file path');
        console.error('Usage: quilltap themes validate <file.qtap-theme>');
        process.exit(1);
      }
      const isValid = await validateTheme(positional[0]);
      process.exit(isValid ? 0 : 1);
      break;
    }

    case 'install': {
      if (positional.length === 0) {
        console.error('Error: install requires a file path');
        console.error('Usage: quilltap themes install <file.qtap-theme>');
        process.exit(1);
      }
      const installed = await installTheme(positional[0], dataDirOverride);
      process.exit(installed ? 0 : 1);
      break;
    }

    case 'uninstall': {
      if (positional.length === 0) {
        console.error('Error: uninstall requires a theme ID');
        console.error('Usage: quilltap themes uninstall <theme-id>');
        process.exit(1);
      }
      const uninstalled = await uninstallTheme(positional[0], dataDirOverride);
      process.exit(uninstalled ? 0 : 1);
      break;
    }

    case 'export': {
      if (positional.length === 0) {
        console.error('Error: export requires a theme ID');
        console.error('Usage: quilltap themes export <theme-id> [--output <path>]');
        process.exit(1);
      }
      const exported = await exportTheme(positional[0], outputPath, dataDirOverride);
      process.exit(exported ? 0 : 1);
      break;
    }

    case 'create': {
      // Delegate to create-quilltap-theme
      const createArgs = positional.join(' ');
      console.log(`\nDelegating to create-quilltap-theme...\n`);
      try {
        execSync(`npx create-quilltap-theme ${createArgs}`, {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
      } catch {
        process.exit(1);
      }
      break;
    }

    case 'registry':
      // Pass all args after 'registry' (including flags) to the sub-dispatcher
      await registryCommand(positional, dataDirOverride);
      break;

    case 'search':
      await searchThemes(positional[0], dataDirOverride);
      break;

    case 'update':
      await updateThemes(positional[0] || null, dataDirOverride);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

module.exports = { themesCommand };
