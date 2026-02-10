/**
 * Search Provider Plugin types for Quilltap plugin development
 *
 * Defines the interfaces and types needed to create pluggable web search
 * backends as Quilltap plugins (e.g., Serper, Bing, DuckDuckGo).
 *
 * @module @quilltap/plugin-types/plugins/search-provider
 */

import type { PluginIconData } from './provider';

// ============================================================================
// METADATA
// ============================================================================

/**
 * Search provider metadata for UI display and identification
 */
export interface SearchProviderMetadata {
  /** Internal identifier for the search provider (e.g., 'SERPER', 'BING') */
  providerName: string;

  /** Human-readable display name for UI (e.g., 'Serper Web Search') */
  displayName: string;

  /** Short description of the search provider */
  description: string;

  /** Short abbreviation for icon display (e.g., 'SRP', 'BNG') */
  abbreviation: string;

  /** Tailwind CSS color classes for UI styling */
  colors: {
    /** Background color class (e.g., 'bg-blue-100') */
    bg: string;
    /** Text color class (e.g., 'text-blue-800') */
    text: string;
    /** Icon color class (e.g., 'text-blue-600') */
    icon: string;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration requirements for a search provider
 */
export interface SearchProviderConfigRequirements {
  /** Whether this search provider requires an API key */
  requiresApiKey: boolean;

  /** Label text for API key input field */
  apiKeyLabel?: string;

  /** Whether this search provider requires a custom base URL */
  requiresBaseUrl: boolean;

  /** Default value for base URL (if applicable) */
  baseUrlDefault?: string;
}

// ============================================================================
// SEARCH RESULTS
// ============================================================================

/**
 * A single web search result
 */
export interface SearchResult {
  /** Title of the search result */
  title: string;

  /** URL of the search result */
  url: string;

  /** Text snippet / summary of the result */
  snippet: string;

  /** Date the result was published (ISO string or human-readable) */
  publishedDate?: string;
}

/**
 * Output from a search provider execution
 */
export interface SearchOutput {
  /** Whether the search was successful */
  success: boolean;

  /** Array of search results (present when success is true) */
  results?: SearchResult[];

  /** Error message (present when success is false) */
  error?: string;

  /** Total number of results found */
  totalFound: number;

  /** The query that was searched */
  query: string;
}

// ============================================================================
// SEARCH PROVIDER PLUGIN
// ============================================================================

/**
 * Main Search Provider Plugin Interface
 *
 * Plugins implementing this interface provide web search backends
 * for Quilltap's `search_web` tool. The search tool remains a built-in
 * tool, but its execution backend is pluggable via this interface.
 *
 * @example
 * ```typescript
 * import type { SearchProviderPlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: SearchProviderPlugin = {
 *   metadata: {
 *     providerName: 'SERPER',
 *     displayName: 'Serper Web Search',
 *     description: 'Google search via Serper.dev API',
 *     abbreviation: 'SRP',
 *     colors: { bg: 'bg-orange-100', text: 'text-orange-800', icon: 'text-orange-600' },
 *   },
 *   config: {
 *     requiresApiKey: true,
 *     apiKeyLabel: 'Serper API Key',
 *     requiresBaseUrl: false,
 *   },
 *   executeSearch: async (query, maxResults, apiKey) => {
 *     // ... call search API ...
 *     return { success: true, results: [...], totalFound: 5, query };
 *   },
 *   formatResults: (results) => {
 *     return results.map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`).join('\n');
 *   },
 *   validateApiKey: async (apiKey) => {
 *     // ... test API key ...
 *     return true;
 *   },
 * };
 * ```
 */
export interface SearchProviderPlugin {
  /** Search provider metadata for UI display and identification */
  metadata: SearchProviderMetadata;

  /** Configuration requirements for this search provider */
  config: SearchProviderConfigRequirements;

  /**
   * Execute a web search query
   *
   * @param query The search query string
   * @param maxResults Maximum number of results to return
   * @param apiKey The API key for authentication
   * @param baseUrl Optional base URL for the search API
   * @returns Promise resolving to search output with results or error
   */
  executeSearch: (
    query: string,
    maxResults: number,
    apiKey: string,
    baseUrl?: string
  ) => Promise<SearchOutput>;

  /**
   * Format search results for inclusion in LLM conversation context
   *
   * @param results Array of search results to format
   * @returns Formatted string suitable for LLM context
   */
  formatResults: (results: SearchResult[]) => string;

  /**
   * Validate an API key for this search provider (optional)
   *
   * Should test the API key by making a minimal API call to verify
   * that it is valid and has proper permissions.
   *
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL for the search API
   * @returns Promise resolving to true if valid, false otherwise
   */
  validateApiKey?: (apiKey: string, baseUrl?: string) => Promise<boolean>;

  /**
   * Search provider icon as SVG data (optional)
   *
   * Provides the icon as raw SVG data that Quilltap will render.
   * If not provided, generates a default icon from the abbreviation.
   */
  icon?: PluginIconData;
}

/**
 * Standard export type for search provider plugins
 */
export interface SearchProviderPluginExport {
  /** The search provider plugin instance */
  plugin: SearchProviderPlugin;
}
