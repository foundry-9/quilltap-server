/**
 * Theme Registry
 *
 * Singleton registry for managing loaded theme plugins.
 * Handles loading theme tokens from plugin files, theme inheritance,
 * and provides access to available themes.
 *
 * @module themes/theme-registry
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { pluginRegistry, getEnabledPluginsByCapability } from '@/lib/plugins';
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader';
import type { ThemeTokens, ThemeManifest } from './types';
import { safeValidateThemeTokens } from './types';
import { DEFAULT_THEME_TOKENS, DEFAULT_THEME_METADATA } from './default-tokens';
import { mergeThemeTokens, themeTokensToCSS } from './utils';
import { getErrorMessage } from '@/lib/errors';
import type { ThemePlugin, EmbeddedFont } from '@quilltap/plugin-types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Font definition for loaded themes
 */
export interface LoadedThemeFont {
  /** Font family name */
  family: string;
  /** Font file path (absolute) - empty for embedded fonts */
  filePath: string;
  /** Font weight */
  weight: string;
  /** Font style */
  style: string;
  /** Font display strategy */
  display: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /** Plugin name (for URL construction) */
  pluginName: string;
  /** Original source path (relative to plugin) or data URL for embedded */
  src: string;
  /** Whether this font is embedded (data URL or base64) */
  isEmbedded?: boolean;
  /** Embedded font data (base64 or data URL) */
  embeddedData?: string;
}

/**
 * A loaded theme with all its data
 */
export interface LoadedTheme {
  /** Theme identifier (derived from plugin name) */
  id: string;

  /** Theme display name */
  name: string;

  /** Theme description */
  description?: string;

  /** Theme version */
  version: string;

  /** Theme author */
  author: string | { name: string; email?: string; url?: string };

  /** Whether this theme supports dark mode */
  supportsDarkMode: boolean;

  /** Theme tokens */
  tokens: ThemeTokens;

  /** Optional component override CSS */
  cssOverrides?: string;

  /** Preview image path (relative to plugin) */
  previewImage?: string;

  /** Absolute path to preview image (for serving) */
  previewImagePath?: string;

  /** Theme tags for categorization */
  tags: string[];

  /** Source plugin name */
  pluginName: string;

  /** Whether this is the built-in default theme */
  isDefault: boolean;

  /** Custom fonts bundled with the theme */
  fonts?: LoadedThemeFont[];
}

/**
 * Theme loading error
 */
export interface ThemeLoadError {
  themeId: string;
  pluginName: string;
  error: string;
  details?: unknown;
}

/**
 * Theme registry state
 */
export interface ThemeRegistryState {
  initialized: boolean;
  themes: Map<string, LoadedTheme>;
  errors: ThemeLoadError[];
  lastInitTime: Date | null;
}

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our theme registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapThemeRegistryState: ThemeRegistryState | undefined;
}

