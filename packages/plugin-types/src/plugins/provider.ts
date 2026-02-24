/**
 * Provider Plugin Interface types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/plugins/provider
 */

import type { LLMProvider, ImageGenProvider } from '../llm/base';
import type { ToolCallRequest, ToolFormatOptions } from '../llm/tools';
import type { EmbeddingProvider, LocalEmbeddingProvider } from '../llm/embeddings';

/**
 * SVG icon data that can be provided by plugins without React dependency
 *
 * Plugins can provide icon data in one of two formats:
 * 1. Raw SVG string: Complete `<svg>` element as a string
 * 2. Structured data: viewBox with paths, circles, and/or text elements
 *
 * @example
 * ```typescript
 * // Option 1: Raw SVG string
 * icon: {
 *   svg: '<svg viewBox="0 0 24 24"><path d="M12 2..." fill="currentColor"/></svg>'
 * }
 *
 * // Option 2: Structured data
 * icon: {
 *   viewBox: '0 0 24 24',
 *   paths: [
 *     { d: 'M12 2L2 7l10 5 10-5-10-5z', fill: 'currentColor' }
 *   ]
 * }
 * ```
 */
export interface PluginIconData {
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
 * Provider metadata for UI display and identification
 */
export interface ProviderMetadata {
  /** Internal identifier for the provider (e.g., 'OPENAI', 'ANTHROPIC') */
  providerName: string;
  /** Human-readable display name for UI (e.g., 'OpenAI', 'Anthropic') */
  displayName: string;
  /** Short description of the provider */
  description: string;
  /** Short abbreviation for icon display (e.g., 'OAI', 'ANT') */
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
  /**
   * Legacy provider names that should be treated as aliases for this provider.
   * Used for backward compatibility when provider names change.
   * Example: ['GOOGLE_IMAGEN'] for the GOOGLE provider.
   */
  legacyNames?: string[];
}

/**
 * Configuration requirements for the provider
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
  /** Placeholder text for base URL input */
  baseUrlPlaceholder?: string;
  /** Default value for base URL */
  baseUrlDefault?: string;
  /** Deprecated: use baseUrlDefault instead */
  defaultBaseUrl?: string;
}

/**
 * Provider capability flags
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
 * Attachment/file support configuration
 */
export interface AttachmentSupport {
  /** Whether this provider supports file attachments */
  supportsAttachments: boolean;
  /** Array of MIME types supported for attachments */
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
 * Information about a specific model
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
  /** Pricing information */
  pricing?: {
    /** Price per 1M input tokens */
    input: number;
    /** Price per 1M output tokens */
    output: number;
  };
}

/**
 * Information about an embedding model
 */
export interface EmbeddingModelInfo {
  /** Unique identifier for the embedding model */
  id: string;
  /** Human-readable name of the model */
  name: string;
  /** Dimensions of the embedding vector output */
  dimensions?: number;
  /** Description of the model's characteristics */
  description?: string;
}

/**
 * Information about an image generation model
 */
export interface ImageGenerationModelInfo {
  /** Unique identifier for the model */
  id: string;
  /** Human-readable name of the model */
  name: string;
  /** Supported aspect ratios (e.g., ['1:1', '16:9']) */
  supportedAspectRatios?: string[];
  /** Supported image sizes (e.g., ['1024x1024', '512x512']) */
  supportedSizes?: string[];
  /** Description of the model */
  description?: string;
}

/**
 * Information about a style or LoRA available for an image provider
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
 * Constraints for image generation
 */
export interface ImageProviderConstraints {
  /** Maximum bytes allowed for image generation prompt */
  maxPromptBytes?: number;
  /** Warning message about prompt constraints */
  promptConstraintWarning?: string;
  /** Maximum images per request */
  maxImagesPerRequest?: number;
  /** Supported aspect ratios */
  supportedAspectRatios?: string[];
  /** Supported image sizes */
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
 * Icon component props
 */
export interface IconProps {
  /** CSS class for styling */
  className?: string;
}

/**
 * Message format support for multi-character chats
 * Defines how the provider handles the 'name' field in messages
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
 * Main LLM Provider Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded
 * by Quilltap to provide LLM functionality from various providers.
 *
 * @example
 * ```typescript
 * import type { LLMProviderPlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: LLMProviderPlugin = {
 *   metadata: {
 *     providerName: 'MY_PROVIDER',
 *     displayName: 'My Provider',
 *     description: 'Custom LLM provider',
 *     abbreviation: 'MYP',
 *     colors: { bg: 'bg-blue-100', text: 'text-blue-800', icon: 'text-blue-600' },
 *   },
 *   config: {
 *     requiresApiKey: true,
 *     requiresBaseUrl: false,
 *     apiKeyLabel: 'API Key',
 *   },
 *   capabilities: {
 *     chat: true,
 *     imageGeneration: false,
 *     embeddings: false,
 *     webSearch: false,
 *   },
 *   attachmentSupport: {
 *     supportsAttachments: false,
 *     supportedMimeTypes: [],
 *     description: 'No file attachments supported',
 *   },
 *   createProvider: () => new MyProvider(),
 *   getAvailableModels: async (apiKey) => [...],
 *   validateApiKey: async (apiKey) => {...},
 *   icon: {
 *     viewBox: '0 0 24 24',
 *     paths: [{ d: 'M12 2L2 7l10 5 10-5-10-5z', fill: 'currentColor' }]
 *   },
 * };
 * ```
 */
export interface LLMProviderPlugin {
  /** Provider metadata for UI display and identification */
  metadata: ProviderMetadata;

