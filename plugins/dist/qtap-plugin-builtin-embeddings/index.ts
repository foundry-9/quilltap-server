/**
 * Built-in Embeddings Provider Plugin for Quilltap
 *
 * This plugin provides offline, zero-dependency text embeddings using
 * TF-IDF with BM25 enhancement and Porter stemming.
 *
 * Key features:
 * - No API keys required
 * - Works entirely offline
 * - Zero external dependencies
 * - Porter stemming for word normalization
 * - BM25-enhanced TF-IDF for better relevance scoring
 * - Bigram support for phrase matching
 *
 * The embeddings are vocabulary-based, meaning all documents must be
 * processed with the same vocabulary. When documents are added or
 * updated, the vocabulary should be refitted and all embeddings regenerated.
 */

import type { TextProviderPlugin, EmbeddingModelInfo } from './types';
import { BuiltinEmbeddingProvider, BUILTIN_MODEL_NAME } from './embedding-provider';

/**
 * Plugin metadata configuration
 */
const metadata = {
  providerName: 'BUILTIN',
  displayName: 'Built-in (TF-IDF)',
  description: 'Offline embeddings using TF-IDF with BM25 enhancement - no API keys required',
  colors: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    icon: 'text-emerald-600',
  },
  abbreviation: 'TF',
} as const;

/**
 * Configuration requirements
 */
const config = {
  requiresApiKey: false,
  requiresBaseUrl: false,
} as const;

/**
 * Supported capabilities
 *
 * This plugin only provides embeddings - no chat or image generation.
 */
const capabilities = {
  chat: false,
  imageGeneration: false,
  embeddings: true,
  webSearch: false,
} as const;

/**
 * File attachment support
 */
const attachmentSupport = {
  supportsAttachments: false as const,
  supportedMimeTypes: [] as string[],
  description: 'No file attachments - embedding provider only',
};

/**
 * The Built-in Embeddings Provider Plugin
 *
 * Implements the LLMProviderPlugin interface for Quilltap.
 * Since this is an embedding-only provider, many LLM-related methods
 * throw errors when called.
 */
export const plugin: TextProviderPlugin = {
  metadata,

  config,

  capabilities,

  attachmentSupport,

  /**
   * Factory method to create the embedding provider
   *
   * Returns a LocalEmbeddingProvider that must be fitted on a corpus
   * before use. The vocabulary state should be persisted to the database.
   */
  createEmbeddingProvider: () => {
    return new BuiltinEmbeddingProvider(true); // Include bigrams
  },

  /**
   * This is an embedding-only provider - no LLM support
   */
  createProvider: () => {
    throw new Error('Built-in provider does not support chat - it is an embedding-only provider');
  },

  /**
   * This is an embedding-only provider - no image generation
   */
  createImageProvider: () => {
    throw new Error('Built-in provider does not support image generation');
  },

  /**
   * Get available chat models
   *
   * This provider does not support chat, so returns empty array.
   */
  getAvailableModels: async () => {
    return [];
  },

  /**
   * Get embedding models
   *
   * Returns information about the TF-IDF embedding model.
   * Note: dimensions are not fixed - they depend on vocabulary size.
   */
  getEmbeddingModels: (): EmbeddingModelInfo[] => {
    return [
      {
        id: BUILTIN_MODEL_NAME,
        name: 'TF-IDF with BM25',
        description:
          'Offline embedding model using TF-IDF with BM25 enhancement and Porter stemming. ' +
          'Dimensions vary based on vocabulary size (typically 1000-50000). ' +
          'Requires fitting on your document corpus.',
      },
    ];
  },

  /**
   * Validate API key
   *
   * Built-in provider does not use API keys, always returns true.
   */
  validateApiKey: async () => {
    return true;
  },

  /**
   * Render the provider icon
   */

  // No tool support needed for embedding provider
  formatTools: undefined,
  parseToolCalls: undefined,

  // No message format support needed
  messageFormat: undefined,

  // Runtime configuration not applicable
  charsPerToken: undefined,
  toolFormat: undefined,
  cheapModels: undefined,
  defaultContextWindow: undefined,
};

export default plugin;

// Re-export useful types and classes for direct use
export { BuiltinEmbeddingProvider, BUILTIN_MODEL_NAME } from './embedding-provider';
export { TfIdfVectorizer } from './tfidf-vectorizer';
export { stem, tokenize, generateBigrams, STOP_WORDS } from './porter-stemmer';
