/**
 * Core LLM types for Quilltap plugin development
 *
 * This module re-exports types from the canonical providers/ directory.
 * New code should import from '@quilltap/plugin-types' directly, which
 * exports the new provider interface names (TextProvider, ImageProvider, etc.)
 *
 * @module @quilltap/plugin-types/llm
 */

// Re-export common types
export type {
  FileAttachment,
  TokenUsage,
  CacheUsage,
  AttachmentResults,
  ModelWarningLevel,
  ModelWarning,
  ModelMetadata,
} from '../providers/common';

// Re-export text provider types
export type {
  LLMMessage,
  JSONSchemaDefinition,
  ResponseFormat,
  LLMParams,
  LLMResponse,
  StreamChunk,
  TextProvider,
} from '../providers/text';

// Re-export image provider types
export type {
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  ImageProvider,
} from '../providers/image';

/**
 * @deprecated Use `TextProvider` instead. This alias is kept for backward compatibility.
 */
export type { TextProvider as LLMProvider } from '../providers/text';

/**
 * @deprecated Use `ImageProvider` instead. This alias is kept for backward compatibility.
 */
export type { ImageProvider as ImageGenProvider } from '../providers/image';
