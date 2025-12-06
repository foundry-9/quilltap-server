// LLM Provider Base Interface
// Phase 0.5: Single Chat MVP

// Model metadata for warnings, recommendations, and capability info
export type ModelWarningLevel = 'info' | 'warning' | 'error'

export interface ModelWarning {
  level: ModelWarningLevel
  message: string
  // Optional link to documentation or more info
  documentationUrl?: string
}

export interface ModelMetadata {
  // The model ID (e.g., "gemini-3-pro-image-preview")
  id: string
  // Optional display name (e.g., "Gemini 3 Pro Image Preview")
  displayName?: string
  // Warnings or recommendations for this model
  warnings?: ModelWarning[]
  // Whether this model is deprecated
  deprecated?: boolean
  // Whether this model is experimental/preview
  experimental?: boolean
  // Capabilities this model lacks (for informational purposes)
  missingCapabilities?: string[]
}

export interface FileAttachment {
  id: string
  filepath: string
  filename: string
  mimeType: string
  size: number
  // Base64 encoded data (loaded at send time)
  data?: string
}

// Image Generation Types
export interface ImageGenParams {
  prompt: string
  model?: string // Provider-specific model
  n?: number // Number of images (default 1)
  size?: string // e.g., "1024x1024"
  quality?: 'standard' | 'hd'
  style?: 'vivid' | 'natural'
  aspectRatio?: string // For Gemini: "16:9", "4:3", etc.
}

export interface GeneratedImage {
  data: string // Base64 encoded image data
  mimeType: string // "image/png" or "image/jpeg"
  revisedPrompt?: string // Some providers return revised prompt
}

export interface ImageGenResponse {
  images: GeneratedImage[]
  raw: any
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  // File attachments for this message (typically only for user messages)
  attachments?: FileAttachment[]
  // Google Gemini thought signature for thinking models (e.g., gemini-3-pro)
  // Must be preserved and passed back for multi-turn conversations with function calling
  thoughtSignature?: string
}

export interface LLMParams {
  messages: LLMMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stop?: string[]
  tools?: any[] // Provider-specific tool definitions (OpenAI function_calling, Anthropic tool_use, etc.)
  // Native web search - when enabled, provider will use its built-in web search capability
  webSearchEnabled?: boolean
}

export interface LLMResponse {
  content: string
  finishReason: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  raw: any // Provider-specific raw response
  // Report which attachments were successfully sent vs failed
  attachmentResults?: {
    sent: string[] // IDs of attachments sent successfully
    failed: { id: string; error: string }[] // IDs of attachments that failed
  }
  // Google Gemini thought signature for thinking models (must be stored and passed back)
  thoughtSignature?: string
}

export interface StreamChunk {
  content: string
  done: boolean
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  // On the final chunk, include attachment results
  attachmentResults?: {
    sent: string[]
    failed: { id: string; error: string }[]
  }
  // Raw response for tool call detection
  rawResponse?: any
  // Google Gemini thought signature for thinking models (must be stored and passed back)
  thoughtSignature?: string
}

/**
 * LLMProvider interface for duck-typing compatibility with plugins.
 * Use this interface when typing provider instances.
 */
export interface LLMProvider {
  // Whether this provider supports file attachments
  readonly supportsFileAttachments: boolean

  // Supported MIME types for file attachments (empty if no support)
  readonly supportedMimeTypes: string[]

  // Whether this provider supports image generation
  readonly supportsImageGeneration: boolean

  // Whether this provider supports web search
  readonly supportsWebSearch: boolean

  sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>
  streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>
  validateApiKey(apiKey: string): Promise<boolean>
  getAvailableModels(apiKey: string): Promise<string[]>
  generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>

  /**
   * Get metadata for a specific model, including warnings and recommendations.
   * Optional - providers can implement to return model-specific warnings.
   */
  getModelMetadata?(modelId: string): ModelMetadata | undefined

  /**
   * Get metadata for all available models.
   * Optional - providers can implement to return metadata for models with warnings.
   */
  getModelsWithMetadata?(apiKey: string): Promise<ModelMetadata[]>
}

/**
 * Abstract base class for LLM providers.
 * Providers can extend this class for default implementations of optional methods.
 */
export abstract class BaseLLMProvider implements LLMProvider {
  // Whether this provider supports file attachments
  abstract readonly supportsFileAttachments: boolean

  // Supported MIME types for file attachments (empty if no support)
  abstract readonly supportedMimeTypes: string[]

  // Whether this provider supports image generation
  abstract readonly supportsImageGeneration: boolean

  // Whether this provider supports web search
  abstract readonly supportsWebSearch: boolean

  abstract sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>
  abstract streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>
  abstract validateApiKey(apiKey: string): Promise<boolean>
  abstract getAvailableModels(apiKey: string): Promise<string[]>
  abstract generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>

  /**
   * Get metadata for a specific model, including warnings and recommendations.
   * Override this method in providers that need to return model-specific warnings.
   * @param _modelId The model ID to get metadata for
   * @returns ModelMetadata or undefined if no special metadata exists
   */
  getModelMetadata(_modelId: string): ModelMetadata | undefined {
    // Default implementation returns undefined (no special metadata)
    // Providers can override this to return warnings for specific models
    return undefined
  }

  /**
   * Get metadata for all available models.
   * Override this method in providers that have model-specific metadata.
   * @param _apiKey API key for fetching model list
   * @returns Array of ModelMetadata for models with special metadata
   */
  async getModelsWithMetadata(_apiKey: string): Promise<ModelMetadata[]> {
    // Default implementation returns empty array
    // Providers can override to return metadata for models with warnings
    return []
  }
}
