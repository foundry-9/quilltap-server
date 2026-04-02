// LLM Provider Base Interface
// Re-exports canonical types from @quilltap/plugin-types
// and provides the BaseLLMProvider abstract class

// Re-export all types from plugin-types as the single source of truth
export type {
  // Common types
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,
  FileAttachment,
  TokenUsage,
  CacheUsage,
  AttachmentResults,

  // Text provider types
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,
  LLMResponse,
  StreamChunk,

  // Provider interfaces (new canonical names)
  TextProvider,

  // Image types
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  ImageProvider,
} from '@quilltap/plugin-types'

// Deprecated aliases
export type { TextProvider as LLMProvider } from '@quilltap/plugin-types'

import type { TextProvider, LLMParams, LLMResponse, StreamChunk, ModelMetadata } from '@quilltap/plugin-types'

/**
 * Abstract base class for LLM providers.
 * Providers can extend this class for default implementations of optional methods.
 */
export abstract class BaseLLMProvider implements TextProvider {
  // Whether this provider supports file attachments
  abstract readonly supportsFileAttachments: boolean

  // Supported MIME types for file attachments (empty if no support)
  abstract readonly supportedMimeTypes: string[]

  // Whether this provider supports web search
  abstract readonly supportsWebSearch: boolean

  abstract sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>
  abstract streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>
  abstract validateApiKey(apiKey: string): Promise<boolean>
  abstract getAvailableModels(apiKey: string): Promise<string[]>

  /**
   * Get metadata for a specific model, including warnings and recommendations.
   * Override this method in providers that need to return model-specific warnings.
   * @param _modelId The model ID to get metadata for
   * @returns ModelMetadata or undefined if no special metadata exists
   */
  getModelMetadata(_modelId: string): ModelMetadata | undefined {
    return undefined
  }

  /**
   * Get metadata for all available models.
   * Override this method in providers that have model-specific metadata.
   * @param _apiKey API key for fetching model list
   * @returns Array of ModelMetadata for models with special metadata
   */
  async getModelsWithMetadata(_apiKey: string): Promise<ModelMetadata[]> {
    return []
  }
}
