/**
 * LLM types barrel export
 *
 * @module @quilltap/plugin-types/llm
 */

export type {
  FileAttachment,
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,
  TokenUsage,
  CacheUsage,
  AttachmentResults,
  LLMResponse,
  StreamChunk,
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,
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
