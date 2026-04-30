/**
 * Document Mount Chunk Search
 * Project Scriptorium Phase 3.2
 *
 * Semantic search across document mount chunks using cosine similarity
 * on pre-computed embeddings. Follows the same pattern as conversation-search.ts.
 *
 * @module mount-index/document-search
 */

import { assertEmbeddingDimensionsMatch, cosineSimilarity } from '@/lib/embedding/embedding-service'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { getChunksForMountPoints } from './mount-chunk-cache'

const logger = createServiceLogger('DocumentSearch')

export interface DocumentSearchResult {
  chunkId: string
  mountPointId: string
  mountPointName: string
  fileId: string
  fileName: string
  relativePath: string
  chunkIndex: number
  headingContext: string | null
  content: string
  score: number
}

export interface DocumentSearchOptions {
  /** Scope to a specific project's linked mount points */
  projectId?: string
  /** Scope to specific mount point IDs */
  mountPointIds?: string[]
  /** Maximum results to return */
  limit?: number
  /** Minimum cosine similarity score */
  minScore?: number
}

/**
 * Search document mount chunks by semantic similarity.
 *
 * Optionally scoped to a project's linked mount points or specific mount point IDs.
 * Loads embedded chunks, computes cosine similarity against the query embedding,
 * and returns ranked results with file metadata.
 */
export async function searchDocumentChunks(
  queryEmbedding: Float32Array,
  options: DocumentSearchOptions = {}
): Promise<DocumentSearchResult[]> {
  const repos = getRepositories()
  const limit = options.limit || 10
  const minScore = options.minScore || 0.3

  logger.debug('Searching document mount chunks', {
    projectId: options.projectId,
    mountPointIds: options.mountPointIds,
    limit,
    minScore,
  })

  // Determine which mount point IDs to search
  let mountPointIds: string[] | undefined = options.mountPointIds

  if (!mountPointIds && options.projectId) {
    // Look up mount points linked to this project
    const links = await repos.projectDocMountLinks.findByProjectId(options.projectId)
    mountPointIds = links.map(l => l.mountPointId)

    if (mountPointIds.length === 0) {
      logger.debug('Project has no linked mount points', { projectId: options.projectId })
      return []
    }
  }

  if (!mountPointIds) {
    // Search all enabled mount points
    const enabledMounts = await repos.docMountPoints.findEnabled()
    mountPointIds = enabledMounts.map(mp => mp.id)
  }

  if (mountPointIds.length === 0) {
    logger.debug('No mount points to search')
    return []
  }

  // Load all embedded chunks for the target mount points (served from the
  // in-memory cache on repeat queries).
  const allChunks = await getChunksForMountPoints(mountPointIds)

  if (allChunks.length === 0) {
    logger.debug('No embedded document chunks found', { mountPointIds })
    return []
  }

  logger.debug('Loaded embedded document chunks for search', { chunkCount: allChunks.length })

  // Pre-flight dimension guard: if the corpus and the query have drifted apart
  // (e.g. the embedding profile's truncateToDimensions changed but the corpus
  // hasn't been re-applied), surface a clear error before we iterate 65k rows
  // and let cosineSimilarity throw on the first one.
  const sampleStored = allChunks[0].embedding
  assertEmbeddingDimensionsMatch(queryEmbedding, sampleStored, 'document chunk search')

  // Compute cosine similarity (dot product — vectors are unit-length) for each chunk
  const scored = allChunks
    .map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (scored.length === 0) {
    logger.debug('No document chunks above minimum score', { minScore })
    return []
  }

  // Build metadata maps for mount points and files
  const mountPointMap = new Map<string, string>()
  const mountPoints = await repos.docMountPoints.findAll()
  for (const mp of mountPoints) {
    mountPointMap.set(mp.id, mp.name)
  }

  // Collect unique file IDs from results
  const fileIds = new Set(scored.map(s => s.chunk.fileId))
  const fileMap = new Map<string, { fileName: string; relativePath: string }>()
  for (const fileId of fileIds) {
    const file = await repos.docMountFiles.findById(fileId)
    if (file) {
      fileMap.set(file.id, {
        fileName: file.fileName,
        relativePath: file.relativePath,
      })
    }
  }

  const results: DocumentSearchResult[] = scored.map(({ chunk, score }) => {
    const fileInfo = fileMap.get(chunk.fileId)
    return {
      chunkId: chunk.id,
      mountPointId: chunk.mountPointId,
      mountPointName: mountPointMap.get(chunk.mountPointId) || 'Unknown',
      fileId: chunk.fileId,
      fileName: fileInfo?.fileName || 'Unknown',
      relativePath: fileInfo?.relativePath || '',
      chunkIndex: chunk.chunkIndex,
      headingContext: chunk.headingContext,
      content: chunk.content,
      score,
    }
  })

  logger.debug('Document chunk search completed', {
    resultsCount: results.length,
    topScore: results[0]?.score,
  })

  return results
}
