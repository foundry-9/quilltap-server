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

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--data-dir': case '-d': dataDirOverride = args[++i]; break;
      case '--output': case '-o': outputPath = args[++i]; break;
      case '--help': case '-h': showHelp = true; break;
      default:
        if (args[i].startsWith('-')) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
        if (!command) {
          command = args[i];
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

    case 'validate':
      if (positional.length === 0) {
        console.error('Error: validate requires a file path');
        console.error('Usage: quilltap themes validate <file.qtap-theme>');
        process.exit(1);
      }
      const isValid = await validateTheme(positional[0]);
      process.exit(isValid ? 0 : 1);
      break;

    case 'install':
      if (positional.length === 0) {
        console.error('Error: install requires a file path');
        console.error('Usage: quilltap themes install <file.qtap-theme>');
        process.exit(1);
      }
      const installed = await installTheme(positional[0], dataDirOverride);
      process.exit(installed ? 0 : 1);
      break;

    case 'uninstall':
      if (positional.length === 0) {
        console.error('Error: uninstall requires a theme ID');
        console.error('Usage: quilltap themes uninstall <theme-id>');
        process.exit(1);
      }
      const uninstalled = await uninstallTheme(positional[0], dataDirOverride);
      process.exit(uninstalled ? 0 : 1);
      break;

    case 'export':
      if (positional.length === 0) {
        console.error('Error: export requires a theme ID');
        console.error('Usage: quilltap themes export <theme-id> [--output <path>]');
        process.exit(1);
      }
      const exported = await exportTheme(positional[0], outputPath, dataDirOverride);
      process.exit(exported ? 0 : 1);
      break;

    case 'create':
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

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

module.exports = { themesCommand };
