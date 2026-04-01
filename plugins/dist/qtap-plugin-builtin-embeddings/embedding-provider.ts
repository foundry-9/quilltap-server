/**
 * Built-in Embedding Provider
 *
 * Implements the LocalEmbeddingProvider interface using TF-IDF with BM25 enhancement.
 * This provider works entirely offline and requires no API keys.
 *
 * Key features:
 * - Zero external dependencies
 * - Offline operation
 * - Porter stemming for word normalization
 * - BM25-enhanced TF-IDF for better relevance
 * - Bigram support for phrase matching
 * - Serializable state for persistence
 */

import { TfIdfVectorizer } from './tfidf-vectorizer';
import type {
  LocalEmbeddingProvider,
  LocalEmbeddingProviderState,
  EmbeddingResult,
} from '@quilltap/plugin-types';

/**
 * Model name for the built-in TF-IDF provider
 */
export const BUILTIN_MODEL_NAME = 'tfidf-bm25-v1';

/**
 * Built-in TF-IDF Embedding Provider
 *
 * Provides offline embedding generation using TF-IDF with BM25 enhancement.
 * Must be fitted on a corpus before use, and the vocabulary state should
 * be persisted between sessions.
 */
export class BuiltinEmbeddingProvider implements LocalEmbeddingProvider {
  private vectorizer: TfIdfVectorizer;

  /**
   * Create a new Built-in Embedding Provider
   *
   * @param includeBigrams Whether to include bigrams in the vocabulary (default: true)
   */
  constructor(includeBigrams = true) {
    this.vectorizer = new TfIdfVectorizer(includeBigrams);
  }

  /**
   * Generate an embedding for a single text
   *
   * @param text The text to embed
   * @returns The embedding result
   * @throws Error if the provider has not been fitted
   */
  generateEmbedding(text: string): EmbeddingResult {
    if (!this.vectorizer.isFitted()) {
      throw new Error(
        'Built-in embedding provider must be fitted before generating embeddings. ' +
        'Call fitCorpus() with your documents first.'
      );
    }

    const embedding = this.vectorizer.transform(text);

    return {
      embedding,
      model: BUILTIN_MODEL_NAME,
      dimensions: embedding.length,
    };
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @returns Array of embedding results
   */
  generateBatchEmbeddings(texts: string[]): EmbeddingResult[] {
    return texts.map(text => this.generateEmbedding(text));
  }

  /**
   * Fit the vocabulary on a corpus of documents
   *
   * This analyzes the corpus to build vocabulary, calculate IDF weights,
   * and compute statistics needed for embedding generation.
   *
   * After fitting, the state should be saved using getState() and stored
   * in the database for persistence.
   *
   * @param documents Array of text documents to analyze
   */
  fitCorpus(documents: string[]): void {
    this.vectorizer.fitCorpus(documents);
  }

  /**
   * Check if the vocabulary has been fitted
   *
   * @returns True if fitCorpus has been called with documents
   */
  isFitted(): boolean {
    return this.vectorizer.isFitted();
  }

  /**
   * Load state from a serialized representation
   *
   * Call this to restore the vocabulary from the database.
   *
   * @param state The serialized provider state
   */
  loadState(state: LocalEmbeddingProviderState): void {
    this.vectorizer.loadState(state);
  }

  /**
   * Get the current state for serialization
   *
   * Call this to save the vocabulary to the database.
   *
   * @returns The provider state, or null if not fitted
   */
  getState(): LocalEmbeddingProviderState | null {
    return this.vectorizer.getState();
  }

  /**
   * Get the vocabulary size
   *
   * @returns Number of terms in the vocabulary
   */
  getVocabularySize(): number {
    return this.vectorizer.getVocabularySize();
  }

  /**
   * Get the embedding dimensions
   *
   * @returns Number of dimensions in generated embeddings
   */
  getDimensions(): number {
    return this.vectorizer.getDimensions();
  }

  /**
   * Check if the provider is available
   *
   * The built-in provider is always available since it has no external dependencies.
   *
   * @returns Always returns true
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Get available models
   *
   * The built-in provider only has one model.
   *
   * @returns Array with single model ID
   */
  async getAvailableModels(): Promise<string[]> {
    return [BUILTIN_MODEL_NAME];
  }

  /**
   * Calculate cosine similarity between two embeddings
   *
   * @param a First embedding
   * @param b Second embedding
   * @returns Similarity score (0-1)
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    return TfIdfVectorizer.cosineSimilarity(a, b);
  }
}
