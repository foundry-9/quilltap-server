/**
 * Embedding Provider Types for Quilltap plugin development
 *
 * This module re-exports types from the canonical providers/embedding.ts.
 * New code should import from '@quilltap/plugin-types' directly.
 *
 * @module @quilltap/plugin-types/llm/embeddings
 */

export type {
  EmbeddingResult,
  EmbeddingOptions,
  EmbeddingProvider,
  LocalEmbeddingProviderState,
  LocalEmbeddingProvider,
} from '../providers/embedding';

export { isLocalEmbeddingProvider } from '../providers/embedding';
