#!/usr/bin/env tsx
/**
 * Convert Theme to Module Script
 *
 * Converts file-based theme plugins (tokens.json + styles.css) to
 * self-contained module format that exports a ThemePlugin object.
 *
 * Usage:
 *   tsx scripts/convert-theme-to-module.ts <plugin-name>
 *   tsx scripts/convert-theme-to-module.ts --all
 *   tsx scripts/convert-theme-to-module.ts qtap-plugin-theme-ocean
 *
 * Options:
 *   --all         Convert all theme plugins
 *   --embed-fonts Embed fonts as base64 data URLs (default: false)
 *   --dry-run     Show what would be generated without writing files
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

interface ManifestThemeConfig {
  tokensPath?: string;
  stylesPath?: string;
  supportsDarkMode?: boolean;
  previewImage?: string;
  extendsTheme?: string | null;
  tags?: string[];
  fonts?: Array<{
    family: string;
    src: string;
    weight?: string;
    style?: string;
    display?: string;
  }>;
  useModule?: boolean;
}

interface PluginManifest {
  name: string;
  title: string;
  description?: string;
  version: string;
  author: string | { name: string; email?: string; url?: string };
  capabilities?: string[];
  themeConfig?: ManifestThemeConfig;
}

interface ConversionResult {
  name: string;
  success: boolean;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

const args = process.argv.slice(2);
const convertAll = args.includes('--all');
const embedFonts = args.includes('--embed-fonts');
const dryRun = args.includes('--dry-run');
const targetPlugins = args.filter(a => !a.startsWith('--'));

/**
 * Get MIME type for font file
 */
function getFontMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case '.woff2': return 'font/woff2';
    case '.woff': return 'font/woff';
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    case '.eot': return 'application/vnd.ms-fontobject';
    default: return 'application/octet-stream';
  }
}

/**
 * Discover all theme plugins
 */
