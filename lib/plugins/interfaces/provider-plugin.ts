/**
 * Provider Plugin Interface
 *
 * Defines the contract that LLM provider plugins must implement.
 * This interface ensures consistency across all provider implementations
 * and provides metadata needed for UI rendering, configuration, and capability discovery.
 *
 * @module plugins/interfaces/provider-plugin
 */

import { logger } from '@/lib/logger';
import type { LLMProvider } from '@/lib/llm/base';
import type { ImageGenProvider } from '@/lib/image-gen/base';
import type { EmbeddingProvider, LocalEmbeddingProvider } from '@quilltap/plugin-types';

/**
 * Provider metadata for UI display and identification
 *
 * @interface ProviderMetadata
 */
export interface ProviderMetadata {
  /** Internal identifier for the provider (e.g., 'OPENAI', 'ANTHROPIC') */
  providerName: string;

  /** Human-readable display name for UI (e.g., 'OpenAI', 'Anthropic') */
  displayName: string;

  /** Short description of the provider */
  description: string;

  /** Tailwind CSS color classes for UI styling */
  colors: {
    /** Background color class (e.g., 'bg-green-100') */
    bg: string;

    /** Text color class (e.g., 'text-green-800') */
    text: string;

    /** Icon color class (e.g., 'text-green-600') */
    icon: string;
  };

  /** Short abbreviation for icon display (e.g., 'OAI', 'ANT') */
  abbreviation: string;

  /**
   * Legacy provider names that should be treated as aliases for this provider.
   * Used for backward compatibility when provider names change.
   * Example: ['GOOGLE_IMAGEN'] for the GOOGLE provider.
   */
  legacyNames?: string[];
}

/**
 * Attachment/file support configuration for a provider
 *
 * Describes what types of file attachments the provider can handle.
 *
 * @interface AttachmentSupport
 */
export interface AttachmentSupport {
  /** Whether this provider supports file attachments */
  supportsAttachments: boolean;

  /** Array of MIME types supported for attachments (empty if no support) */
  supportedMimeTypes: string[];

  /** Human-readable description of attachment support */
  description: string;

  /** Additional notes about attachment support or limitations */
  notes?: string;

  /** Maximum file size in bytes (raw, before encoding) */
  maxFileSize?: number;

  /** Maximum base64-encoded size in bytes (for API limits like Anthropic's 5MB) */
  maxBase64Size?: number;

  /** Maximum number of files per request */
  maxFiles?: number;
}

/**
 * Configuration requirements for the provider
 *
 * Describes what configuration is needed to use this provider
 * (e.g., API key, base URL)
 *
 * @interface ProviderConfigRequirements
 */
export interface ProviderConfigRequirements {
  /** Whether this provider requires an API key */
  requiresApiKey: boolean;

  /** Whether this provider requires a custom base URL */
  requiresBaseUrl: boolean;

  /** Label text for API key input field */
  apiKeyLabel?: string;

  /** Label text for base URL input field */
  baseUrlLabel?: string;

  /** Default value for base URL (if applicable) */
  baseUrlDefault?: string;

  /** Placeholder text for base URL input */
  baseUrlPlaceholder?: string;
}

/**
 * Information about a specific model supported by the provider
 *
 * @interface ModelInfo
 */
export interface ModelInfo {
  /** Unique identifier for the model */
  id: string;

  /** Human-readable name of the model */
  name: string;

  /** Context window size (tokens) */
  contextWindow?: number;

  /** Maximum output tokens for this model */
  maxOutputTokens?: number;

  /** Whether this model supports image attachments */
  supportsImages?: boolean;

  /** Whether this model supports tool/function calling */
  supportsTools?: boolean;

  /** Description of the model */
  description?: string;

  /** Pricing information (per 1M tokens in USD) */
  pricing?: {
    /** Price per 1M input tokens */
    input: number;
    /** Price per 1M output tokens */
    output: number;
  };
}

/**
 * Information about an embedding model supported by the provider
 *
 * @interface EmbeddingModelInfo
 */
export interface EmbeddingModelInfo {
  /** Unique identifier for the embedding model */
  id: string;

  /** Human-readable name of the model */
  name: string;

  /** Dimensions of the embedding vector output */
  dimensions?: number;

  /** Description of the model's characteristics or use cases */
  description?: string;
}

/**
 * Information about an image generation model supported by the provider
 *
 * @interface ImageGenerationModelInfo
 */
export interface ImageGenerationModelInfo {
  /** Unique identifier for the image generation model */
  id: string;

  /** Human-readable name of the model */
  name: string;

