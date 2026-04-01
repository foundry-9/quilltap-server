/**
 * OpenAI Embedding Provider Implementation
 *
 * Provides text embedding functionality using OpenAI's embeddings API.
 * Supports text-embedding-3-small, text-embedding-3-large, and text-embedding-ada-002 models.
 */

import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';
import type { EmbeddingProvider, EmbeddingResult, EmbeddingOptions } from './types';

const logger = createPluginLogger('qtap-plugin-openai');

/**
 * OpenAI Embedding Provider
 *
 * Wraps OpenAI's embeddings API for generating text embeddings.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || 'https://api.openai.com/v1';
  }

  /**
   * Generate an embedding for the given text
   *
   * @param text The text to embed
   * @param model The model to use (e.g., 'text-embedding-3-small')
   * @param apiKey The OpenAI API key
   * @param options Optional configuration (dimensions)
   * @returns The embedding result
   */
  async generateEmbedding(
    text: string,
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult> {
    const requestPayload: Record<string, unknown> = {
      model,
      input: text,
    };

    // Only include dimensions if specified (not all models support it)
    if (options?.dimensions) {
      requestPayload.dimensions = options.dimensions;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error?.message || response.statusText;
      logger.error('OpenAI embedding failed', {
        context: 'OpenAIEmbeddingProvider.generateEmbedding',
        status: response.status,
        error: errorMessage,
      });
      throw new Error(`OpenAI embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;

    return {
      embedding,
      model,
      dimensions: embedding.length,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * @param texts Array of texts to embed
   * @param model The model to use
   * @param apiKey The OpenAI API key
   * @param options Optional configuration
   * @returns Array of embedding results
   */
  async generateBatchEmbeddings(
    texts: string[],
    model: string,
    apiKey: string,
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult[]> {
    const requestPayload: Record<string, unknown> = {
      model,
      input: texts,
    };

    if (options?.dimensions) {
      requestPayload.dimensions = options.dimensions;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': getQuilltapUserAgent(),
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const errorMessage = error.error?.message || response.statusText;
      logger.error('OpenAI batch embedding failed', {
        context: 'OpenAIEmbeddingProvider.generateBatchEmbeddings',
        status: response.status,
        error: errorMessage,
      });
      throw new Error(`OpenAI batch embedding failed: ${errorMessage}`);
    }

    const data = await response.json();
    const results: EmbeddingResult[] = [];

    for (const item of data.data) {
      results.push({
        embedding: item.embedding,
        model,
        dimensions: item.embedding.length,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
      });
    }

    return results;
  }

  /**
   * Get available embedding models from OpenAI
   *
   * @param apiKey The OpenAI API key
   * @returns Array of embedding model IDs
   */
  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': getQuilltapUserAgent(),
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      // Filter to only embedding models
      const embeddingModels = data.data
        .filter((m: { id: string }) => m.id.includes('embedding'))
        .map((m: { id: string }) => m.id);

      return embeddingModels;
    } catch (error) {
      logger.error('Failed to fetch OpenAI embedding models', {
        context: 'OpenAIEmbeddingProvider.getAvailableModels',
      }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * Check if the provider is available
   *
   * @param apiKey The API key to validate
   * @returns True if the provider is ready to use
   */
  async isAvailable(apiKey?: string): Promise<boolean> {
    if (!apiKey) {
      return false;
    }

    try {
      const models = await this.getAvailableModels(apiKey);
      return models.length > 0;
    } catch {
      return false;
    }
  }
}
