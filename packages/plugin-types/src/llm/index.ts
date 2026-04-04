/**
 * LLM types barrel export
 *
 * @module @quilltap/plugin-types/llm
 */

export type {
  // New canonical names
  TextProvider,
  ImageProvider,
  // Common types
  FileAttachment,
  TokenUsage,
  CacheUsage,
  AttachmentResults,
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,
  // Text provider types
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,
  LLMResponse,
  StreamChunk,
  // Image provider types
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  // Deprecated aliases
  LLMProvider,
  ImageGenProvider,
} from './base';

export type {
  OpenAIToolDefinition,
  UniversalTool,
  AnthropicToolDefinition,
  GoogleToolDefinition,
  ToolCall,
  ToolCallRequest,
  ToolResult,
  ToolFormatOptions,
} from './tools';

export type {
  EmbeddingResult,
  EmbeddingOptions,
  EmbeddingProvider,
  LocalEmbeddingProviderState,
  LocalEmbeddingProvider,
} from './embeddings';

export { isLocalEmbeddingProvider } from './embeddings';
