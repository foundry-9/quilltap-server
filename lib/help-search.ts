/**
 * Help Search
 *
 * Runtime help documentation search using database-stored docs.
 * Help documents are synced from disk to the database and embedded
 * at runtime using the user's chosen embedding profile.
 */

import { cosineSimilarity } from '@/lib/embedding/embedding-service'
import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { ensureHelpDocsSynced } from '@/lib/help/help-doc-sync'
import type { HelpDocument, HelpDocumentWithEmbedding, HelpSearchResult } from './help-search.types'

/**
 * Help Search class
 *
 * Loads and searches help documentation from the database.
 */
export class HelpSearch {
  private documents: HelpDocument[] | null = null
  private loading: Promise<void> | null = null

  /**
   * Load help documents from the database.
   * Ensures docs are synced from disk first if the collection is empty.
   */
  async loadFromDatabase(): Promise<void> {
    if (this.loading) {
      return this.loading
    }

    this.loading = (async () => {
      try {
        // Ensure docs are synced from disk to DB
        await ensureHelpDocsSynced()

        const repos = getRepositories()
        const allDocs = await repos.helpDocs.findAll()

        this.documents = allDocs.map(doc => ({
          id: doc.id,
          title: doc.title,
          path: doc.path,
          url: doc.url,
          content: doc.content,
        }))

        logger.info('Help documents loaded from database', {
          context: 'help-search',
          documentCount: this.documents.length,
        })
      } finally {
        this.loading = null
      }
    })()

    return this.loading
  }

  /**
   * Check if documents are loaded
   */
  isLoaded(): boolean {
    return this.documents !== null
  }

  /**
   * Ensure documents are loaded (lazy initialization)
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.documents) {
      await this.loadFromDatabase()
    }
  }

  /**
   * Search for documents similar to the query embedding.
   * Loads embedded docs from the database and computes cosine similarity.
   *
   * @param queryEmbedding - The embedding vector for the search query
   * @param limit - Maximum number of results to return (default: 5)
   * @returns Array of search results sorted by similarity score (highest first)
   */
  async search(queryEmbedding: Float32Array, limit: number = 5): Promise<HelpSearchResult[]> {
    const repos = getRepositories()
    const embeddedDocs = await repos.helpDocs.findAllWithEmbeddings()

    if (embeddedDocs.length === 0) {
      logger.warn('No embedded help docs available for search', { context: 'help-search' })
      return []
    }

    // Calculate similarity scores
    const results: HelpSearchResult[] = []

    for (const doc of embeddedDocs) {
      if (!doc.embedding || doc.embedding.length === 0) {
        continue
      }

      // Validate dimension match
      if (queryEmbedding.length !== doc.embedding.length) {
        continue
      }

      results.push({
        document: {
          id: doc.id,
          title: doc.title,
          path: doc.path,
          url: doc.url,
          content: doc.content,
        },
        score: cosineSimilarity(queryEmbedding, doc.embedding),
      })
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Get a document by its ID
   */
  async getDocument(id: string): Promise<HelpDocument | null> {
    await this.ensureLoaded()

    if (!this.documents) {
      return null
    }

    return this.documents.find(doc => doc.id === id) || null
  }

  /**
   * Get all documents (without embeddings for lighter weight)
   */
  async getAllDocuments(): Promise<HelpDocument[]> {
    await this.ensureLoaded()
    return this.documents || []
  }

  /**
   * Get all document titles and paths for listing
   */
  async listDocuments(): Promise<Array<{ id: string; title: string; path: string; url: string }>> {
    await this.ensureLoaded()

    if (!this.documents) {
      return []
    }

    return this.documents.map(({ id, title, path, url }) => ({
      id,
      title,
      path,
      url,
    }))
  }

  /**
   * Invalidate the cached documents (call after sync or re-embedding)
   */
  invalidate(): void {
    this.documents = null
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
