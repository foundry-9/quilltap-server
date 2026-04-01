/**
 * Provider Plugin Interface types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/plugins/provider
 */

import type { ReactNode } from 'react';
import type { LLMProvider, ImageGenProvider } from '../llm/base';
import type { ToolCallRequest, ToolFormatOptions } from '../llm/tools';

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
 *   renderIcon: ({ className }) => <MyIcon className={className} />,
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
   */
  createEmbeddingProvider?: (baseUrl?: string) => unknown;

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
   * Render the provider icon as a React component
   * @param props Icon component props
   */
  renderIcon: (props: IconProps) => ReactNode;

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
