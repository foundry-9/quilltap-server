/**
 * Ollama Embedding Provider Implementation
 *
 * Provides text embedding functionality using Ollama's embeddings API.
 * Supports any embedding model available on the local Ollama server.
 * Note: Ollama doesn't require API keys - it uses a local server.
 */

import { createPluginLogger } from '@quilltap/plugin-utils';
import type { EmbeddingProvider, EmbeddingResult } from './types';

const logger = createPluginLogger('qtap-plugin-ollama');

/**
 * Ollama Embedding Provider
 *
 * Wraps Ollama's embeddings API for generating text embeddings.
 * Works with local or remote Ollama servers.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'http://localhost:11434';
  }

  /**
   * Generate an embedding for the given text
   *
   * Note: Ollama doesn't require an API key, but the interface requires it.
   * The apiKey parameter is ignored for Ollama.
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'nomic-embed-text')
   * @param apiKey Ignored for Ollama (no API key required)
   * @returns The embedding result
   */
  async generateEmbedding(
    text: string,
    model: string,
    apiKey: string // Ignored for Ollama
  ): Promise<EmbeddingResult> {
    logger.debug('Generating Ollama embedding', {
      context: 'OllamaEmbeddingProvider.generateEmbedding',
      model,
      textLength: text.length,
      baseUrl: this.baseUrl,
    });

    // Ollama uses 'prompt' instead of 'input'
    const requestPayload = {
      model,
      prompt: text,
    };

    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error || response.statusText;
      logger.error('Ollama embedding failed', {
        context: 'OllamaEmbeddingProvider.generateEmbedding',
        status: response.status,
        error: errorMessage,
      });
      throw new Error(`Ollama embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const embedding = data.embedding;

    if (!embedding) {
      throw new Error('No embedding returned from Ollama');
    }

    logger.debug('Ollama embedding generated successfully', {
      context: 'OllamaEmbeddingProvider.generateEmbedding',
      model,
      dimensions: embedding.length,
    });

    return {
      embedding,
      model,
      dimensions: embedding.length,
    };
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * Note: Ollama doesn't have a native batch API, so this processes texts sequentially.
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey Ignored for Ollama
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(
    texts: string[],
    model: string,
    apiKey: string
  ): Promise<EmbeddingResult[]> {
    logger.debug('Generating batch Ollama embeddings', {
      context: 'OllamaEmbeddingProvider.generateBatchEmbeddings',
      model,
      count: texts.length,
    });

    const results: EmbeddingResult[] = [];

    for (const text of texts) {
      const result = await this.generateEmbedding(text, model, apiKey);
      results.push(result);
    }

    logger.debug('Ollama batch embeddings generated successfully', {
      context: 'OllamaEmbeddingProvider.generateBatchEmbeddings',
      model,
      count: results.length,
    });

    return results;
  }

  /**
   * Get available embedding models from Ollama
   *
   * @param apiKey Ignored for Ollama
   * @returns Array of model names that support embeddings
   */
  async getAvailableModels(apiKey?: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      // Return all models - Ollama doesn't distinguish embedding models in the API
      // Users need to know which models support embeddings
      const models = data.models?.map((m: { name: string }) => m.name) || [];

      return models;
    } catch (error) {
      logger.error('Failed to fetch Ollama models', {
        context: 'OllamaEmbeddingProvider.getAvailableModels',
        baseUrl: this.baseUrl,
      }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * Check if the Ollama server is available
   *
   * @returns True if the Ollama server is reachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
