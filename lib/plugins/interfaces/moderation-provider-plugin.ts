/**
 * Moderation Provider Plugin Interface
 *
 * Defines the contract that content moderation provider plugins must implement.
 * This interface ensures consistency across all moderation provider implementations
 * and provides metadata needed for UI rendering and configuration.
 *
 * Moderation providers power the Concierge content classification system
 * by providing pluggable backends (e.g., OpenAI moderation endpoint).
 *
 * @module plugins/interfaces/moderation-provider-plugin
 */

import { logger } from '@/lib/logger';

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

/**
 * A single moderation category result
 */
export interface ModerationCategoryResult {
  /** Category name as returned by the provider */
  category: string;

  /** Whether this specific category was flagged */
  flagged: boolean;

  /** Confidence score for this category (0-1) */
  score: number;
}

/**
 * Result from a moderation provider's content classification
 */
export interface ModerationResult {
  /** Whether the content was flagged by the moderation provider */
  flagged: boolean;

  /** Per-category breakdown with provider-specific category names */
  categories: ModerationCategoryResult[];
}

/**
 * Main Moderation Provider Plugin Interface
 *
 * Plugins implementing this interface provide content moderation backends
 * for Quilltap's Concierge system.
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
 * Standard export type for moderation provider plugins
 */
export interface ModerationProviderPluginExport {
  /** The moderation provider plugin instance */
  moderationPlugin: ModerationProviderPlugin;
}

/**
 * Create a debug logger for moderation provider plugin operations
 *
 * @param providerName The name of the moderation provider for context
 * @returns A logger instance with moderation provider context
 *
 * @internal
 */
export function createModerationProviderLogger(providerName: string) {
  return logger.child({
    module: 'plugin-moderation-provider',
    provider: providerName,
  });
}
