/**
 * Theme Registry
 *
 * Singleton registry of the themes Quilltap can wear: the built-in default
 * (which injects nothing — the app's own stylesheet is the default) and every
 * `.qtap-theme` bundle, shipped or installed, validated and compiled by the
 * theme engine when it was loaded (lib/themes/theme-bundle.ts).
 *
 * Themes made for an earlier Quilltap — a version 1 bundle, or a theme a
 * plugin declares — are not registered. They are recorded as refused so the
 * Appearance card can say what became of them.
 *
 * @module themes/theme-registry
 */

import { logger } from '@/lib/logger';
import { getEnabledPluginsByCapability } from '@/lib/plugins';
import type { ThemePreviewImage } from './types';
import { getErrorMessage } from '@/lib/error-utils';
import { loadInstalledBundles, loadBundledThemesFromDir } from './bundle-loader';
import type { LoadedBundleTheme, LoadedBundleSet } from './bundle-loader';
import { compiledThemeCss, defaultThemePreview, type CompiledTheme, type ThemePreview } from './engine/compile';
import { THEME_REGISTRY_VIEW } from './theme-bundle';
import { earlierThemeMessage, type RefusedTheme } from './refused';
import { getBundledThemesDir } from '@/lib/paths';
import { AbstractMapRegistry } from '@/lib/plugins/abstract-map-registry';
import { resolveInsideSync, PathOutsideBaseError } from '@/lib/paths/resolve-inside';

/** The built-in default theme's metadata. */
export const DEFAULT_THEME_METADATA = {
  id: 'default',
  name: 'Default',
  description: 'Professional neutral theme with system fonts and restrained design',
  version: '1.0.0',
  author: 'Quilltap',
  supportsDarkMode: true,
  tags: ['default', 'professional', 'neutral', 'system-fonts'],
} as const;

/**
 * Resolve a manifest-supplied path inside a bundle's directory (symlinks
 * resolved), or return undefined (with a warning) when it would land outside.
 */