/**
 * Get or create the global registry state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): ThemeRegistryState {
  if (!global.__quilltapThemeRegistryState) {
    global.__quilltapThemeRegistryState = {
      initialized: false,
      themes: new Map(),
      errors: [],
      lastInitTime: null,
    };
  }
  return global.__quilltapThemeRegistryState;
}

// ============================================================================
// THEME REGISTRY CLASS
// ============================================================================

class ThemeRegistry {
  private get state(): ThemeRegistryState {
    return getGlobalState();
  }

  /**
   * Initialize the theme registry by loading themes from enabled THEME plugins
   * Note: Module-based themes should be registered via registerThemeModule() before calling this
   */
  async initialize(): Promise<void> {
    // Clear errors but preserve themes registered via registerThemeModule()
    this.state.errors = [];

    // Register the default theme if not already present
    if (!this.state.themes.has('default')) {
      this.registerDefaultTheme();
    }

    // Get enabled theme plugins
    const themePlugins = getEnabledPluginsByCapability('THEME');
    // Load each theme plugin
    for (const plugin of themePlugins) {
      try {
        await this.loadThemeFromPlugin(plugin);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.error('Failed to load theme from plugin', {
          plugin: plugin.manifest.name,
          error: errorMessage,
        });
        this.state.errors.push({
          themeId: this.extractThemeId(plugin.manifest.name),
          pluginName: plugin.manifest.name,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();
  }

  /**
   * Register the built-in default theme
   */
  private registerDefaultTheme(): void {
    const defaultTheme: LoadedTheme = {
      id: 'default',
      name: DEFAULT_THEME_METADATA.name,
      description: DEFAULT_THEME_METADATA.description,
      version: DEFAULT_THEME_METADATA.version,
      author: DEFAULT_THEME_METADATA.author,
      supportsDarkMode: DEFAULT_THEME_METADATA.supportsDarkMode,
      tokens: DEFAULT_THEME_TOKENS,
      tags: [...DEFAULT_THEME_METADATA.tags],
      pluginName: 'built-in',
      isDefault: true,
    };

    this.state.themes.set('default', defaultTheme);
  }

  /**
   * Extract theme ID from plugin name
   * qtap-plugin-theme-ocean -> ocean
   */
  private extractThemeId(pluginName: string): string {
    const prefix = 'qtap-plugin-theme-';
    if (pluginName.startsWith(prefix)) {
      return pluginName.slice(prefix.length);
    }
    // Fallback: use full plugin name
    return pluginName.replace('qtap-plugin-', '');
  }

  /**
   * Load a theme from a plugin (file-based loading only)
   * Module-based themes should be registered via registerThemeModule()
   */
  private async loadThemeFromPlugin(plugin: LoadedPlugin): Promise<void> {
    const themeId = this.extractThemeId(plugin.manifest.name);

    // Check if this theme was already registered via module loading
    if (this.state.themes.has(themeId)) {
      return;
    }

    // Fall back to file-based loading
    await this.loadThemeFromFiles(plugin, themeId);
  }

  /**
   * Register a pre-loaded theme module
   * Called from plugin-initialization.ts after dynamic require
   */
  registerThemeModule(
    plugin: LoadedPlugin,
    themePlugin: ThemePlugin
  ): boolean {
    const themeId = this.extractThemeId(plugin.manifest.name);
    // Check if module exports a theme plugin
    if (!themePlugin?.tokens) {
      return false;
    }

    // Validate the tokens
    const validationResult = safeValidateThemeTokens(themePlugin.tokens);
    if (!validationResult.success) {
      throw new Error(
        `Invalid theme tokens in module: ${validationResult.errors.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')}`
      );
    }

    let tokens = validationResult.data;

    // Handle theme inheritance if themeConfig specifies it
    const themeConfig = plugin.manifest.themeConfig;
    if (themeConfig?.extendsTheme) {
      const baseTheme = this.state.themes.get(
        this.extractThemeId(themeConfig.extendsTheme)
      );
      if (baseTheme) {
        tokens = mergeThemeTokens(baseTheme.tokens, tokens);
      } else {
        tokens = mergeThemeTokens(DEFAULT_THEME_TOKENS, tokens);
      }
    }

    // Convert embedded fonts to LoadedThemeFont format
    const fonts: LoadedThemeFont[] = [];
    if (themePlugin.fonts && themePlugin.fonts.length > 0) {
      for (const font of themePlugin.fonts) {
        fonts.push({
          family: font.family,
          filePath: '', // Embedded fonts don't have file paths
          weight: font.weight,
          style: font.style || 'normal',
          display: 'swap',
          pluginName: plugin.manifest.name,
          src: font.data, // Store the data URL or base64 directly
          // Mark as embedded for special handling
          isEmbedded: true,
          embeddedData: font.data,
        } as LoadedThemeFont & { isEmbedded?: boolean; embeddedData?: string });
      }
    }

    // Create the loaded theme
    const loadedTheme: LoadedTheme = {
      id: themeId,
      name: themePlugin.metadata.displayName,
      description: themePlugin.metadata.description,
      version: plugin.manifest.version,
      author: themePlugin.metadata.author || plugin.manifest.author,
      supportsDarkMode: themePlugin.metadata.supportsDarkMode,
      tokens,
      cssOverrides: themePlugin.cssOverrides,
      previewImage: themePlugin.metadata.previewImage,
      previewImagePath: themePlugin.metadata.previewImage?.startsWith('data:')
        ? undefined // Don't set path for data URLs
        : themePlugin.metadata.previewImage
          ? path.join(plugin.pluginPath, themePlugin.metadata.previewImage)
          : undefined,
      tags: themePlugin.metadata.tags || [],
      pluginName: plugin.manifest.name,
      isDefault: false,
      fonts: fonts.length > 0 ? fonts : undefined,
    };

    // Register the theme
    this.state.themes.set(themeId, loadedTheme);

    // Call initialize if provided (fire-and-forget)
    if (themePlugin.initialize) {
      try {
        const result = themePlugin.initialize();
        // Handle async initialize
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((error) => {
            logger.warn('Theme initialize() failed', {
              themeId,
              error: getErrorMessage(error),
            });
          });
        }
      } catch (error) {
        logger.warn('Theme initialize() failed', {
          themeId,
          error: getErrorMessage(error),
        });
      }
    }

    logger.info('Theme registered successfully (module-based)', {
      themeId,
      name: loadedTheme.name,
      supportsDarkMode: loadedTheme.supportsDarkMode,
      hasCssOverrides: !!themePlugin.cssOverrides,
      fontCount: fonts.length,
    });

    return true;
  }

  /**
   * Load a theme from files (traditional file-based approach)
   */
  private async loadThemeFromFiles(
    plugin: LoadedPlugin,
    themeId: string
  ): Promise<void> {
    const themeConfig = plugin.manifest.themeConfig;

    if (!themeConfig) {
      throw new Error('Plugin does not have themeConfig');
    }
    // Load tokens file
    const tokensPath = path.join(plugin.pluginPath, themeConfig.tokensPath || 'tokens.json');

    let tokensData: string;
    try {
      tokensData = await fs.readFile(tokensPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read tokens file at ${tokensPath}: ${getErrorMessage(error)}`);
    }

    let rawTokens: unknown;
    try {
      rawTokens = JSON.parse(tokensData);
    } catch (error) {
      throw new Error(`Invalid JSON in tokens file: ${getErrorMessage(error)}`);
    }

    // Validate tokens
    const validationResult = safeValidateThemeTokens(rawTokens);
    if (!validationResult.success) {
      throw new Error(`Invalid theme tokens: ${validationResult.errors.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }

    let tokens = validationResult.data;

    // Handle theme inheritance
    if (themeConfig.extendsTheme) {
      const baseTheme = this.state.themes.get(
        this.extractThemeId(themeConfig.extendsTheme)
      );
      if (baseTheme) {
        tokens = mergeThemeTokens(baseTheme.tokens, tokens);
      } else {
        logger.warn('Base theme not found for inheritance', {
          themeId,
          baseTheme: themeConfig.extendsTheme,
        });
        // Fall back to extending default
        tokens = mergeThemeTokens(DEFAULT_THEME_TOKENS, tokens);
      }
    }

    // Load optional CSS overrides
    let cssOverrides: string | undefined;
    if (themeConfig.stylesPath) {
      const stylesPath = path.join(plugin.pluginPath, themeConfig.stylesPath);
      try {
        cssOverrides = await fs.readFile(stylesPath, 'utf-8');
      } catch (error) {
        logger.warn('Failed to load theme CSS overrides', {
          themeId,
          path: stylesPath,
          error: getErrorMessage(error),
        });
      }
    }

    // Determine preview image path
    let previewImagePath: string | undefined;
    if (themeConfig.previewImage) {
      previewImagePath = path.join(plugin.pluginPath, themeConfig.previewImage);
      // Verify file exists
      try {
        await fs.access(previewImagePath);
      } catch {
        logger.warn('Theme preview image not found', {
          themeId,
          path: previewImagePath,
        });
        previewImagePath = undefined;
      }
    }

    // Load custom fonts
    const fonts: LoadedThemeFont[] = [];
    if (themeConfig.fonts && themeConfig.fonts.length > 0) {
      for (const fontDef of themeConfig.fonts) {
        const fontPath = path.join(plugin.pluginPath, fontDef.src);
        try {
          await fs.access(fontPath);
          fonts.push({
            family: fontDef.family,
            filePath: fontPath,
            weight: fontDef.weight || '400',
            style: fontDef.style || 'normal',
            display: fontDef.display || 'swap',
            pluginName: plugin.manifest.name,
            src: fontDef.src,
          });
        } catch {
          logger.warn('Theme font file not found', {
            themeId,
            family: fontDef.family,
            path: fontPath,
          });
        }
      }
    }

    // Create the loaded theme
    const loadedTheme: LoadedTheme = {
      id: themeId,
      name: plugin.manifest.title,
      description: plugin.manifest.description,
      version: plugin.manifest.version,
      author: plugin.manifest.author,
      supportsDarkMode: themeConfig.supportsDarkMode ?? true,
      tokens,
      cssOverrides,
      previewImage: themeConfig.previewImage,
      previewImagePath,
      tags: themeConfig.tags || plugin.manifest.keywords || [],
      pluginName: plugin.manifest.name,
      isDefault: false,
      fonts: fonts.length > 0 ? fonts : undefined,
    };

    // Register the theme
    this.state.themes.set(themeId, loadedTheme);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get all available themes
   */
  getAll(): LoadedTheme[] {
    return Array.from(this.state.themes.values());
  }

  /**
   * Get a specific theme by ID
   */
  get(themeId: string): LoadedTheme | null {
    return this.state.themes.get(themeId) || null;
  }

  /**
   * Get the default theme
   */
  getDefault(): LoadedTheme {
    return this.state.themes.get('default')!;
  }

  /**
   * Check if a theme exists
   */
  has(themeId: string): boolean {
    return this.state.themes.has(themeId);
  }

  /**
   * Get theme tokens for a specific theme
   * Falls back to default if theme not found
   */
  getTokens(themeId: string | null): ThemeTokens {
    if (!themeId || themeId === 'default') {
      return DEFAULT_THEME_TOKENS;
    }

    const theme = this.state.themes.get(themeId);
    if (!theme) {
      logger.warn('Theme not found, falling back to default', { themeId });
      return DEFAULT_THEME_TOKENS;
    }

    return theme.tokens;
  }

  /**
   * Get CSS for a specific theme
   */
  getCSS(themeId: string | null): string {
    const tokens = this.getTokens(themeId);
    return themeTokensToCSS(tokens);
  }

  /**
   * Get component CSS overrides for a theme
   */
  getCSSOverrides(themeId: string): string | undefined {
    const theme = this.state.themes.get(themeId);
    return theme?.cssOverrides;
  }

  /**
   * Get fonts for a theme
   */
  getFonts(themeId: string): LoadedThemeFont[] {
    const theme = this.state.themes.get(themeId);
    return theme?.fonts || [];
  }

  /**
   * Get themes by tag
   */
  getByTag(tag: string): LoadedTheme[] {
    return this.getAll().filter(theme =>
      theme.tags.some(t => t.toLowerCase() === tag.toLowerCase())
    );
  }

  /**
   * Get all unique tags across all themes
   */
  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const theme of this.state.themes.values()) {
      for (const tag of theme.tags) {
        tags.add(tag.toLowerCase());
      }
    }
    return Array.from(tags).sort();
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const themes = this.getAll();
    return {
      total: themes.length,
      withDarkMode: themes.filter(t => t.supportsDarkMode).length,
      withCssOverrides: themes.filter(t => t.cssOverrides).length,
      errors: this.state.errors.length,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
    };
  }

  /**
   * Get all loading errors
   */
  getErrors(): ThemeLoadError[] {
    return [...this.state.errors];
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Reset the registry (for testing)
   */
  reset(): void {
    // Reset the global state entirely
    global.__quilltapThemeRegistryState = {
      initialized: false,
      themes: new Map(),
      errors: [],
      lastInitTime: null,
    };
  }

  /**
   * Export registry state (for debugging/admin UI)
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      themes: this.getAll().map(theme => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        version: theme.version,
        supportsDarkMode: theme.supportsDarkMode,
        hasCssOverrides: !!theme.cssOverrides,
        tags: theme.tags,
        pluginName: theme.pluginName,
        isDefault: theme.isDefault,
      })),
      errors: this.state.errors,
      stats: this.getStats(),
    };
  }

  /**
   * Get theme metadata for client (without full tokens)
   * Useful for theme picker UI
   * Includes preview colors for theme card swatches
   */
  getThemeList(): Array<{
    id: string;
    name: string;
    description?: string;
    supportsDarkMode: boolean;
    previewImage?: string;
    tags: string[];
    isDefault: boolean;
    previewColors?: {
      light: { background: string; primary: string; secondary: string; accent: string };
      dark: { background: string; primary: string; secondary: string; accent: string };
    };
    headingFont?: {
      family: string;
      url?: string;
    };
  }> {
    return this.getAll().map(theme => {
      // Determine heading font for preview
      // Use fontSerif from tokens as the heading font (matches --qt-heading-font in most themes)
      // For default theme, use fontSans since it uses sans-serif for headings
      let headingFont: { family: string; url?: string } | undefined;

      // Get the heading font family from tokens
      const headingFontFamily = theme.isDefault
        ? theme.tokens.typography?.fontSans
        : theme.tokens.typography?.fontSerif;

      if (headingFontFamily) {
        // Extract the primary font name (first in the stack)
        const primaryFont = headingFontFamily.split(',')[0].trim().replace(/['"]/g, '');

        // Check if this font needs to be loaded (has a matching custom font file)
        const matchingFont = theme.fonts?.find(f => f.family === primaryFont);

        if (matchingFont) {
          headingFont = {
            family: primaryFont,
            url: matchingFont.isEmbedded && matchingFont.embeddedData
              ? matchingFont.embeddedData
              : `/api/themes/fonts/${theme.pluginName}/${matchingFont.src}`,
          };
        } else {
          // System font - no URL needed
          headingFont = {
            family: headingFontFamily,
          };
        }
      }

      return {
        id: theme.id,
        name: theme.name,
        description: theme.description,
        supportsDarkMode: theme.supportsDarkMode,
        previewImage: theme.previewImage,
        tags: theme.tags,
        isDefault: theme.isDefault,
        // Include just the preview colors needed for theme cards
        previewColors: {
          light: {
            background: theme.tokens.colors.light.background,
            primary: theme.tokens.colors.light.primary,
            secondary: theme.tokens.colors.light.secondary,
            accent: theme.tokens.colors.light.accent,
          },
          dark: {
            background: theme.tokens.colors.dark.background,
            primary: theme.tokens.colors.dark.primary,
            secondary: theme.tokens.colors.dark.secondary,
            accent: theme.tokens.colors.dark.accent,
          },
        },
        headingFont,
      };
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global theme registry instance
 */
export const themeRegistry = new ThemeRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get all available themes
 */
export function getAllThemes(): LoadedTheme[] {
  return themeRegistry.getAll();
}

/**
 * Get a specific theme
 */
export function getTheme(themeId: string): LoadedTheme | null {
  return themeRegistry.get(themeId);
}

/**
 * Get the default theme
 */
export function getDefaultTheme(): LoadedTheme {
  return themeRegistry.getDefault();
}

/**
 * Get theme tokens
 */
export function getThemeTokens(themeId: string | null): ThemeTokens {
  return themeRegistry.getTokens(themeId);
}

/**
 * Get theme CSS
 */
export function getThemeCSS(themeId: string | null): string {
  return themeRegistry.getCSS(themeId);
}

/**
 * Check if a theme exists
 */
export function hasTheme(themeId: string): boolean {
  return themeRegistry.has(themeId);
}

/**
 * Get theme registry statistics
 */
export function getThemeStats() {
  return themeRegistry.getStats();
}

/**
 * Initialize the theme registry
 * Should be called after plugin system is initialized
 */
export async function initializeThemeRegistry(): Promise<void> {
  await themeRegistry.initialize();
}