  /** Configuration requirements for this provider */
  config: ProviderConfigRequirements;

  /** Supported capabilities for this provider */
  capabilities: ProviderCapabilities;

  /** File attachment support information */
  attachmentSupport: AttachmentSupport;

  /**
   * Factory method to create an LLMProvider instance
   * @param baseUrl Optional base URL for the provider
   */
  createProvider: (baseUrl?: string) => LLMProvider;

  /**
   * Factory method to create an ImageGenProvider instance (optional)
   * Only required if capabilities.imageGeneration is true
   * @param baseUrl Optional base URL for the provider
   */
  createImageProvider?: (baseUrl?: string) => ImageGenProvider;

  /**
   * Factory method to create an embedding provider (optional)
   * Only required if capabilities.embeddings is true
   * @param baseUrl Optional base URL for the provider
   * @returns EmbeddingProvider for API-based providers, LocalEmbeddingProvider for local providers
   */
  createEmbeddingProvider?: (baseUrl?: string) => EmbeddingProvider | LocalEmbeddingProvider;

  /**
   * Get list of available models for this provider
   * @param apiKey API key for authentication
   * @param baseUrl Optional base URL
   */
  getAvailableModels: (apiKey: string, baseUrl?: string) => Promise<string[]>;

  /**
   * Get static model information without API calls
   */
  getModelInfo?: () => ModelInfo[];

  /**
   * Get embedding models supported by this provider
   */
  getEmbeddingModels?: () => EmbeddingModelInfo[];

  /**
   * Get image generation models supported by this provider
   */
  getImageGenerationModels?: () => ImageGenerationModelInfo[];

  /**
   * Validate an API key for this provider
   * @param apiKey API key to validate
   * @param baseUrl Optional base URL
   */
  validateApiKey: (apiKey: string, baseUrl?: string) => Promise<boolean>;

  /**
   * Provider icon as SVG data (RECOMMENDED)
   *
   * Provides the icon as raw SVG data that Quilltap will render.
   * This is the preferred approach as it doesn't require React in the plugin.
   *
   * If not provided, falls back to `renderIcon` (deprecated) or generates
   * a default icon from the provider's abbreviation.
   *
   * @example
   * ```typescript
   * icon: {
   *   viewBox: '0 0 24 24',
   *   paths: [{ d: 'M12 2L2 7l10 5 10-5-10-5z', fill: 'currentColor' }]
   * }
   * ```
   */
  icon?: PluginIconData;

  /**
   * Render the provider icon as a React component
   * @deprecated Use the `icon` property instead, which doesn't require React.
   * This is kept for backwards compatibility with existing external plugins.
   * @param props Icon component props
   */
  renderIcon?: (props: IconProps) => unknown;

  /**
   * Convert universal tool format to provider-specific format (optional)
   * @param tool Tools in OpenAI format or generic objects
   * @param options Formatting options
   */
  formatTools?: (tool: any, options?: ToolFormatOptions) => any;

  /**
   * Parse provider-specific tool calls from response (optional)
   * @param response Raw API response
   */
  parseToolCalls?: (response: any) => ToolCallRequest[];

  /**
   * Get image provider constraints (optional)
   * Only applicable for providers with imageGeneration capability
   */
  getImageProviderConstraints?: () => ImageProviderConstraints;

  // =========================================================================
  // Runtime Configuration (all optional for backward compatibility)
  // =========================================================================

  /**
   * Message format support for multi-character contexts (optional)
   * If not provided, defaults to no name field support
   */
  messageFormat?: MessageFormatSupport;

  /**
   * Token estimation multiplier (optional)
   * Characters per token for this provider's tokenizer
   * @default 3.5
   */
  charsPerToken?: number;

  /**
   * Tool format type for this provider (optional)
   * Used for quick format detection without calling formatTools()
   * @default 'openai'
   */
  toolFormat?: ToolFormatType;

  /**
   * Cheap model configuration for background tasks (optional)
   * Used for memory extraction, summarization, titling, etc.
   */
  cheapModels?: CheapModelConfig;

  /**
   * Default context window when model is unknown (optional)
   * Falls back to 8192 if not specified
   */
  defaultContextWindow?: number;
}

/**
 * Standard export type for provider plugins
 */
export interface ProviderPluginExport {
  /** The provider plugin instance */
  plugin: LLMProviderPlugin;
}