  /** Supported aspect ratios (e.g., ['1:1', '16:9', '9:16']) */
  supportedAspectRatios?: string[];

  /** Supported image sizes (e.g., ['1024x1024', '512x512']) */
  supportedSizes?: string[];

  /** Description of the model's characteristics or use cases */
  description?: string;
}

/**
 * Provider capabilities configuration
 *
 * Describes what features/capabilities the provider supports
 *
 * @interface ProviderCapabilities
 */
export interface ProviderCapabilities {
  /** Whether the provider supports chat completions */
  chat: boolean;

  /** Whether the provider supports image generation */
  imageGeneration: boolean;

  /** Whether the provider supports text embeddings */
  embeddings: boolean;

  /** Whether the provider supports web search functionality */
  webSearch: boolean;
  /** Whether the provider supports tool use / function calling (defaults to false if omitted) */
  toolUse?: boolean;
}

/**
 * Information about a style or LoRA available for an image provider
 *
 * @interface ImageStyleInfo
 */
export interface ImageStyleInfo {
  /** Human-readable name for the style */
  name: string;

  /** Internal LoRA/style identifier used in API calls */
  loraId: string;

  /** Description for UI display and LLM context */
  description: string;

  /**
   * Trigger phrase to include in prompt when this style is active.
   * The LLM should incorporate this phrase into the image prompt
   * for optimal results with this style.
   */
  triggerPhrase?: string | null;
}

/**
 * Constraints for image generation providers
 *
 * Describes limitations and requirements for image generation,
 * allowing plugins to specify provider-specific constraints that
 * can be applied to tool definitions.
 *
 * @interface ImageProviderConstraints
 */
export interface ImageProviderConstraints {
  /** Maximum bytes allowed for image generation prompt (optional) */
  maxPromptBytes?: number;

  /** Human-readable warning message to include in tool description when this provider is used */
  promptConstraintWarning?: string;

  /** Maximum number of images that can be generated per request */
  maxImagesPerRequest?: number;

  /** Supported aspect ratios (e.g., ['1:1', '16:9', '9:16']) */
  supportedAspectRatios?: string[];

  /** Supported image sizes (e.g., ['1024x1024', '512x512']) */
  supportedSizes?: string[];

  /**
   * Prompting guidance text that should be provided to the chat LLM
   * when it's generating image prompts for this provider.
   * This can include structure recommendations, best practices,
   * and provider-specific tips for writing effective prompts.
   */
  promptingGuidance?: string;

  /**
   * Detailed information about available styles/LoRAs.
   * Keys are the style identifiers (matching supportedStyles if defined).
   * When a style is selected, the LLM can use the styleInfo to understand
   * how to craft prompts that work well with that style, including
   * incorporating any required trigger phrases.
   */
  styleInfo?: Record<string, ImageStyleInfo>;
}

/**
 * Message format support for multi-character chats
 * Defines how the provider handles the 'name' field in messages
 *
 * @interface MessageFormatSupport
 */
export interface MessageFormatSupport {
  /** Whether the provider supports a name field on messages */
  supportsNameField: boolean;
  /** Which roles support the name field */
  supportedRoles: ('user' | 'assistant')[];
  /** Maximum length for name field (if limited) */
  maxNameLength?: number;
}

/**
 * Cheap model configuration for background tasks
 * Used for memory extraction, summarization, titling, etc.
 *
 * @interface CheapModelConfig
 */
export interface CheapModelConfig {
  /** The default cheap model for this provider */
  defaultModel: string;
  /** List of recommended cheap models */
  recommendedModels: string[];
}

/**
 * Tool format type for this provider
 * Determines how tools are formatted for API calls
 */
export type ToolFormatType = 'openai' | 'anthropic' | 'google';

/**
 * Universal tool format for cross-provider compatibility
 * Standardizes on OpenAI's function calling format as the universal baseline
 *
 * @interface UniversalTool
 */
export interface UniversalTool {
  /** Indicates this is a function type tool (OpenAI format) */
  type: 'function';

