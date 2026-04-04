/**
 * Embedding Provider — Shape 3: Text -> Vector
 *
 * Send text to an embedding model, receive a numeric vector representation.
 * Used for semantic search, RAG, and similarity matching.
 *
 * @module @quilltap/plugin-types/providers/embedding
 */

/**
 * Result of an embedding operation
 */
export interface EmbeddingResult {
  /** The embedding vector (array of floating point numbers) */
  embedding: number[];
  /** The model used to generate the embedding */
  model: string;
  /** Number of dimensions in the embedding vector */
  dimensions: number;
  /** Token usage information (if available) */
  usage?: {
    promptTokens: number;
    totalTokens: number;
    cost?: number;
  };
}

/**
 * Options for embedding generation
 */
export interface EmbeddingOptions {
  /** Desired dimensions for the embedding (if model supports variable dimensions) */
  dimensions?: number;
}

/**
 * Embedding provider interface — Shape 3: Text -> Vector
 *
 * Sends text to an embedding model and receives a numeric vector
 * representation for use in semantic search, RAG, and similarity matching.
 */
export interface EmbeddingProvider {
  /**
   * Generate an embedding for a single text
   *
   * @param text The text to embed
   * @param model The model to use
   * @param apiKey The API key for authentication
   * @param options Optional configuration
   * @returns The embedding result
   */
  generateEmbedding(
    text: string,
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey The API key for authentication
   * @param options Optional configuration
   * @returns Array of embedding results
   */
  generateBatchEmbeddings?(
    texts: string[],
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]>;

  /**
   * Get available embedding models
   *
   * @param apiKey The API key for authentication
   * @returns Array of model IDs
   */
  getAvailableModels?(apiKey: string): Promise<string[]>;

  /**
   * Check if the provider is available and properly configured
   *
   * @param apiKey Optional API key to validate
   * @returns True if the provider is ready to use
   */
  isAvailable?(apiKey?: string): Promise<boolean>;
}

/**
 * Serializable state for local embedding providers
 *
 * Used by providers like TF-IDF that maintain vocabulary state
 */
export interface LocalEmbeddingProviderState {
  /** The vocabulary as an array of [term, index] pairs */
  vocabulary: [string, number][];
  /** The IDF (Inverse Document Frequency) weights */
  idf: number[];
  /** Average document length across the corpus */
  avgDocLength: number;
  /** Size of the vocabulary */
  vocabularySize: number;
  /** Whether bigrams are included in the vocabulary */
  includeBigrams: boolean;
  /** Timestamp when the vocabulary was fitted */
  fittedAt: string;
}

/**
 * Local embedding provider interface
 *
 * Extended interface for local/offline embedding providers that
 * maintain vocabulary state (like TF-IDF). These providers don't
 * require API keys and can work entirely offline.
 */
export interface LocalEmbeddingProvider extends Omit<EmbeddingProvider, 'generateEmbedding' | 'generateBatchEmbeddings'> {
  /**
   * Generate an embedding for a single text
   * Local providers don't need apiKey parameter
   *
   * @param text The text to embed
   * @returns The embedding result
   */
  generateEmbedding(text: string): EmbeddingResult;

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @returns Array of embedding results
   */
  generateBatchEmbeddings(texts: string[]): EmbeddingResult[];

  /**
   * Fit the vocabulary on a corpus of documents
   *
   * This method analyzes the corpus to build vocabulary, calculate IDF weights,
   * and other statistics needed for embedding generation.
   *
   * @param documents Array of text documents to analyze
   */
  fitCorpus(documents: string[]): void;

  /**
   * Check if the vocabulary has been fitted
   *
   * @returns True if fitCorpus has been called with documents
   */
  isFitted(): boolean;

  /**
   * Load state from a serialized representation
   *
   * @param state The serialized provider state
   */
  loadState(state: LocalEmbeddingProviderState): void;

  /**
   * Get the current state for serialization
   *
   * @returns The provider state, or null if not fitted
   */
  getState(): LocalEmbeddingProviderState | null;

  /**
   * Get the vocabulary size
   *
   * @returns Number of terms in the vocabulary
   */
  getVocabularySize(): number;

  /**
   * Get the embedding dimensions
   *
   * @returns Number of dimensions in generated embeddings
   */
  getDimensions(): number;
}

/**
 * Type guard to check if a provider is a local embedding provider
 */
export function isLocalEmbeddingProvider(
  provider: EmbeddingProvider | LocalEmbeddingProvider
): provider is LocalEmbeddingProvider {
  return 'fitCorpus' in provider && 'loadState' in provider && 'getState' in provider;
}
