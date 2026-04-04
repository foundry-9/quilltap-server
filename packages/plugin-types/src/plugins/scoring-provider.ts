/**
 * Scoring Provider Plugin types for Quilltap plugin development
 *
 * Defines the interfaces and types needed to create pluggable content
 * scoring backends as Quilltap plugins. Scoring providers handle
 * moderation, reranking, and classification tasks.
 *
 * @module @quilltap/plugin-types/plugins/scoring-provider
 */

import type { ScoringProvider } from '../providers/scoring';

// ============================================================================
// METADATA
// ============================================================================

/**
 * Scoring provider metadata for UI display and identification
 */
export interface ScoringProviderMetadata {
  /** Internal identifier for the scoring provider (e.g., 'OPENAI') */
  providerName: string;

  /** Human-readable display name for UI (e.g., 'OpenAI Moderation') */
  displayName: string;

  /** Short description of the scoring provider */
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
 * Configuration requirements for a scoring provider
 */
export interface ScoringProviderConfigRequirements {
  /** Whether this scoring provider requires an API key */
  requiresApiKey: boolean;

  /** Label text for API key input field */
  apiKeyLabel?: string;

  /** Whether this scoring provider requires a custom base URL */
  requiresBaseUrl: boolean;

  /** Default value for base URL (if applicable) */
  baseUrlDefault?: string;
}

// ============================================================================
// SCORING PROVIDER PLUGIN
// ============================================================================

/**
 * Main Scoring Provider Plugin Interface
 *
 * Plugins implementing this interface provide scoring backends
 * for Quilltap. The most common use case is content moderation
 * via the Concierge system, but the interface supports reranking
 * and classification tasks as well.
 *
 * @example
 * ```typescript
 * import type { ScoringProviderPlugin } from '@quilltap/plugin-types';
 *
 * export const scoringPlugin: ScoringProviderPlugin = {
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
 *   createProvider: () => new OpenAIModerationScoringProvider(),
 * };
 * ```
 */
export interface ScoringProviderPlugin {
  /** Scoring provider metadata for UI display and identification */
  metadata: ScoringProviderMetadata;

  /** Configuration requirements for this scoring provider */
  config: ScoringProviderConfigRequirements;

  /**
   * Factory method to create a ScoringProvider instance
   */
  createProvider: () => ScoringProvider;

  /**
   * Validate an API key for this scoring provider (optional)
   *
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL
   * @returns Promise resolving to true if valid, false otherwise
   */
  validateApiKey?: (apiKey: string, baseUrl?: string) => Promise<boolean>;
}

/**
 * Standard export type for scoring provider plugins
 */
export interface ScoringProviderPluginExport {
  /** The scoring provider plugin instance */
  scoringPlugin: ScoringProviderPlugin;
}
