/**
 * TF-IDF Vectorizer with BM25 Enhancement
 *
 * Implements TF-IDF (Term Frequency - Inverse Document Frequency) vectorization
 * with BM25 (Best Matching 25) enhancement for improved relevance scoring.
 *
 * BM25 is a ranking function that improves on basic TF-IDF by:
 * 1. Applying saturation to term frequency (diminishing returns for repeated terms)
 * 2. Normalizing by document length (shorter docs aren't unfairly penalized)
 *
 * This implementation includes:
 * - Porter stemming for word normalization
 * - Stop word removal
 * - Optional bigram support for phrase matching
 * - Serializable state for persistence
 */

import { tokenize, generateBigrams } from './porter-stemmer';
import type { LocalEmbeddingProviderState } from '@quilltap/plugin-types';

/**
 * BM25 Parameters
 *
 * k1: Controls term frequency saturation (1.2-2.0 typical)
 *     Higher values give more weight to term frequency
 *
 * b: Controls document length normalization (0.0-1.0)
 *    0 = no normalization, 1 = full normalization
 */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * TF-IDF Vectorizer with BM25 enhancement
 *
 * Transforms text documents into numerical vectors for semantic similarity search.
 */
export class TfIdfVectorizer {
  private vocabulary: Map<string, number> = new Map();
  private idf: number[] = [];
  private avgDocLength: number = 0;
  private includeBigrams: boolean;
  private fittedAt: string | null = null;

  /**
   * Create a new TF-IDF vectorizer
   *
   * @param includeBigrams Whether to include bigrams in the vocabulary (default: true)
   */
  constructor(includeBigrams = true) {
    this.includeBigrams = includeBigrams;
  }

  /**
   * Check if the vectorizer has been fitted
   */
  isFitted(): boolean {
    return this.vocabulary.size > 0 && this.fittedAt !== null;
  }

  /**
   * Get the vocabulary size
   */
  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  /**
   * Get the embedding dimensions (same as vocabulary size)
   */
  getDimensions(): number {
    return this.vocabulary.size;
  }

  /**
   * Fit the vectorizer on a corpus of documents
   *
   * This method:
   * 1. Tokenizes all documents
   * 2. Builds vocabulary from unique terms
   * 3. Calculates IDF weights
   * 4. Computes average document length for BM25
   *
   * @param documents Array of text documents
   */
  fitCorpus(documents: string[]): void {
    if (documents.length === 0) {
      throw new Error('Cannot fit on empty corpus');
    }

    // Tokenize all documents
    const tokenizedDocs = documents.map(doc => this.tokenizeDocument(doc));

    // Build vocabulary
    const termSet = new Set<string>();
    for (const tokens of tokenizedDocs) {
      for (const token of tokens) {
        termSet.add(token);
      }
    }

    // Assign indices to terms (sorted for consistency)
    const sortedTerms = Array.from(termSet).sort();
    this.vocabulary = new Map();
    for (let i = 0; i < sortedTerms.length; i++) {
      this.vocabulary.set(sortedTerms[i], i);
    }

    // Calculate document frequencies and IDF
    const docFrequencies = new Array(this.vocabulary.size).fill(0);
    for (const tokens of tokenizedDocs) {
      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        const idx = this.vocabulary.get(token);
        if (idx !== undefined) {
          docFrequencies[idx]++;
        }
      }
    }

    // IDF calculation: log((N - df + 0.5) / (df + 0.5) + 1)
    // This is the BM25 IDF formula
    const N = documents.length;
    this.idf = docFrequencies.map(df => {
      return Math.log((N - df + 0.5) / (df + 0.5) + 1);
    });

    // Calculate average document length for BM25
    let totalLength = 0;
    for (const tokens of tokenizedDocs) {
      totalLength += tokens.length;
    }
    this.avgDocLength = totalLength / documents.length;

    this.fittedAt = new Date().toISOString();
  }

  /**
   * Transform a document into a TF-IDF vector with BM25 weighting
   *
   * @param document The text document to vectorize
   * @returns The TF-IDF vector (sparse representation as full array)
   */
  transform(document: string): number[] {
    if (!this.isFitted()) {
      throw new Error('Vectorizer must be fitted before transform');
    }

    const tokens = this.tokenizeDocument(document);
    const docLength = tokens.length;

    // Count term frequencies
    const termCounts = new Map<string, number>();
    for (const token of tokens) {
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    }

    // Calculate BM25 TF-IDF scores
    const vector = new Array(this.vocabulary.size).fill(0);

    for (const [term, count] of termCounts) {
      const idx = this.vocabulary.get(term);
      if (idx === undefined) continue;

      // BM25 TF formula: (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)))
      const tf = count;
      const lengthNorm = 1 - BM25_B + BM25_B * (docLength / this.avgDocLength);
      const bm25Tf = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm);

      // Final score is BM25_TF * IDF
      vector[idx] = bm25Tf * this.idf[idx];
    }

    // L2 normalize the vector for cosine similarity
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * Tokenize a document into terms (unigrams and optionally bigrams)
   */
  private tokenizeDocument(document: string): string[] {
    const unigrams = tokenize(document);
    if (!this.includeBigrams) {
      return unigrams;
    }
    const bigrams = generateBigrams(unigrams);
    return [...unigrams, ...bigrams];
  }

  /**
   * Get the current state for serialization
   */
  getState(): LocalEmbeddingProviderState | null {
    if (!this.isFitted()) {
      return null;
    }

    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: this.idf,
      avgDocLength: this.avgDocLength,
      vocabularySize: this.vocabulary.size,
      includeBigrams: this.includeBigrams,
      fittedAt: this.fittedAt!,
    };
  }

  /**
   * Load state from a serialized representation
   */
  loadState(state: LocalEmbeddingProviderState): void {
    this.vocabulary = new Map(state.vocabulary);
    this.idf = state.idf;
    this.avgDocLength = state.avgDocLength;
    this.includeBigrams = state.includeBigrams;
    this.fittedAt = state.fittedAt;
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score (0-1, where 1 is identical)
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }
}
