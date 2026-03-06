#!/usr/bin/env bash
# Convert plugin themes to .qtap-theme bundle directories
# This script creates themes/bundled/<id>/ directories from plugins/dist/qtap-plugin-theme-*/

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

node -e "
const fs = require('fs');
const path = require('path');

const projectDir = '${PROJECT_DIR}';
const pluginsDir = path.join(projectDir, 'plugins/dist');
const bundledDir = path.join(projectDir, 'themes/bundled');

const themes = {
  'qtap-plugin-theme-art-deco': 'art-deco',
  'qtap-plugin-theme-earl-grey': 'earl-grey',
  'qtap-plugin-theme-great-estate': 'great-estate',
  'qtap-plugin-theme-old-school': 'old-school',
  'qtap-plugin-theme-rains': 'rains',
};

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

for (const [pluginName, themeId] of Object.entries(themes)) {
  const pluginDir = path.join(pluginsDir, pluginName);
  const bundleDir = path.join(bundledDir, themeId);
  const manifestPath = path.join(pluginDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.log('  SKIP: ' + pluginName + ' not found');
    continue;
  }

  console.log('  Converting ' + pluginName + ' -> ' + themeId);

  // Clean and create bundle directory
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });

  // Copy tokens.json
  const tokensPath = path.join(pluginDir, 'tokens.json');
  if (fs.existsSync(tokensPath)) {
    fs.copyFileSync(tokensPath, path.join(bundleDir, 'tokens.json'));
  }

  // Copy styles.css
  const stylesPath = path.join(pluginDir, 'styles.css');
  if (fs.existsSync(stylesPath)) {
    fs.copyFileSync(stylesPath, path.join(bundleDir, 'styles.css'));
  }

  // Copy fonts directory
  const fontsDir = path.join(pluginDir, 'fonts');
  if (fs.existsSync(fontsDir)) {
    copyDirSync(fontsDir, path.join(bundleDir, 'fonts'));
  }

  // Read plugin manifest and create theme.json
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const themeConfig = manifest.themeConfig || {};

  const themeManifest = {
    format: 'qtap-theme',
    formatVersion: 1,
    id: themeId,
    name: manifest.title,
    description: manifest.description,
    version: manifest.version,
    author: typeof manifest.author === 'object' ? manifest.author.name : manifest.author,
    license: manifest.license || 'MIT',
    supportsDarkMode: themeConfig.supportsDarkMode !== false,
    tags: themeConfig.tags || [],
    tokensPath: 'tokens.json',
  };

  // Add styles path if styles.css exists
  if (fs.existsSync(path.join(bundleDir, 'styles.css'))) {
    themeManifest.stylesPath = 'styles.css';
  }

  // Convert fonts (filter out external URLs)
  if (themeConfig.fonts && themeConfig.fonts.length > 0) {
    themeManifest.fonts = themeConfig.fonts
      .filter(f => !f.src.startsWith('http'))
      .map(f => ({
        family: f.family,
        src: f.src,
        weight: f.weight || '400',
        style: f.style || 'normal',
        display: f.display || 'swap',
      }));
  }

  // Include subsystems if present
  if (themeConfig.subsystems) {
    themeManifest.subsystems = themeConfig.subsystems;
  }

  fs.writeFileSync(
    path.join(bundleDir, 'theme.json'),
    JSON.stringify(themeManifest, null, 2) + '\\n',
    'utf-8'
  );

  console.log('  Created: ' + themeId + '/theme.json');
}

console.log('');
console.log('  Bundled theme conversion complete.');
"
