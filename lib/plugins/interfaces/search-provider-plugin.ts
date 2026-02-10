/**
 * Search Provider Plugin Interface
 *
 * Defines the contract that web search provider plugins must implement.
 * This interface ensures consistency across all search provider implementations
 * and provides metadata needed for UI rendering and configuration.
 *
 * Search providers power the built-in `search_web` tool by providing
 * pluggable backends (e.g., Serper, Bing, DuckDuckGo).
 *
 * @module plugins/interfaces/search-provider-plugin
 */

import { logger } from '@/lib/logger';

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
    /** Background color class (e.g., 'bg-orange-100') */
    bg: string;
    /** Text color class (e.g., 'text-orange-800') */
    text: string;
    /** Icon color class (e.g., 'text-orange-600') */
    icon: string;
  };
}

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

/**
 * SVG icon data (mirrors PluginIconData from provider-plugin.ts)
 */
export interface SearchProviderIconData {
  /** Raw SVG string (complete <svg> element) */
  svg?: string;
  /** SVG viewBox attribute (e.g., '0 0 24 24') */
  viewBox?: string;
  /** SVG path elements */
  paths?: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
    fillRule?: 'nonzero' | 'evenodd';
  }>;
  /** SVG circle elements */
  circles?: Array<{
    cx: string | number;
    cy: string | number;
    r: string | number;
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    opacity?: string;
  }>;
  /** SVG text element for abbreviation or label */
  text?: {
    content: string;
    x?: string;
    y?: string;
    fontSize?: string;
    fontWeight?: string;
    fill?: string;
  };
}

/**
 * Main Search Provider Plugin Interface
 *
 * Plugins implementing this interface provide web search backends
 * for Quilltap's `search_web` tool.
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
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL for the search API
   * @returns Promise resolving to true if valid, false otherwise
   */
  validateApiKey?: (apiKey: string, baseUrl?: string) => Promise<boolean>;

  /**
   * Search provider icon as SVG data (optional)
   */
  icon?: SearchProviderIconData;
}

/**
 * Standard export type for search provider plugins
 */
export interface SearchProviderPluginExport {
  /** The search provider plugin instance */
  plugin: SearchProviderPlugin;
}

/**
 * Create a debug logger for search provider plugin operations
 *
 * @param providerName The name of the search provider for context
 * @returns A logger instance with search provider context
 *
 * @internal
 */
export function createSearchProviderLogger(providerName: string) {
  return logger.child({
    module: 'plugin-search-provider',
    provider: providerName,
  });
}
