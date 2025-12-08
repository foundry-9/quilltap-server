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

// ============================================================================
// TYPES
// ============================================================================

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
// THEME REGISTRY CLASS
// ============================================================================

class ThemeRegistry {
  private state: ThemeRegistryState = {
    initialized: false,
    themes: new Map(),
    errors: [],
    lastInitTime: null,
  };

  /**
   * Initialize the theme registry by loading themes from enabled THEME plugins
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();
    logger.info('Initializing theme registry');

    // Clear existing state
    this.state.themes.clear();
    this.state.errors = [];

    // Always register the default theme first
    this.registerDefaultTheme();

    // Get enabled theme plugins
    const themePlugins = getEnabledPluginsByCapability('THEME');

    logger.debug('Found theme plugins', {
      count: themePlugins.length,
      plugins: themePlugins.map(p => p.manifest.name),
    });

    // Load each theme plugin
    for (const plugin of themePlugins) {
      try {
        await this.loadThemeFromPlugin(plugin);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
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

    const duration = Date.now() - startTime;
    logger.info('Theme registry initialized', {
      duration: `${duration}ms`,
      themeCount: this.state.themes.size,
      errorCount: this.state.errors.length,
      themes: Array.from(this.state.themes.keys()),
    });
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
    logger.debug('Registered default theme');
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
   * Load a theme from a plugin
   */
  private async loadThemeFromPlugin(plugin: LoadedPlugin): Promise<void> {
    const themeConfig = plugin.manifest.themeConfig;

    if (!themeConfig) {
      throw new Error('Plugin does not have themeConfig');
    }

    const themeId = this.extractThemeId(plugin.manifest.name);

    logger.debug('Loading theme from plugin', {
      themeId,
      plugin: plugin.manifest.name,
      tokensPath: themeConfig.tokensPath,
    });

    // Load tokens file
    const tokensPath = path.join(plugin.pluginPath, themeConfig.tokensPath || 'tokens.json');

    let tokensData: string;
    try {
      tokensData = await fs.readFile(tokensPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read tokens file at ${tokensPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let rawTokens: unknown;
    try {
      rawTokens = JSON.parse(tokensData);
    } catch (error) {
      throw new Error(`Invalid JSON in tokens file: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validate tokens
    const validationResult = safeValidateThemeTokens(rawTokens);
    if (!validationResult.success) {
      throw new Error(`Invalid theme tokens: ${validationResult.errors.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }

    let tokens = validationResult.data;

    // Handle theme inheritance
    if (themeConfig.extendsTheme) {
      const baseTheme = this.state.themes.get(
        this.extractThemeId(themeConfig.extendsTheme)
      );
      if (baseTheme) {
        tokens = mergeThemeTokens(baseTheme.tokens, tokens);
        logger.debug('Theme extended base theme', {
          themeId,
          baseTheme: themeConfig.extendsTheme,
        });
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
        logger.debug('Loaded theme CSS overrides', {
          themeId,
          path: stylesPath,
          size: cssOverrides.length,
        });
      } catch (error) {
        logger.warn('Failed to load theme CSS overrides', {
          themeId,
          path: stylesPath,
          error: error instanceof Error ? error.message : String(error),
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
    };

    // Register the theme
    this.state.themes.set(themeId, loadedTheme);

    logger.info('Theme loaded successfully', {
      themeId,
      name: loadedTheme.name,
      supportsDarkMode: loadedTheme.supportsDarkMode,
      hasCssOverrides: !!cssOverrides,
    });
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
    this.state.initialized = false;
    this.state.themes.clear();
    this.state.errors = [];
    this.state.lastInitTime = null;
    logger.debug('Theme registry reset');
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
   * Get theme metadata for client (without tokens)
   * Useful for theme picker UI
   */
  getThemeList(): Array<{
    id: string;
    name: string;
    description?: string;
    supportsDarkMode: boolean;
    previewImage?: string;
    tags: string[];
    isDefault: boolean;
  }> {
    return this.getAll().map(theme => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      supportsDarkMode: theme.supportsDarkMode,
      previewImage: theme.previewImage,
      tags: theme.tags,
      isDefault: theme.isDefault,
    }));
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