  function: {
    /** Name of the tool/function */
    name: string;

    /** Description of what the tool does */
    description: string;

    /** Parameters schema in JSON Schema format */
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Options for tool formatting operations
 * Allows providers to customize formatting behavior
 *
 * @interface ToolFormatOptions
 */
export interface ToolFormatOptions {
  /** Image provider type for context-aware formatting */
  imageProviderType?: string;

  /** Allow additional custom options for provider-specific needs */
  [key: string]: unknown;
}

/**
 * Standardized tool call request format
 * Used consistently across all providers
 *
 * @interface ToolCallRequest
 */
export interface ToolCallRequest {
  /** Name of the tool being called */
  name: string;

  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
}

/**
 * Main LLM Provider Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded and used
 * by the Quilltap application to provide LLM functionality from various providers.
 *
 * @interface LLMProviderPlugin
 *
 * @example
 * ```typescript
 * const openaiPlugin: LLMProviderPlugin = {
 *   metadata: {
 *     providerName: 'OPENAI',
 *     displayName: 'OpenAI',
 *     description: 'OpenAI API provider for GPT models',
 *     colors: { bg: 'bg-green-100', text: 'text-green-800', icon: 'text-green-600' },
 *     abbreviation: 'OAI',
 *   },
 *   config: {
 *     requiresApiKey: true,
 *     requiresBaseUrl: false,
 *     apiKeyLabel: 'OpenAI API Key',
 *   },
 *   capabilities: {
 *     chat: true,
 *     imageGeneration: true,
 *     embeddings: true,
 *     webSearch: false,
 *   },
 *   attachmentSupport: {
 *     supportsAttachments: true,
 *     supportedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
 *     description: 'Images only (JPEG, PNG, GIF, WebP)',
 *   },
 *   createProvider: (baseUrl) => new OpenAIProvider(),
 *   getAvailableModels: async (apiKey) => [...],
 *   validateApiKey: async (apiKey) => {...},
 *   renderIcon: ({ className }) => <Icon className={className} />,
 * };
 * ```
 */
export interface LLMProviderPlugin {
  /**
   * Provider metadata for UI display and identification
   */
  metadata: ProviderMetadata;

  /**
   * Configuration requirements for this provider
   */
  config: ProviderConfigRequirements;

  /**
   * Supported capabilities for this provider
   */
  capabilities: ProviderCapabilities;

  /**
   * File attachment support information
   */
  attachmentSupport: AttachmentSupport;

  /**
   * Factory method to create an LLMProvider instance
   *
   * @param baseUrl Optional base URL for the provider (if applicable)
   * @returns An instantiated LLMProvider
   *
   * @example
   * ```typescript
   * const provider = plugin.createProvider('https://api.openai.com/v1');
   * ```
   */
  createProvider: (baseUrl?: string) => LLMProvider;

  /**
   * Factory method to create an ImageGenProvider instance (optional)
   *
   * Only required if `capabilities.imageGeneration` is true.
   *
   * @param baseUrl Optional base URL for the provider
   * @returns An instantiated ImageGenProvider
   */
  createImageProvider?: (baseUrl?: string) => ImageGenProvider;

  /**
   * Factory method to create an embedding provider instance (optional)
   *
   * Only required if `capabilities.embeddings` is true.
   *
   * @param baseUrl Optional base URL for the provider
   * @returns An instantiated embedding provider (EmbeddingProvider for API-based, LocalEmbeddingProvider for offline)
   */
  createEmbeddingProvider?: (baseUrl?: string) => EmbeddingProvider | LocalEmbeddingProvider;

  /**
   * Get list of available models for this provider
   *
   * May require an API key for the request. This method is called to populate
   * model selection dropdowns in the UI.
   *
   * @param apiKey The API key to use for authentication
   * @param baseUrl Optional base URL for the provider
   * @returns Promise resolving to array of model identifiers
   *
   * @throws Error if the API key is invalid or the request fails
   *
   * @example
   * ```typescript
   * const models = await plugin.getAvailableModels(apiKey);
   * // Returns: ['gpt-4', 'gpt-3.5-turbo', ...]
   * ```
   */
  getAvailableModels: (apiKey: string, baseUrl?: string) => Promise<string[]>;

  /**
   * Get static model information without requiring API calls
   *
   * This method returns cached or hardcoded information about models
   * supported by this provider. Useful for displaying model information
   * without needing to make an API call.
   *
   * @returns Array of ModelInfo objects (optional if expensive to compute)
   *
   * @example
   * ```typescript
   * const models = plugin.getModelInfo?.() || [];
   * // Returns: [
   * //   { id: 'gpt-4', name: 'GPT-4', contextWindow: 8192, ... },
   * //   { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', ... }
   * // ]
   * ```
   */
  getModelInfo?: () => ModelInfo[];

  /**
   * Get embedding models supported by this provider (OPTIONAL)
   *
   * Returns information about embedding models available from this provider.
   * Only applicable for providers where `capabilities.embeddings` is true.
   *
   * @returns Array of EmbeddingModelInfo objects
   *
   * @example
   * ```typescript
   * const embeddingModels = plugin.getEmbeddingModels?.() || [];
   * // Returns: [
   * //   { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimensions: 1536 },
   * //   ...
   * // ]
   * ```
   */
  getEmbeddingModels?: () => EmbeddingModelInfo[];

  /**
   * Get image generation models supported by this provider (OPTIONAL)
   *
   * Returns information about image generation models available from this provider.
   * Only applicable for providers where `capabilities.imageGeneration` is true.
   *
   * @returns Array of ImageGenerationModelInfo objects
   *
   * @example
   * ```typescript
   * const imageModels = plugin.getImageGenerationModels?.() || [];
   * // Returns: [
   * //   { id: 'dall-e-3', name: 'DALL-E 3', supportedAspectRatios: ['1:1', '16:9'] },
   * //   ...
   * // ]
   * ```
   */
  getImageGenerationModels?: () => ImageGenerationModelInfo[];

  /**
   * Validate an API key for this provider
   *
   * Should test the API key by making a minimal API call to verify
   * that it is valid and has proper permissions.
   *
   * @param apiKey The API key to validate
   * @param baseUrl Optional base URL for the provider
   * @returns Promise resolving to true if valid, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = await plugin.validateApiKey(apiKey);
   * ```
   */
  validateApiKey: (apiKey: string, baseUrl?: string) => Promise<boolean>;

  /**
   * Provider icon as SVG data (RECOMMENDED)
   *
   * Provides the icon as raw SVG data that Quilltap will render.
   * This is the preferred approach as it doesn't require React in the plugin.
   *
   * Can be either:
   * - A raw SVG string: `<svg viewBox="0 0 24 24">...</svg>`
   * - Structured data with viewBox and path elements
   *
   * If not provided, falls back to `renderIcon` (deprecated) or generates
   * a default icon from the provider's abbreviation.
   *
   * @example
   * ```typescript
   * // Option 1: Raw SVG string
   * icon: {
   *   svg: '<svg viewBox="0 0 24 24"><path d="M12 2..." fill="currentColor"/></svg>'
   * }
   *
   * // Option 2: Structured data (useful for simple icons)
   * icon: {
   *   viewBox: '0 0 24 24',
   *   paths: [
   *     { d: 'M12 2L2 7l10 5 10-5-10-5z', fill: 'currentColor' },
   *     { d: 'M2 17l10 5 10-5', fill: 'currentColor', opacity: '0.5' }
   *   ]
   * }
   * ```
   */
  icon?: {
    /** Raw SVG string (complete <svg> element) */
    svg?: string;
    /** SVG viewBox attribute (e.g., '0 0 24 24') - used with paths */
    viewBox?: string;
    /** SVG path elements - used with viewBox */
    paths?: Array<{
      d: string;
      fill?: string;
      stroke?: string;
      strokeWidth?: string;
      opacity?: string;
      fillRule?: 'nonzero' | 'evenodd';
    }>;
    /** SVG circle elements - used with viewBox */
    circles?: Array<{
      cx: string | number;
      cy: string | number;
      r: string | number;
      fill?: string;
      stroke?: string;
      strokeWidth?: string;
      opacity?: string;
    }>;
    /** SVG text element for abbreviation - used with viewBox */
    text?: {
      content: string;
      x?: string;
      y?: string;
      fontSize?: string;
      fontWeight?: string;
      fill?: string;
    };
  };

  /**
   * Render the provider icon as a React component (DEPRECATED)
   *
   * @deprecated Use the `icon` property instead, which doesn't require React.
   * This method is kept for backwards compatibility with existing external plugins.
   *
   * Returns a function that renders the provider's icon.
   * Called by the UI to display provider icons in various places.
   *
   * @param props Component props including optional className for styling
   * @returns JSX Element representing the provider icon
   *
   * @example
   * ```typescript
   * const Icon = plugin.renderIcon({ className: 'w-6 h-6' });
   * ```
   */
  renderIcon?: (props: { className?: string }) => React.ReactNode;

  /**
   * Convert universal tool format to provider-specific format (OPTIONAL)
   *
   * Converts UniversalTool(s) (OpenAI format) to the provider's native tool format.
   * Used during request preparation to format tools for the provider's API.
   *
   * Supports both single tool and array of tools for flexibility.
   * Implementation can accept tools in any format (OpenAI format or generic objects)
   * and return provider-specific format.
   *
   * If not implemented, routes will handle formatting (for backwards compatibility).
   * Once all providers implement this, route-level formatting can be removed.
   *
   * @param tool Single tool or array of tools in OpenAI function format
   * @param options Optional formatting options
   * @returns Tool(s) formatted for this provider's API
   *
   * @example
   * ```typescript
   * // For Anthropic, converts OpenAI format to tool_use format (single tool)
   * const anthropicTool = plugin.formatTools?.(universalTool);
   *
   * // Or with array
   * const anthropicTools = plugin.formatTools?.(universalTools);
   * ```
   */
  formatTools?: (tool: any, options?: ToolFormatOptions) => any;

  /**
   * Parse provider-specific tool calls from response (OPTIONAL)
   *
   * Extracts tool call requests from the provider's native response format.
   * Used during response processing to detect and execute tool calls.
   *
   * If not implemented, routes will use detectToolCalls() from tool-executor.ts
   * (for backwards compatibility).
   * Once all providers implement this, centralized detection can be removed.
   *
   * @param response The raw response from the provider's API
   * @returns Array of tool call requests in universal format
   *
   * @example
   * ```typescript
   * // For OpenAI, extracts tool_calls array from response
   * const toolCalls = plugin.parseToolCalls?.(response);
   * ```
   */
  parseToolCalls?: (response: any) => ToolCallRequest[];

  // =========================================================================
  // Text Tool Call Detection (for spontaneous tool call emissions)
  // =========================================================================

  /**
   * Check if a text response contains spontaneous tool call markers (OPTIONAL)
   *
   * Some models emit tool-call-like markup in their text output instead of
   * using the provider's native tool calling mechanism. This is a quick check
   * before full parsing — return true if the text might contain tool calls.
   *
   * @param text The model's text response content
   */
  hasTextToolMarkers?: (text: string) => boolean;

  /**
   * Parse spontaneous tool calls from response text (OPTIONAL)
   *
   * Extracts tool calls that models have hallucinated as text markup
   * instead of using native function calling. Returns the same standardized
   * ToolCallRequest[] format as parseToolCalls().
   *
   * @param text The model's text response content
   */
  parseTextToolCalls?: (text: string) => ToolCallRequest[];

  /**
   * Strip spontaneous tool call markers from text for display (OPTIONAL)
   *
   * Removes tool-call markup so the displayed response is clean.
   * Tool execution status is shown separately in the UI.
   *
   * @param text The model's text response content
   * @returns Cleaned text with markers removed
   */
  stripTextToolMarkers?: (text: string) => string;

  /**
   * Get image provider constraints (OPTIONAL)
   *
   * Returns constraints and limitations for image generation with this provider.
   * Used by the tool builder to add appropriate warnings and constraints
   * to image generation tool definitions.
   *
   * Only applicable for providers where `capabilities.imageGeneration` is true.
   *
   * @returns ImageProviderConstraints object or undefined if no constraints
   *
   * @example
   * ```typescript
   * const constraints = plugin.getImageProviderConstraints?.();
   * // Returns: {
   * //   maxPromptBytes: 1024,
   * //   promptConstraintWarning: 'Keep prompts under 1024 bytes'
   * // }
   * ```
   */
  getImageProviderConstraints?: () => ImageProviderConstraints;

  // =========================================================================
  // Runtime Configuration (all optional for backward compatibility)
  // =========================================================================

  /**
   * Message format support for multi-character contexts (OPTIONAL)
   * If not provided, defaults to no name field support
   */
  messageFormat?: MessageFormatSupport;

  /**
   * Token estimation multiplier (OPTIONAL)
   * Characters per token for this provider's tokenizer
   * @default 3.5
   */
  charsPerToken?: number;

  /**
   * Tool format type for this provider (OPTIONAL)
   * Used for quick format detection without calling formatTools()
   * @default 'openai'
   */
  toolFormat?: ToolFormatType;

  /**
   * Cheap model configuration for background tasks (OPTIONAL)
   * Used for memory extraction, summarization, titling, etc.
   */
  cheapModels?: CheapModelConfig;

  /**
   * Default context window when model is unknown (OPTIONAL)
   * Falls back to 8192 if not specified
   */
  defaultContextWindow?: number;
}

/**
 * Standard export type for provider plugins
 *
 * This is the expected export structure from plugin modules.
 *
 * @interface ProviderPluginExport
 *
 * @example
 * ```typescript
 * // In plugin-openai/index.ts
 * export const plugin: LLMProviderPlugin = { ... };
 *
 * // Or with the export type:
 * const pluginExport: ProviderPluginExport = {
 *   plugin: { ... }
 * };
 * export default pluginExport;
 * ```
 */
export interface ProviderPluginExport {
  /** The provider plugin instance */
  plugin: LLMProviderPlugin;
}

/**
 * Create a debug logger for provider plugin operations
 *
 * @param providerName The name of the provider for context
 * @returns A logger instance with provider context
 *
 * @internal
 */
export function createProviderLogger(providerName: string) {
  return logger.child({
    module: 'plugin-provider',
    provider: providerName,
  });
}
