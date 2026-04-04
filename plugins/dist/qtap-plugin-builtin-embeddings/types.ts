/**
 * Type re-exports for the Built-in Embeddings plugin
 *
 * @module qtap-plugin-builtin-embeddings/types
 */

export type {
  LLMProviderPlugin,
  TextProviderPlugin,
  EmbeddingModelInfo,
  EmbeddingResult,
  EmbeddingOptions,
  EmbeddingProvider,
  LocalEmbeddingProvider,
  LocalEmbeddingProviderState,
  IconProps,
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
} from '@quilltap/plugin-types';

export { isLocalEmbeddingProvider } from '@quilltap/plugin-types';
