/**
 * Core LLM types for Quilltap plugin development
 *
 * @module @quilltap/plugin-types/llm
 */

import type { ToolCall } from './tools';

/**
 * File attachment for multimodal messages
 */
export interface FileAttachment {
  /** Unique identifier for the attachment */
  id: string;
  /** Path to the file on disk (internal use) */
  filepath?: string;
  /** Original filename */
  filename: string;
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Base64 encoded data (loaded at send time) */
  data?: string;
  /** URL to fetch the file (alternative to data) */
  url?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Message in a conversation
 */
export interface LLMMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Message content */
  content: string;
  /** Optional name for multi-character chats */
  name?: string;
  /** File attachments for this message */
  attachments?: FileAttachment[];
  /** Tool call ID (for tool role messages) */
  toolCallId?: string;
  /** Tool calls made by assistant */
  toolCalls?: ToolCall[];
  /** Cache control for prompt caching (Anthropic, Google) */
  cacheControl?: { type: 'ephemeral' };
  /** Google Gemini thought signature for thinking models */
  thoughtSignature?: string;
}

/**
 * JSON Schema definition for structured outputs
 */
export interface JSONSchemaDefinition {
  /** Name of the schema */
  name: string;
  /** Whether to use strict mode */
  strict?: boolean;
  /** The JSON schema object */
  schema: Record<string, unknown>;
}

/**
 * Response format for structured outputs
 */
export interface ResponseFormat {
  /** Output type */
  type: 'text' | 'json_object' | 'json_schema';
  /** JSON schema definition (when type is 'json_schema') */
  jsonSchema?: JSONSchemaDefinition;
}

/**
 * Parameters for LLM requests
 */
export interface LLMParams {
  /** Array of messages in the conversation */
  messages: LLMMessage[];
  /** Model identifier */
  model: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Nucleus sampling parameter */
  topP?: number;
  /** Stop sequences */
  stop?: string | string[];
  /** Tool definitions (provider-specific format) */
  tools?: unknown[];
  /** Tool choice configuration */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Response format for structured outputs */
  responseFormat?: ResponseFormat;
  /** Seed for deterministic generation */
  seed?: number;
  /** User identifier for tracking */
  user?: string;
  /** Enable native web search capability */
  webSearchEnabled?: boolean;
  /** Provider-specific parameters from profile */
  profileParameters?: Record<string, unknown>;
  /** Previous response ID for conversation chaining (OpenAI Responses API) */
  previousResponseId?: string;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  /** Tokens used for the prompt */
  promptTokens: number;
  /** Tokens used for the completion */
  completionTokens: number;
  /** Total tokens used */
  totalTokens: number;
}

/**
 * Cache usage statistics (OpenRouter, Anthropic)
 */
export interface CacheUsage {
  /** Number of cached tokens */
  cachedTokens?: number;
  /** Cache discount amount */
  cacheDiscount?: number;
  /** Tokens used for cache creation */
  cacheCreationInputTokens?: number;
  /** Tokens read from cache */
  cacheReadInputTokens?: number;
}

/**
 * Attachment processing results
 */
export interface AttachmentResults {
  /** IDs of attachments sent successfully */
  sent: string[];
  /** Attachments that failed with error details */
  failed: Array<{ id: string; error: string }>;
}

/**
 * Response from LLM
 */
export interface LLMResponse {
  /** Generated content */
  content: string;
  /** Reason generation stopped */
  finishReason: string | null;
  /** Token usage statistics */
  usage: TokenUsage;
  /** Provider-specific raw response */
  raw?: unknown;
  /** Tool calls made by the model */
  toolCalls?: ToolCall[];
  /** Results of attachment processing */
  attachmentResults?: AttachmentResults;
  /** Google Gemini thought signature */
  thoughtSignature?: string;
  /** Cache usage statistics */
  cacheUsage?: CacheUsage;
}

/**
 * Streaming chunk from LLM
 */