function discoverThemePlugins(): Array<{ name: string; path: string; manifest: PluginManifest }> {
  const cwd = process.cwd();
  const pluginsDir = join(cwd, 'plugins', 'dist');
  const plugins: Array<{ name: string; path: string; manifest: PluginManifest }> = [];

  try {
    const entries = readdirSync(pluginsDir);

    for (const entry of entries) {
      const fullPath = join(pluginsDir, entry);

      if (!statSync(fullPath).isDirectory()) {
        continue;
      }

      // Check for manifest.json with THEME capability
      const manifestPath = join(fullPath, 'manifest.json');
      try {
        const manifestContent = readFileSync(manifestPath, 'utf-8');
        const manifest: PluginManifest = JSON.parse(manifestContent);

        if (manifest.capabilities?.includes('THEME')) {
          plugins.push({
            name: manifest.name || entry,
            path: fullPath,
            manifest,
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
 * Convert a theme plugin to module format
 */
function convertThemePlugin(plugin: { name: string; path: string; manifest: PluginManifest }): ConversionResult {
  const { name, path: pluginPath, manifest } = plugin;
  const themeConfig = manifest.themeConfig;

  if (!themeConfig) {
    return { name, success: false, skipped: true, reason: 'No themeConfig in manifest' };
  }

  // Check if already using module format (has useModule: true and no tokens.json)
  if (themeConfig.useModule === true) {
    return { name, success: true, skipped: true, reason: 'Already using module format' };
  }

  try {
    // Read tokens.json
    const tokensPath = join(pluginPath, themeConfig.tokensPath || 'tokens.json');
    if (!existsSync(tokensPath)) {
      return { name, success: false, error: `tokens.json not found at ${tokensPath}` };
    }
    const tokensContent = readFileSync(tokensPath, 'utf-8');
    const tokens = JSON.parse(tokensContent);

    // Read styles.css if it exists
    let cssOverrides: string | undefined;
    if (themeConfig.stylesPath) {
      const stylesPath = join(pluginPath, themeConfig.stylesPath);
      if (existsSync(stylesPath)) {
        cssOverrides = readFileSync(stylesPath, 'utf-8');
      }
    }

    // Process fonts
    const embeddedFonts: Array<{
      family: string;
      weight: string;
      style: string;
      data: string;
    }> = [];

    if (embedFonts && themeConfig.fonts && themeConfig.fonts.length > 0) {
      for (const fontDef of themeConfig.fonts) {
        const fontPath = join(pluginPath, fontDef.src);
        if (existsSync(fontPath)) {
          const fontData = readFileSync(fontPath);
          const mimeType = getFontMimeType(fontDef.src);
          const base64 = fontData.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64}`;

          embeddedFonts.push({
            family: fontDef.family,
            weight: fontDef.weight || '400',
            style: fontDef.style || 'normal',
            data: dataUrl,
          });
        }
      }
    }

    // Extract theme metadata
    const authorName = typeof manifest.author === 'string'
      ? manifest.author
      : manifest.author.name;

    // Generate the module code
    const moduleCode = generateModuleCode({
      tokens,
      cssOverrides,
      embeddedFonts,
      metadata: {
        id: extractThemeId(name),
        displayName: manifest.title,
        description: manifest.description,
        author: authorName,
        supportsDarkMode: themeConfig.supportsDarkMode ?? true,
        previewImage: themeConfig.previewImage,
        tags: themeConfig.tags || [],
      },
      pluginName: name,
      version: manifest.version,
    });

    if (dryRun) {
      console.log(`\n--- Generated module for ${name} ---\n`);
      console.log(moduleCode.substring(0, 2000) + (moduleCode.length > 2000 ? '\n...(truncated)' : ''));
      console.log(`\n--- End of ${name} ---\n`);
    } else {
      // Write the new index.js
      const outputPath = join(pluginPath, 'index.js');
      writeFileSync(outputPath, moduleCode, 'utf-8');
      console.log(`  ✅ Generated ${outputPath}`);

      // Update manifest to use module loading
      manifest.themeConfig!.useModule = true;
      const manifestPath = join(pluginPath, 'manifest.json');
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      console.log(`  ✅ Updated manifest.json`);
    }

    return { name, success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { name, success: false, error: errorMessage };
  }
}

/**
 * Extract theme ID from plugin name
 */
function extractThemeId(pluginName: string): string {
  const prefix = 'qtap-plugin-theme-';
  if (pluginName.startsWith(prefix)) {
    return pluginName.slice(prefix.length);
  }
  return pluginName.replace('qtap-plugin-', '');
}

/**
 * Generate the self-contained module code
 */
function generateModuleCode(options: {
  tokens: unknown;
  cssOverrides?: string;
  embeddedFonts: Array<{ family: string; weight: string; style: string; data: string }>;
  metadata: {
    id: string;
    displayName: string;
    description?: string;
    author: string;
    supportsDarkMode: boolean;
    previewImage?: string;
    tags: string[];
  };
  pluginName: string;
  version: string;
}): string {
  const { tokens, cssOverrides, embeddedFonts, metadata, pluginName, version } = options;

  // Escape backticks and ${} in CSS
  const escapedCss = cssOverrides
    ? cssOverrides.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
    : undefined;

  const fontsArrayStr = embeddedFonts.length > 0
    ? `[
${embeddedFonts.map(f => `    {
      family: ${JSON.stringify(f.family)},
      weight: ${JSON.stringify(f.weight)},
      style: ${JSON.stringify(f.style)},
      data: ${JSON.stringify(f.data)},
    }`).join(',\n')}
  ]`
    : 'undefined';

  return `/**
 * ${metadata.displayName} Theme Plugin
 *
 * Self-contained theme plugin with embedded tokens and styles.
 * Generated by convert-theme-to-module.ts
 *
 * @module ${pluginName}
 */

/**
 * Theme tokens - embedded from tokens.json
 */
const tokens = ${JSON.stringify(tokens, null, 2)};

/**
 * CSS overrides for component styling
 */
const cssOverrides = ${escapedCss ? `\`${escapedCss}\`` : 'undefined'};

/**
 * Embedded fonts (base64 data URLs)
 */
const fonts = ${fontsArrayStr};

/**
 * Theme metadata
 */
const metadata = {
  id: ${JSON.stringify(metadata.id)},
  displayName: ${JSON.stringify(metadata.displayName)},
  description: ${JSON.stringify(metadata.description)},
  author: ${JSON.stringify(metadata.author)},
  supportsDarkMode: ${metadata.supportsDarkMode},
  previewImage: ${metadata.previewImage ? JSON.stringify(metadata.previewImage) : 'undefined'},
  tags: ${JSON.stringify(metadata.tags)},
};

/**
 * The complete theme plugin export
 * Conforms to ThemePlugin interface from @quilltap/plugin-types
 */
const plugin = {
  metadata,
  tokens,
  cssOverrides,
  fonts,

  /**
   * Optional initialization hook
   */
  initialize() {
    // Theme loaded successfully
    if (typeof console !== 'undefined') {
    }
  },
};

// CommonJS export
module.exports = { plugin };

// Also export individual parts for flexibility
module.exports.plugin = plugin;
module.exports.tokens = tokens;
module.exports.metadata = metadata;
module.exports.cssOverrides = cssOverrides;
module.exports.fonts = fonts;
`;
}

/**
 * Main function
 */
async function main() {
  console.log('🎨 Theme Plugin Module Converter\n');

  if (dryRun) {
    console.log('  --dry-run: Will show generated code without writing files\n');
  }

  if (embedFonts) {
    console.log('  --embed-fonts: Will embed fonts as base64 data URLs\n');
  }

  // Discover all theme plugins
  const allPlugins = discoverThemePlugins();

  if (allPlugins.length === 0) {
    console.log('No theme plugins found.');
    return;
  }

  // Filter to target plugins
  let plugins = allPlugins;
  if (!convertAll && targetPlugins.length > 0) {
    plugins = allPlugins.filter(p => targetPlugins.includes(p.name));
    if (plugins.length === 0) {
      console.error(`No matching plugins found. Available theme plugins:`);
      for (const p of allPlugins) {
        console.error(`  - ${p.name}`);
      }
      process.exit(1);
    }
  } else if (!convertAll) {
    console.log('Usage:');
    console.log('  tsx scripts/convert-theme-to-module.ts <plugin-name>');
    console.log('  tsx scripts/convert-theme-to-module.ts --all');
    console.log('');
    console.log('Available theme plugins:');
    for (const p of allPlugins) {
      console.log(`  - ${p.name}`);
    }
    return;
  }

  console.log(`Converting ${plugins.length} theme plugin(s):\n`);

  const results: ConversionResult[] = [];

  for (const plugin of plugins) {
    console.log(`📦 ${plugin.name}`);
    const result = convertThemePlugin(plugin);
    results.push(result);

    if (result.skipped) {
      console.log(`  ⏭️  Skipped: ${result.reason}`);
    } else if (!result.success) {
      console.log(`  ❌ Failed: ${result.error}`);
    }
    console.log('');
  }

  // Summary
  const succeeded = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.success && !r.skipped).length;

  console.log('📊 Conversion Summary:');
  console.log(`  Total:     ${plugins.length}`);
  console.log(`  Converted: ${succeeded}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n💡 Run without --dry-run to write files.');
  } else if (succeeded > 0) {
    console.log('\n✅ Conversion complete!');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
