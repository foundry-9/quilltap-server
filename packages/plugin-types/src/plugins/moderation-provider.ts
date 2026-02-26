/**
 * Moderation Provider Plugin types for Quilltap plugin development
 *
 * Defines the interfaces and types needed to create pluggable content
 * moderation backends as Quilltap plugins (e.g., OpenAI moderation endpoint).
 *
 * @module @quilltap/plugin-types/plugins/moderation-provider
 */

// ============================================================================
// METADATA
// ============================================================================

/**
 * Moderation provider metadata for UI display and identification
 */
export interface ModerationProviderMetadata {
  /** Internal identifier for the moderation provider (e.g., 'OPENAI') */
  providerName: string;

  /** Human-readable display name for UI (e.g., 'OpenAI Moderation') */
  displayName: string;

  /** Short description of the moderation provider */
  description: string;

  /** Short abbreviation for icon display (e.g., 'OAI') */
  abbreviation: string;

  /** Tailwind CSS color classes for UI styling */
  colors: {
    /** Background color class (e.g., 'bg-green-100') */
    bg: string;
    /** Text color class (e.g., 'text-green-800') */
    text: string;
    /** Icon color class (e.g., 'text-green-600') */
    icon: string;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration requirements for a moderation provider
 */
export interface ModerationProviderConfigRequirements {
  /** Whether this moderation provider requires an API key */
  requiresApiKey: boolean;

  /** Label text for API key input field */
  apiKeyLabel?: string;

  /** Whether this moderation provider requires a custom base URL */
  requiresBaseUrl: boolean;

  /** Default value for base URL (if applicable) */
  baseUrlDefault?: string;
}

// ============================================================================
// MODERATION RESULTS
// ============================================================================

/**
 * A single moderation category result
 *
 * Categories are provider-specific (e.g., OpenAI returns 'hate', 'sexual',
 * 'violence', etc.; other providers may return different categories).
 */
export interface ModerationCategoryResult {
  /** Category name as returned by the provider (e.g., 'sexual', 'violence', 'hate') */
  category: string;

  /** Whether this specific category was flagged */
  flagged: boolean;

  /** Confidence score for this category (0-1) */
  score: number;
}

/**
 * Result from a moderation provider's content classification
 *
 * This is the generic result type returned by all moderation providers.
 * The categories array contains provider-specific category names and scores.
 * The consuming system (Dangermouse) maps these to its own category structure.
 */
export interface ModerationResult {
  /** Whether the content was flagged by the moderation provider */
  flagged: boolean;

  /** Per-category breakdown with provider-specific category names */
  categories: ModerationCategoryResult[];
}

// ============================================================================
// MODERATION PROVIDER PLUGIN
// ============================================================================

/**
 * Main Moderation Provider Plugin Interface
 *
 * Plugins implementing this interface provide content moderation backends
 * for Quilltap's Dangermouse system. The moderation provider is used
 * as an alternative to the Cheap LLM classification approach.
 *
 * @example
 * ```typescript
 * import type { ModerationProviderPlugin } from '@quilltap/plugin-types';
 *
 * export const moderationPlugin: ModerationProviderPlugin = {
 *   metadata: {
 *     providerName: 'OPENAI',
 *     displayName: 'OpenAI Moderation',
 *     description: 'Free content moderation via OpenAI moderation endpoint',
 *     abbreviation: 'OAI',
 *     colors: { bg: 'bg-green-100', text: 'text-green-800', icon: 'text-green-600' },
 *   },
 *   config: {
 *     requiresApiKey: true,
 *     apiKeyLabel: 'OpenAI API Key',
 *     requiresBaseUrl: false,
 *   },
 *   moderate: async (content, apiKey) => {
 *     // ... call moderation API ...
 *     return { flagged: false, categories: [] };
 *   },
 * };
 * ```
 */
export interface ModerationProviderPlugin {
  /** Moderation provider metadata for UI display and identification */
  metadata: ModerationProviderMetadata;

  /** Configuration requirements for this moderation provider */
  config: ModerationProviderConfigRequirements;

  /**
   * Classify content for moderation
   *
   * @param content The text content to classify
   * @param apiKey The API key for authentication
   * @param baseUrl Optional base URL for the moderation API
   * @returns Promise resolving to moderation result with flagged status and categories
   */
  moderate: (
    content: string,
    apiKey: string,
    baseUrl?: string
  ) => Promise<ModerationResult>;

  /**
   * Validate an API key for this moderation provider (optional)
   *
   * Should test the API key by making a minimal API call to verify
   * that it is valid and has proper permissions.
   *
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL for the moderation API
   * @returns Promise resolving to true if valid, false otherwise
   */
  validateApiKey?: (apiKey: string, baseUrl?: string) => Promise<boolean>;
}

/**
 * Standard export type for moderation provider plugins
 */
export interface ModerationProviderPluginExport {
  /** The moderation provider plugin instance */
  moderationPlugin: ModerationProviderPlugin;
}