function themeFilePath(
  root: string,
  rel: string,
  context: { themeId: string; field: string }
): string | undefined {
  try {
    return resolveInsideSync(root, rel, { realpath: true });
  } catch (err) {
    if (!(err instanceof PathOutsideBaseError)) throw err;
    logger.warn('Ignoring theme path outside the theme directory', {
      themeId: context.themeId,
      field: context.field,
      path: rel,
      reason: err.reason,
    });
    return undefined;
  }
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Font definition for loaded themes
 */
export interface LoadedThemeFont {
  /** Font family name */
  family: string;
  /** Font file path (absolute) */
  filePath: string;
  /** Font weight */
  weight: string;
  /** Font style */
  style: string;
  /** Font display strategy */
  display: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /** Bundle prefix (for URL construction), e.g. "bundle:madmans-box" */
  pluginName: string;
  /** Source path relative to the bundle */
  src: string;
}

/**
 * Per-icon override for loaded themes
 */
export interface LoadedThemeIcon {
  /** Canonical icon name (must match an app IconName to take effect) */
  name: string;
  /** Plugin/bundle name for URL construction (e.g. "bundle:madmans-box") */
  pluginName: string;
  /** Original source path relative to the bundle (e.g. "icons/prospero.webp") */
  src: string;
}

/**
 * Theme source type
 */
export type ThemeSource = 'bundle' | 'default';

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

  /** The theme, compiled: its CSS, choices, features and preview. Absent for the default, which injects nothing. */
  compiled?: CompiledTheme;

  /** Preview image path (relative to the bundle) */
  previewImage?: string;

  /** Absolute path to preview image (for serving) */
  previewImagePath?: string;

  /** Theme tags for categorization */
  tags: string[];

  /** Bundle prefix, or "built-in" for the default */
  pluginName: string;

  /** Whether this is the built-in default theme */
  isDefault: boolean;

  /** Custom fonts bundled with the theme */
  fonts?: LoadedThemeFont[];

  /** Per-icon overrides bundled with the theme */
  icons?: LoadedThemeIcon[];

  /** Subsystem display overrides from the theme */
  subsystems?: Record<string, {
    name?: string;
    description?: string;
    thumbnail?: string;
    backgroundImage?: string;
  }>;

  /** How this theme was loaded */
  source: ThemeSource;

  /** Absolute path to bundle directory (for bundle themes) */
  bundlePath?: string;
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
/** The refused map's key: a plugin's refusal and a bundle's never collide. */
function refusalKey(source: RefusedTheme['source'], id: string): string {
  return `${source}:${id}`;
}

export interface ThemeRegistryState {
  initialized: boolean;
  themes: Map<string, LoadedTheme>;
  errors: Map<string, ThemeLoadError>;
  /** Themes found but not registered: made for an earlier Quilltap. */
  /** Keyed by `refusalKey(source, id)`: a plugin and a bundle may share an id. */
  refused: Map<string, RefusedTheme>;
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

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve a theme asset value to a URL the browser can use.
 *
 * - data URIs, absolute URLs (http/https), and `/`-prefixed paths pass through as-is
 * - relative paths are resolved to the theme asset API route
 * - undefined/empty values return undefined
 */
function resolveThemeAssetUrl(
  value: string | undefined,
  pluginName: string
): string | undefined {
  if (!value) return undefined;
  // explicit "none" — theme wants to suppress the default image
  if (value === 'none') return 'none';
  // data URIs
  if (value.startsWith('data:')) return value;
  // absolute URLs
  if (/^https?:\/\//.test(value)) return value;
  // already rooted
  if (value.startsWith('/')) return value;
  // relative → theme asset route
  return `/api/themes/assets/${pluginName}/${value}`;
}

/**
 * Resolve all image paths inside a subsystems override record.
 */
function resolveSubsystemOverrides(
  raw: Record<string, { name?: string; description?: string; thumbnail?: string; backgroundImage?: string }> | undefined,
  pluginName: string
): Record<string, { name?: string; description?: string; thumbnail?: string; backgroundImage?: string }> | undefined {
  if (!raw || Object.keys(raw).length === 0) return undefined;

  const resolved: Record<string, { name?: string; description?: string; thumbnail?: string; backgroundImage?: string }> = {};
  for (const [id, overrides] of Object.entries(raw)) {
    resolved[id] = {
      ...overrides,
      thumbnail: resolveThemeAssetUrl(overrides.thumbnail, pluginName),
      backgroundImage: resolveThemeAssetUrl(overrides.backgroundImage, pluginName),
    };
  }
  return resolved;
}

// ============================================================================
// THEME REGISTRY CLASS
// ============================================================================

/** The theme picker's entry for one theme. */
export interface ThemeListEntry {
  id: string;
  name: string;
  description?: string;
  supportsDarkMode: boolean;
  previewImage?: string;
  tags: string[];
  isDefault: boolean;
  source: ThemeSource;
  previewColors: ThemePreview['previewColors'];
  headingFont?: {
    family: string;
    url?: string;
  };
}

class ThemeRegistry extends AbstractMapRegistry<
  LoadedTheme,
  ThemeRegistryState,
  ThemeLoadError
> {
  protected readonly registryName = 'theme-registry';
  protected readonly globalStateKey = '__quilltapThemeRegistryState';

  /** The default theme's preview, resolved once from the registry defaults. */
  private defaultPreview: ThemePreview | null = null;

  protected createEmptyState(): ThemeRegistryState {
    return {
      initialized: false,
      themes: new Map(),
      errors: new Map(),
      refused: new Map(),
      lastInitTime: null,
    };
  }

  protected getItemMap(): Map<string, LoadedTheme> {
    return this.state.themes;
  }

  protected getErrorMap(): Map<string, ThemeLoadError> {
    return this.state.errors;
  }

  /**
   * Load the default theme and every bundle; record plugin themes and
   * earlier bundles as refused.
   */
  async initialize(): Promise<void> {
    this.state.errors.clear();
    // State carried across a hot reload may predate the refused map.
    this.state.refused = new Map();

    if (!this.state.themes.has('default')) {
      this.registerDefaultTheme();
    }

    this.recordRefusedPluginThemes();
    await this.loadThemeBundles();

    this.state.initialized = true;
    this.state.lastInitTime = new Date();
    logger.debug('Theme registry initialised', {
      themes: this.state.themes.size,
      refused: this.state.refused.size,
      errors: this.state.errors.size,
    });
  }

  /** Register the built-in default theme. It injects no CSS. */
  private registerDefaultTheme(): void {
    this.state.themes.set('default', {
      id: 'default',
      name: DEFAULT_THEME_METADATA.name,
      description: DEFAULT_THEME_METADATA.description,
      version: DEFAULT_THEME_METADATA.version,
      author: DEFAULT_THEME_METADATA.author,
      supportsDarkMode: DEFAULT_THEME_METADATA.supportsDarkMode,
      tags: [...DEFAULT_THEME_METADATA.tags],
      pluginName: 'built-in',
      isDefault: true,
      source: 'default',
    });
  }

  /**
   * Theme id a plugin name stands for: qtap-plugin-theme-great-estate →
   * great-estate.
   */
  private extractThemeId(pluginName: string): string {
    const prefix = 'qtap-plugin-theme-';
    if (pluginName.startsWith(prefix)) return pluginName.slice(prefix.length);
    return pluginName.replace('qtap-plugin-', '');
  }

  /**
   * A plugin that declares the THEME capability still loads for whatever else
   * it provides, but its theme is a format this Quilltap no longer reads: it
   * is listed as refused, never registered.
   */
  private recordRefusedPluginThemes(): void {
    for (const plugin of getEnabledPluginsByCapability('THEME')) {
      const pluginName = plugin.manifest.name;
      const id = this.extractThemeId(pluginName);
      const name = plugin.manifest.title || pluginName;
      this.state.refused.set(refusalKey('plugin', id), {
        id,
        name,
        version: plugin.manifest.version,
        reason: 'plugin-theme',
        source: 'plugin',
        pluginName,
        message: earlierThemeMessage(name),
      });
      logger.warn('Theme plugin refused: plugin themes are made for an earlier Quilltap', { plugin: pluginName, themeId: id });
    }
  }

  private recordRefusals(set: LoadedBundleSet): void {
    for (const refusal of set.refused) this.recordRefused(refusal);
  }

  private async loadThemeBundles(): Promise<void> {
    // First, the bundled themes shipped with the app
    try {
      const bundled = await loadBundledThemesFromDir(getBundledThemesDir());
      this.recordRefusals(bundled);
      for (const bundle of bundled.loaded) {
        try {
          this.registerBundleTheme(bundle);
        } catch (error) {
          logger.error('Failed to register bundled theme', {
            themeId: bundle.manifest.id,
            error: getErrorMessage(error),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to load bundled themes', { error: getErrorMessage(error) });
    }

    // Then the operator's installed bundles (these can override bundled themes)
    try {
      const installed = await loadInstalledBundles();
      this.recordRefusals(installed);
      for (const bundle of installed.loaded) {
        try {
          this.registerBundleTheme(bundle);
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          logger.error('Failed to register bundle theme', {
            themeId: bundle.manifest.id,
            error: errorMessage,
          });
          this.state.errors.set(bundle.manifest.id, {
            themeId: bundle.manifest.id,
            pluginName: `bundle:${bundle.manifest.id}`,
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to load theme bundles', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Register a loaded bundle: validated and compiled by the theme engine when
   * it was loaded (lib/themes/theme-bundle.ts).
   */
  registerBundleTheme(bundle: LoadedBundleTheme): void {
    const { manifest, compiled, installPath } = bundle;
    const themeId = manifest.id;
    const pluginName = `bundle:${themeId}`;

    const fonts: LoadedThemeFont[] = [];
    for (const fontDef of manifest.fonts ?? []) {
      const fontPath = themeFilePath(installPath, fontDef.src, { themeId, field: 'fonts.src' });
      if (!fontPath) continue;
      fonts.push({
        family: fontDef.family,
        filePath: fontPath,
        weight: fontDef.weight || '400',
        style: fontDef.style || 'normal',
        display: fontDef.display || 'swap',
        pluginName,
        src: fontDef.src,
      });
    }
    const icons: LoadedThemeIcon[] = Object.entries(manifest.icons ?? {}).map(([name, src]) => ({ name, pluginName, src }));

    // A later bundle under this id replaces an earlier refused one; a
    // plugin's refusal stands, since the plugin is still installed.
    this.state.refused.delete(refusalKey('bundle', themeId));
    this.state.themes.set(themeId, {
      id: themeId,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      supportsDarkMode: manifest.supportsDarkMode,
      compiled,
      previewImage: manifest.previewImage,
      previewImagePath: manifest.previewImage
        ? themeFilePath(installPath, manifest.previewImage, { themeId, field: 'previewImage' })
        : undefined,
      tags: manifest.tags || [],
      pluginName,
      isDefault: false,
      source: 'bundle',
      bundlePath: installPath,
      fonts: fonts.length > 0 ? fonts : undefined,
      icons: icons.length > 0 ? icons : undefined,
      subsystems: resolveSubsystemOverrides(manifest.subsystems, pluginName),
    });

    logger.info('Theme registered successfully (bundle)', {
      themeId,
      name: manifest.name,
      version: manifest.version,
      fontCount: fonts.length,
      iconCount: icons.length,
      assetCount: compiled.assets.length,
      choices: compiled.choices,
      features: compiled.features,
    });
  }

  /**
   * Record an installed bundle as refused (an install or a hot load found it
   * made for an earlier Quilltap).
   */
  recordRefused(refusal: RefusedTheme): void {
    this.state.refused.set(refusalKey(refusal.source, refusal.id), refusal);
  }

  /** Forget a refused bundle (after it is uninstalled). */
  forgetRefused(themeId: string): boolean {
    return this.state.refused.delete(refusalKey('bundle', themeId));
  }

  /**
   * Unregister a theme from the registry (for hot-unloading after uninstall)
   */
  unregisterTheme(themeId: string): boolean {
    const theme = this.state.themes.get(themeId);
    if (!theme) return false;
    if (theme.isDefault) {
      logger.warn('Cannot unregister default theme');
      return false;
    }
    this.state.themes.delete(themeId);
    logger.info('Theme unregistered', { themeId });
    return true;
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

  /** Themes found but not registered: made for an earlier Quilltap. */
  getRefused(): RefusedTheme[] {
    return Array.from(this.state.refused.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A refused theme, by id: an installed bundle before a plugin's. */
  getRefusedTheme(themeId: string): RefusedTheme | null {
    return this.state.refused.get(refusalKey('bundle', themeId)) ?? this.state.refused.get(refusalKey('plugin', themeId)) ?? null;
  }

  /**
   * The CSS the injector writes for a theme. The default theme (and an
   * unknown id) writes nothing: the app's own stylesheet is the default.
   */
  getCSS(themeId: string | null): string {
    const theme = themeId ? this.state.themes.get(themeId) : undefined;
    return theme?.compiled ? compiledThemeCss(theme.compiled) : '';
  }

  /**
   * The bundle files the asset route may serve for a theme: those its
   * manifest names or its compiled CSS points at.
   */
  getServedAssets(themeId: string): ReadonlySet<string> {
    const theme = this.state.themes.get(themeId);
    return new Set(theme?.compiled?.assets ?? []);
  }

  /**
   * Get fonts for a theme
   */
  getFonts(themeId: string): LoadedThemeFont[] {
    const theme = this.state.themes.get(themeId);
    return theme?.fonts || [];
  }

  /**
   * Get per-icon overrides for a theme
   */
  getIcons(themeId: string): LoadedThemeIcon[] {
    const theme = this.state.themes.get(themeId);
    return theme?.icons || [];
  }

  /**
   * Manifest-referenced preview images for a theme (previewImage + subsystem
   * background/thumbnail refs). Resolved to asset URLs, de-duped, sorted by name.
   * Does NOT enumerate the bundle directory — manifest references only.
   */
  getImages(themeId: string): ThemePreviewImage[] {
    const theme = this.state.themes.get(themeId);
    if (!theme) return [];

    const humanize = (key: string): string =>
      key
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    const entries: ThemePreviewImage[] = [];

    if (theme.previewImage) {
      const src = resolveThemeAssetUrl(theme.previewImage, theme.pluginName);
      if (src && src !== 'none') {
        entries.push({ kind: 'preview', name: 'Preview', src });
      } else {
        logger.debug('theme-registry.getImages skipped preview (unresolved)', {
          themeId,
          value: theme.previewImage,
        });
      }
    }

    for (const [key, sub] of Object.entries(theme.subsystems ?? {})) {
      const base = sub.name && sub.name.trim() ? sub.name.trim() : humanize(key);
      const hasBackground = !!(sub.backgroundImage && sub.backgroundImage !== 'none');
      const hasThumbnail = !!(sub.thumbnail && sub.thumbnail !== 'none');
      const both = hasBackground && hasThumbnail;

      if (hasBackground) {
        const src = resolveThemeAssetUrl(sub.backgroundImage, theme.pluginName);
        if (src && src !== 'none') {
          entries.push({
            kind: 'background',
            subsystem: key,
            name: both ? `${base} Background` : base,
            src,
          });
        } else {
          logger.debug('theme-registry.getImages skipped background (unresolved)', {
            themeId,
            subsystem: key,
            value: sub.backgroundImage,
          });
        }
      }

      if (hasThumbnail) {
        const src = resolveThemeAssetUrl(sub.thumbnail, theme.pluginName);
        if (src && src !== 'none') {
          entries.push({
            kind: 'thumbnail',
            subsystem: key,
            name: both ? `${base} Thumbnail` : base,
            src,
          });
        } else {
          logger.debug('theme-registry.getImages skipped thumbnail (unresolved)', {
            themeId,
            subsystem: key,
            value: sub.thumbnail,
          });
        }
      }
    }

    const seen = new Set<string>();
    const deduped = entries.filter((e) => {
      if (seen.has(e.src)) return false;
      seen.add(e.src);
      return true;
    });

    deduped.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    return deduped;
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
      refused: this.state.refused.size,
      errors: this.state.errors.size,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
    };
  }

  /**
   * Get all loading errors
   */
  getErrors(): ThemeLoadError[] {
    return Array.from(this.state.errors.values());
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
        tags: theme.tags,
        pluginName: theme.pluginName,
        isDefault: theme.isDefault,
        source: theme.source,
      })),
      refused: this.getRefused(),
      errors: this.getErrors(),
      stats: this.getStats(),
    };
  }

  /** The default theme's preview: the registry defaults, resolved. */
  private getDefaultPreview(): ThemePreview {
    if (!this.defaultPreview) this.defaultPreview = defaultThemePreview(THEME_REGISTRY_VIEW);
    return this.defaultPreview;
  }

  /**
   * Theme metadata for the theme picker: preview swatches and the heading
   * font, without any CSS.
   */
  getThemeList(): ThemeListEntry[] {
    return this.getAll().map(theme => {
      const preview = theme.compiled ?? this.getDefaultPreview();
      let headingFont: ThemeListEntry['headingFont'];
      if (preview.headingFont) {
        const primaryFont = preview.headingFont.split(',')[0].trim().replace(/['"]/g, '');
        const matchingFont = theme.fonts?.find(f => f.family === primaryFont);
        headingFont = matchingFont
          ? { family: primaryFont, url: `/api/themes/fonts/${theme.pluginName}/${matchingFont.src}` }
          : { family: preview.headingFont };
      }
      return {
        id: theme.id,
        name: theme.name,
        description: theme.description,
        supportsDarkMode: theme.supportsDarkMode,
        previewImage: theme.previewImage,
        tags: theme.tags,
        isDefault: theme.isDefault,
        source: theme.source,
        previewColors: preview.previewColors,
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
