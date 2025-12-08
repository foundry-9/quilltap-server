/**
 * Quilltap Theme System
 *
 * Main exports for the theming system.
 * Provides types, schemas, utilities, and registry for theme customization.
 *
 * @module themes
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
  // Color system
  ColorPalette,

  // Token categories
  Typography,
  Spacing,
  Effects,

  // Complete tokens
  ThemeTokens,

  // Font definitions
  FontDefinition,

  // Theme manifest
  ThemeManifest,

  // User preference
  ColorMode,
  ThemePreference,
} from './types';

// ============================================================================
// SCHEMA EXPORTS
// ============================================================================

export {
  // Color schemas
  ColorPaletteSchema,

  // Token category schemas
  TypographySchema,
  SpacingSchema,
  EffectsSchema,

  // Complete tokens schema
  ThemeTokensSchema,

  // Font definition schema
  FontDefinitionSchema,

  // Theme manifest schema
  ThemeManifestSchema,

  // User preference schemas
  ColorModeSchema,
  ThemePreferenceSchema,

  // Validation helpers
  validateThemeTokens,
  safeValidateThemeTokens,
  validateThemeManifest,
  safeValidateThemeManifest,
  validateThemePreference,
  createDefaultThemePreference,
} from './types';

// ============================================================================
// DEFAULT THEME EXPORTS
// ============================================================================

export {
  // Complete default theme
  DEFAULT_THEME_TOKENS,

  // Individual default categories
  DEFAULT_TYPOGRAPHY,
  DEFAULT_SPACING,
  DEFAULT_EFFECTS,

  // Default theme metadata
  DEFAULT_THEME_METADATA,

  // Utility functions
  getDefaultThemeTokens,
  getDefaultColors,
  getDefaultTypography,
  getDefaultSpacing,
  getDefaultEffects,
} from './default-tokens';

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export {
  // CSS generation
  themeTokensToCSS,
  themeColorsToCSS,
  themeTokensToStyleObject,

  // Theme merging
  mergeThemeTokens,
  mergeWithDefaultTheme,

  // Theme comparison
  colorPalettesEqual,
  themeTokensEqual,
  getThemeDifferences,

  // CSS variable mappings
  COLOR_VAR_MAP,
  TYPOGRAPHY_VAR_MAP,
  SPACING_VAR_MAP,
  EFFECTS_VAR_MAP,
} from './utils';

// ============================================================================
// THEME REGISTRY EXPORTS
// ============================================================================

export type {
  // Registry types
  LoadedTheme,
  ThemeLoadError,
  ThemeRegistryState,
} from './theme-registry';

export {
  // Registry singleton
  themeRegistry,

  // Convenience functions
  getAllThemes,
  getTheme,
  getDefaultTheme,
  getThemeTokens,
  getThemeCSS,
  hasTheme,
  getThemeStats,

  // Initialization
  initializeThemeRegistry,
} from './theme-registry';
