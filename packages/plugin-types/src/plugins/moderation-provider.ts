/**
 * Moderation Provider Plugin types for Quilltap plugin development
 *
 * @deprecated Use ScoringProviderPlugin from './scoring-provider' instead.
 * This module is kept for backward compatibility. The moderation-specific
 * types map directly to the generalized scoring types:
 *
 * - ModerationProviderPlugin -> ScoringProviderPlugin
 * - ModerationResult -> ScoringResult
 * - ModerationCategoryResult -> CategoryScore
 *
 * @module @quilltap/plugin-types/plugins/moderation-provider
 */

// ============================================================================
// METADATA (kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use ScoringProviderMetadata instead
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
// CONFIGURATION (kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use ScoringProviderConfigRequirements instead
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
// MODERATION RESULTS (kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use CategoryScore from providers/scoring instead
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
 * @deprecated Use ScoringResult from providers/scoring instead
 */
export interface ModerationResult {
  /** Whether the content was flagged by the moderation provider */
  flagged: boolean;

  /** Per-category breakdown with provider-specific category names */
  categories: ModerationCategoryResult[];
}

// ============================================================================
// MODERATION PROVIDER PLUGIN (kept for backward compatibility)
// ============================================================================

/**
 * @deprecated Use ScoringProviderPlugin instead.
 *
 * Legacy moderation provider plugin interface. New plugins should implement
 * ScoringProviderPlugin with a ScoringProvider that handles task: 'moderation'.
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
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL for the moderation API
   * @returns Promise resolving to true if valid, false otherwise
   */
  validateApiKey?: (apiKey: string, baseUrl?: string) => Promise<boolean>;
}

/**
 * @deprecated Use ScoringProviderPluginExport instead
 */
export interface ModerationProviderPluginExport {
  /** The moderation provider plugin instance */
  moderationPlugin: ModerationProviderPlugin;
}
