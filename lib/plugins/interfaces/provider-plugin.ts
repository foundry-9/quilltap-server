/**
 * Provider Plugin Interface
 *
 * Re-exports types from @quilltap/plugin-types as the single source of truth.
 * This file is kept for backward compatibility and for the createProviderLogger function.
 *
 * @module plugins/interfaces/provider-plugin
 */

import { logger } from '@/lib/logger';

// Re-export all types from plugin-types
export type {
  // Provider interfaces (new canonical names)
  TextProviderPlugin,
  TextProvider,
  ImageProvider,

  // Provider metadata & config
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,

  // Model info
  ModelInfo,
  EmbeddingModelInfo,
  ImageGenerationModelInfo,
  ImageStyleInfo,
  ImageProviderConstraints,

  // Runtime config
  MessageFormatSupport,
  CheapModelConfig,
  ToolFormatType,

  // Plugin export
  PluginIconData,
  ProviderPluginExport,

  // Tool types
  ToolCallRequest,
  ToolFormatOptions,
  UniversalTool,

  // Embedding types
  EmbeddingProvider,
  LocalEmbeddingProvider,

  // Deprecated aliases
  LLMProviderPlugin,
} from '@quilltap/plugin-types';

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