export interface StreamChunk {
  /** Content in this chunk */
  content: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Token usage (typically on final chunk) */
  usage?: TokenUsage;
  /** Tool calls (typically on final chunk) */
  toolCalls?: ToolCall[];
  /** Attachment results (typically on final chunk) */
  attachmentResults?: AttachmentResults;
  /** Raw response for tool call detection */
  rawResponse?: unknown;
  /** Google Gemini thought signature */
  thoughtSignature?: string;
  /** Cache usage statistics */
  cacheUsage?: CacheUsage;
}

/**
 * Image generation parameters
 */
export interface ImageGenParams {
  /** Image generation prompt */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Model identifier */
  model?: string;
  /** Image size (e.g., '1024x1024') */
  size?: string;
  /** Aspect ratio (e.g., '16:9') */
  aspectRatio?: string;
  /** Image quality */
  quality?: 'standard' | 'hd';
  /** Image style */
  style?: 'vivid' | 'natural';
  /** Number of images to generate */
  n?: number;
  /** Response format */
  responseFormat?: 'url' | 'b64_json';
  /** Seed for reproducibility */
  seed?: number;
  /** Guidance scale for diffusion models */
  guidanceScale?: number;
  /** Inference steps for diffusion models */
  steps?: number;
}

/**
 * Generated image result
 */
export interface GeneratedImage {
  /** Base64 encoded image data */
  data?: string;
  /** URL to the generated image */
  url?: string;
  /** Deprecated: use 'data' instead */
  b64Json?: string;
  /** Image MIME type */
  mimeType?: string;
  /** Revised prompt (some providers modify the prompt) */
  revisedPrompt?: string;
  /** Seed used for generation */
  seed?: number;
}

/**
 * Image generation response
 */
export interface ImageGenResponse {
  /** Array of generated images */
  images: GeneratedImage[];
  /** Provider-specific raw response */
  raw?: unknown;
}

/**
 * Model warning level
 */
export type ModelWarningLevel = 'info' | 'warning' | 'error';

/**
 * Model warning information
 */
export interface ModelWarning {
  /** Warning severity level */
  level: ModelWarningLevel;
  /** Warning message */
  message: string;
  /** Optional link to documentation */
  documentationUrl?: string;
}

/**
 * Model metadata with warnings and capabilities
 */
export interface ModelMetadata {
  /** Model identifier */
  id: string;
  /** Human-readable display name */
  displayName?: string;
  /** Warnings or recommendations */
  warnings?: ModelWarning[];
  /** Whether the model is deprecated */
  deprecated?: boolean;
  /** Whether the model is experimental/preview */
  experimental?: boolean;
  /** Capabilities this model lacks */
  missingCapabilities?: string[];
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Context window size */
  contextWindow?: number;
}

/**
 * Core LLM provider interface
 *
 * Plugins can implement this interface to provide LLM functionality.
 */
export interface LLMProvider {
  /** Whether this provider supports file attachments */
  readonly supportsFileAttachments: boolean;
  /** Supported MIME types for file attachments */
  readonly supportedMimeTypes: string[];
  /** Whether this provider supports image generation */
  readonly supportsImageGeneration: boolean;
  /** Whether this provider supports web search */
  readonly supportsWebSearch: boolean;

  /**
   * Send a message and get a complete response
   */
  sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>;

  /**
   * Send a message and stream the response
   */
  streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>;

  /**
   * Validate an API key
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get available models from the provider
   */
  getAvailableModels(apiKey: string): Promise<string[]>;

  /**
   * Generate an image (optional)
   */
  generateImage?(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;

  /**
   * Get metadata for a specific model (optional)
   */
  getModelMetadata?(modelId: string): ModelMetadata | undefined;

  /**
   * Get metadata for all models with warnings (optional)
   */
  getModelsWithMetadata?(apiKey: string): Promise<ModelMetadata[]>;
}

/**
 * Image generation provider interface
 */
export interface ImageGenProvider {
  /** Provider identifier */
  readonly provider: string;
  /** Models supported by this provider */
  readonly supportedModels: string[];

  /**
   * Generate an image
   */
  generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;

  /**
   * Validate an API key
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get available models
   */
  getAvailableModels(apiKey?: string): Promise<string[]>;
}
