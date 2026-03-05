/**
 * Help Search
 *
 * Runtime loader for the help documentation bundle.
 * Provides semantic search over help documents using pre-computed embeddings.
 */

import { gunzipSync } from 'node:zlib'
import { decode } from '@msgpack/msgpack'
import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { logger } from '@/lib/logger'
import type { HelpBundle, HelpDocument, HelpSearchResult } from './help-search.types'

/**
 * Help Search class
 *
 * Loads and searches the help documentation bundle.
 */
export class HelpSearch {
  private bundle: HelpBundle | null = null
  private loading: Promise<void> | null = null

  /**
   * Load the help bundle from a gzipped MessagePack buffer
   */
  async loadFromBuffer(compressed: Buffer | Uint8Array): Promise<void> {
    // Convert to Uint8Array for gunzip compatibility
    const compressedArray = compressed instanceof Uint8Array && !(compressed instanceof Buffer)
      ? compressed
      : new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.length)
    const decompressed = gunzipSync(compressedArray)

    // Convert Buffer to Uint8Array for msgpack decode
    const uint8Array = new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.length)
    this.bundle = decode(uint8Array) as HelpBundle

    logger.info('Help bundle loaded', {
      context: 'help-search',
      version: this.bundle.version,
      documentCount: this.bundle.documents.length,
      embeddingModel: this.bundle.embeddingModel,
      embeddingDimensions: this.bundle.embeddingDimensions,
    })
  }

  /**
   * Load the help bundle from a URL (for browser/fetch usage)
   */
  async loadFromUrl(url: string): Promise<void> {
    // Prevent multiple concurrent loads
    if (this.loading) {
      return this.loading
    }

    this.loading = (async () => {
      try {
        const response = await fetch(url)

        if (!response.ok) {
          throw new Error(`Failed to fetch help bundle: ${response.status} ${response.statusText}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        const compressed = Buffer.from(arrayBuffer)

        await this.loadFromBuffer(compressed)
      } finally {
        this.loading = null
      }
    })()

    return this.loading
  }

  /**
   * Check if the bundle is loaded
   */
  isLoaded(): boolean {
    return this.bundle !== null
  }

  /**
   * Get bundle metadata
   */
  getMetadata(): { version: string; generated: string; embeddingModel: string; embeddingDimensions: number; documentCount: number } | null {
    if (!this.bundle) return null

    return {
      version: this.bundle.version,
      generated: this.bundle.generated,
      embeddingModel: this.bundle.embeddingModel,
      embeddingDimensions: this.bundle.embeddingDimensions,
      documentCount: this.bundle.documents.length,
    }
  }

  /**
   * Search for documents similar to the query embedding
   *
   * @param queryEmbedding - The embedding vector for the search query
   * @param limit - Maximum number of results to return (default: 5)
   * @returns Array of search results sorted by similarity score (highest first)
   */
  search(queryEmbedding: number[], limit: number = 5): HelpSearchResult[] {
    if (!this.bundle) {
      logger.warn('Help bundle not loaded, cannot search', { context: 'help-search' })
      return []
    }

    // Validate embedding dimensions
    if (queryEmbedding.length !== this.bundle.embeddingDimensions) {
      logger.warn('Query embedding dimensions mismatch', {
        context: 'help-search',
        expected: this.bundle.embeddingDimensions,
        actual: queryEmbedding.length,
      })
      return []
    }

    // Calculate similarity scores for all documents
    const results: HelpSearchResult[] = this.bundle.documents.map(document => ({
      document,
      score: cosineSimilarity(queryEmbedding, document.embedding),
    }))

    // Sort by score descending and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Get a document by its ID
   */
  getDocument(id: string): HelpDocument | null {
    if (!this.bundle) {
      logger.warn('Help bundle not loaded, cannot get document', { context: 'help-search' })
      return null
    }

    return this.bundle.documents.find(doc => doc.id === id) || null
  }

  /**
   * Get all documents (without embeddings for lighter weight)
   */
  getAllDocuments(): Array<Omit<HelpDocument, 'embedding'>> {
    if (!this.bundle) {
      logger.warn('Help bundle not loaded, cannot get documents', { context: 'help-search' })
      return []
    }

    return this.bundle.documents.map(({ id, title, path, url, content }) => ({
      id,
      title,
      path,
      url,
      content,
    }))
  }

  /**
   * Get all document titles and paths for listing
   */
  listDocuments(): Array<{ id: string; title: string; path: string; url: string }> {
    if (!this.bundle) {
      return []
    }

    return this.bundle.documents.map(({ id, title, path, url }) => ({
      id,
      title,
      path,
      url,
    }))
  }
}

// Singleton instance for convenience
let helpSearchInstance: HelpSearch | null = null

/**
 * Get the singleton HelpSearch instance
 */
export function getHelpSearch(): HelpSearch {
  if (!helpSearchInstance) {
    helpSearchInstance = new HelpSearch()
  }
  return helpSearchInstance
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetHelpSearch(): void {
  helpSearchInstance = null
}
