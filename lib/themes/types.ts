/**
 * Theme types: the bundle manifest, the installed-bundle index, theme
 * registries and the operator's theme preference.
 *
 * A theme is a version 2 `.qtap-theme` bundle; its document schemas live in
 * the engine (lib/themes/engine/document.ts). Bundles made for an earlier
 * Quilltap are recognised only to be refused (lib/themes/refused.ts).
 *
 * @module themes/types
 */

import { z } from 'zod';
import { ThemeManifestSchema, type ThemeManifest } from './engine/document';
import { logger } from '@/lib/logger';

export { isBundleRelativePath } from './bundle-paths';

/**
 * Compatibility specification for theme bundles
 */
export const ThemeCompatibilitySchema = z.object({
  quilltapVersion: z.string().optional().describe('Semver range for Quilltap compatibility (e.g., ">=3.3.0")'),
});

export type ThemeCompatibility = z.infer<typeof ThemeCompatibilitySchema>;

/** theme.json of a `.qtap-theme` bundle (`formatVersion: 2`). */
export const QtapThemeManifestSchema = ThemeManifestSchema;

export type QtapThemeManifest = ThemeManifest;

/**
 * Theme bundle index entry
 */
export const ThemeBundleIndexEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  installedAt: z.string(),
  source: z.enum(['file', 'url', 'registry']),
  sourceUrl: z.string().nullable(),
  registrySource: z.string().nullable(),
  signatureVerified: z.boolean(),
});

export type ThemeBundleIndexEntry = z.infer<typeof ThemeBundleIndexEntrySchema>;

/**
 * Theme bundle index file schema (themes-index.json)
 */
export const ThemeBundleIndexSchema = z.object({
  version: z.literal(1),
  themes: z.array(ThemeBundleIndexEntrySchema),
});

export type ThemeBundleIndex = z.infer<typeof ThemeBundleIndexSchema>;

// ============================================================================
// REGISTRY TYPES
// ============================================================================

/**
 * Registry source configuration (stored in sources.json)
 */
export const RegistrySourceSchema = z.object({
  name: z.string().min(1).max(100).describe('Display name for the registry'),
  url: z.string().url().describe('URL of the registry index JSON'),
  enabled: z.boolean().default(true).describe('Whether this source is active'),
  publicKey: z.string().optional().describe('Ed25519 public key for signature verification'),
  trusted: z.boolean().default(false).describe('Whether this source is trusted (official)'),
  addedAt: z.string().describe('ISO timestamp when source was added'),
  lastFetched: z.string().nullable().default(null).describe('ISO timestamp of last fetch'),
});

export type RegistrySource = z.infer<typeof RegistrySourceSchema>;

/**
 * Registry sources file schema (sources.json)
 */
export const RegistrySourcesSchema = z.object({
  version: z.literal(1),
  sources: z.array(RegistrySourceSchema),
});

export type RegistrySources = z.infer<typeof RegistrySourcesSchema>;

/**
 * Preview colors for registry theme entries
 */
export const RegistryPreviewColorsSchema = z.object({
  light: z.object({
    background: z.string(),
    primary: z.string(),
  }),
  dark: z.object({
    background: z.string(),
    primary: z.string(),
  }).optional(),
});

export type RegistryPreviewColors = z.infer<typeof RegistryPreviewColorsSchema>;

/** A manifest-referenced preview image for a theme (gallery source). */
export interface ThemePreviewImage {
  /** Display name, derived from the source key/filename. */
  name: string;
  /** Browser-usable URL (already resolved to an asset route). */
  src: string;
  /** Where the reference came from. */
  kind: 'preview' | 'background' | 'thumbnail';
  /** Subsystem key when kind is background/thumbnail (e.g. "aurora"); undefined for preview. */
  subsystem?: string;
}

/**
 * A theme entry in a registry index
 */
export const RegistryThemeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(100),
  version: z.string(),
  author: z.union([z.string(), z.object({ name: z.string() })]),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
  supportsDarkMode: z.boolean().default(true),
  compatibility: ThemeCompatibilitySchema.optional(),
  /** The bundle's theme.json formatVersion, when the registry states it. Only version 2 is offered. */
  formatVersion: z.number().int().optional(),
  downloadUrl: z.string().url(),
  sha256: z.string().describe('SHA-256 hash of the download file'),
  size: z.number().optional().describe('File size in bytes'),
  previewUrl: z.string().url().optional(),
  previewColors: RegistryPreviewColorsSchema.optional(),
  signature: z.string().optional().describe('Ed25519 signature of the bundle'),
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
});

export type RegistryTheme = z.infer<typeof RegistryThemeSchema>;

/**
 * Registry index format (fetched from registry URL)
 */
export const RegistryIndexSchema = z.object({
  registry: z.object({
    name: z.string(),
    url: z.string().url(),
    version: z.literal(1),
  }),
  themes: z.array(RegistryThemeSchema),
  signature: z.string().optional().describe('Ed25519 signature of the themes array'),
});

export type RegistryIndex = z.infer<typeof RegistryIndexSchema>;

/**
 * Theme update information
 */
export interface ThemeUpdate {
  themeId: string;
  currentVersion: string;
  availableVersion: string;
  registryName: string;
  registryUrl: string;
  downloadUrl: string;
  sha256: string;
}

// ============================================================================
// USER THEME PREFERENCE
// ============================================================================

/**
 * Color mode options
 */
export const ColorModeSchema = z.enum(['light', 'dark', 'system']);
export type ColorMode = z.infer<typeof ColorModeSchema>;

/**
 * User theme preference schema
 *
 * Stored in chat_settings to persist user's theme choices.
 */
export const ThemePreferenceSchema = z.object({
  /** Active theme plugin ID (null = default theme) */
  activeThemeId: z.string().nullable().default(null),

  /** Color mode preference */
  colorMode: ColorModeSchema.default('system'),

  /** Custom token overrides (user tweaks on top of selected theme) */
  customOverrides: z.record(z.string(), z.string()).optional(),

  // `showNavThemeSelector` was retired in 4.14 (the theme picker is always in
  // the rail's Studio menu). A stored or backed-up preference carrying it
  // still parses: the key is stripped.
});

export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates a .qtap-theme bundle manifest
 * @param data - The manifest data to validate
 * @returns Validated manifest
 * @throws ZodError if validation fails
 */
export function validateQtapThemeManifest(data: unknown): QtapThemeManifest {
  return QtapThemeManifestSchema.parse(data);
}

/**
 * Safely validates a .qtap-theme bundle manifest
 * @param data - The manifest data to validate
 * @returns Success or error result
 */
export function safeValidateQtapThemeManifest(data: unknown):
  | { success: true; data: QtapThemeManifest }
  | { success: false; errors: z.ZodError } {
  const result = QtapThemeManifestSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  logger.warn('Qtap theme manifest validation failed', {
    errorCount: result.error.issues.length,
    errors: result.error.issues.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    })),
  });
  return { success: false, errors: result.error };
}

/**
 * Validates theme preference
 * @param data - The preference data to validate
 * @returns Validated and typed preference
 * @throws ZodError if validation fails
 */
export function validateThemePreference(data: unknown): ThemePreference {
  return ThemePreferenceSchema.parse(data);
}

/**
 * Creates a default theme preference
 */
export function createDefaultThemePreference(): ThemePreference {
  return {
    activeThemeId: null,
    colorMode: 'system',
  };
}
