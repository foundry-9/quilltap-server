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
import {
  applyLiteralBoost,
  containsLiteralPhrase,
  getLiteralPhrase,
} from '@/lib/embedding/literal-boost'
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
  /**
   * Restrict results to chunks whose file's `relativePath` starts with this
   * prefix (case-insensitive). Used by the per-character knowledge source
   * to scope to `Knowledge/` inside a vault. When set, the search pulls a
   * larger candidate pool than `limit` so prefix filtering doesn't starve
   * the result.
   */
  pathPrefix?: string
  /**
   * Original query text. Required when `applyLiteralPhraseBoost` is set —
   * the embedding alone can't be substring-matched against chunk content.
   */
  query?: string
  /**
   * When true and the trimmed query is ≥ LITERAL_BOOST_MIN_PHRASE_LENGTH
   * characters, items whose chunk content contains the query verbatim
   * (case-insensitive) get their cosine score lifted toward 1.0 by
   * `literalBoostFraction` (default 0.5) before minScore filtering and
   * slicing. Used by the unified `search` tool and the per-turn knowledge
   * injector.
   */
  applyLiteralPhraseBoost?: boolean
  /**
   * Fraction of the distance from the cosine score to 1.0 that a literal
   * hit lifts the score by. Defaults to 0.5 — the legacy halfway boost.
   * The knowledge sources pass smaller fractions for project/global tiers
   * so personal-vault hits outrank shared-pool hits at equal cosine.
   */
  literalBoostFraction?: number
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

  // Determine which mount point IDs to search
  let mountPointIds: string[] | undefined = options.mountPointIds

  if (!mountPointIds && options.projectId) {
    // Look up mount points linked to this project
    const links = await repos.projectDocMountLinks.findByProjectId(options.projectId)
    mountPointIds = links.map(l => l.mountPointId)

    if (mountPointIds.length === 0) {
      return []
    }
  }

  if (!mountPointIds) {
    // Search all enabled mount points
    const enabledMounts = await repos.docMountPoints.findEnabled()
    mountPointIds = enabledMounts.map(mp => mp.id)
  }

  if (mountPointIds.length === 0) {
    return []
  }

  // Load all embedded chunks for the target mount points (served from the
  // in-memory cache on repeat queries).
  const allChunks = await getChunksForMountPoints(mountPointIds)

  if (allChunks.length === 0) {
    return []
  }

  // Pre-flight dimension guard: if the corpus and the query have drifted apart
  // (e.g. the embedding profile's truncateToDimensions changed but the corpus
  // hasn't been re-applied), surface a clear error before we iterate 65k rows
  // and let cosineSimilarity throw on the first one.
  const sampleStored = allChunks[0].embedding
  assertEmbeddingDimensionsMatch(queryEmbedding, sampleStored, 'document chunk search')

  // pathPrefix is a hard constraint, not a soft signal — apply it to the
  // chunk universe *before* scoring, not as a post-filter on a top-K pool.
  // (A post-filter starves results when the prefix matches a small fraction
  // of files, e.g. a single Knowledge/ file in a vault of 50 wardrobe items.)
  const pathPrefix = options.pathPrefix
  const lowerPrefix = pathPrefix ? pathPrefix.toLowerCase() : null

  let chunksInScope = allChunks
  if (lowerPrefix) {
    // After the content/link split chunks key by linkId — collect link ids
    // whose relativePath matches the prefix.
    const allowedLinkIds = new Set<string>()
    for (const mpId of mountPointIds) {
      const links = await repos.docMountFileLinks.findByMountPointId(mpId)
      for (const link of links) {
        if (link.relativePath.toLowerCase().startsWith(lowerPrefix)) {
          allowedLinkIds.add(link.id)
        }
      }
    }
    if (allowedLinkIds.size === 0) {
      logger.debug('Document search found no files matching pathPrefix', {
        context: 'document-search',
        pathPrefix,
        mountPointCount: mountPointIds.length,
      })
      return []
    }
    chunksInScope = allChunks.filter(c => allowedLinkIds.has(c.linkId))
    if (chunksInScope.length === 0) {
      logger.debug('Document search: pathPrefix files have no embedded chunks yet', {
        context: 'document-search',
        pathPrefix,
        allowedFileCount: allowedLinkIds.size,
      })
      return []
    }
  }

  // Compute cosine similarity (dot product — vectors are unit-length) for
  // each in-scope chunk. If literal-boost is on, lift the score of any chunk
  // whose content contains the trimmed query verbatim before applying the
  // minScore filter and the limit slice — that way a buried exact match
  // can't be silently outranked or sliced off.
  const literalPhrase = options.applyLiteralPhraseBoost
    ? getLiteralPhrase(options.query)
    : null

  const literalBoostFraction = options.literalBoostFraction ?? 0.5
  let literalHitCount = 0
  const scoredAll = chunksInScope.map(chunk => {
    const rawScore = cosineSimilarity(queryEmbedding, chunk.embedding)
    const literalHit = literalPhrase
      ? containsLiteralPhrase(chunk.content, literalPhrase)
      : false
    if (literalHit) literalHitCount++
    return {
      chunk,
      score: literalHit ? applyLiteralBoost(rawScore, literalBoostFraction) : rawScore,
      literalHit,
    }
  })

  const scored = scoredAll
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (scored.length === 0) {
    return []
  }

  // Build metadata maps for mount points and files (from the surviving rows
  // only — no need to look up files we won't render).
  const mountPointMap = new Map<string, string>()
  const mountPoints = await repos.docMountPoints.findAll()
  for (const mp of mountPoints) {
    mountPointMap.set(mp.id, mp.name)
  }

  // Look up display metadata by linkId. Each surviving chunk traces back to
  // a single link row, which carries fileName + relativePath after the
  // content/link split.
  const linkIds = new Set(scored.map(s => s.chunk.linkId))
  const fileMap = new Map<string, { fileName: string; relativePath: string; fileId: string }>()
  for (const linkId of linkIds) {
    const link = await repos.docMountFileLinks.findByIdWithContent(linkId)
    if (link) {
      fileMap.set(linkId, {
        fileName: link.fileName,
        relativePath: link.relativePath,
        fileId: link.fileId,
      })
    }
  }

  const finalScored = scored

  if (lowerPrefix) {
    logger.debug('Document search applied pathPrefix filter', {
      context: 'document-search',
      pathPrefix,
      inScopeChunkCount: chunksInScope.length,
      returned: finalScored.length,
    })
  }

  if (literalPhrase) {
    logger.debug('Document search applied literal-phrase boost', {
      context: 'document-search',
      phraseLength: literalPhrase.length,
      literalHitCount,
      returned: finalScored.length,
    })
  }

  const results: DocumentSearchResult[] = finalScored.map(({ chunk, score }) => {
    const fileInfo = fileMap.get(chunk.linkId)
    return {
      chunkId: chunk.id,
      mountPointId: chunk.mountPointId,
      mountPointName: mountPointMap.get(chunk.mountPointId) || 'Unknown',
      fileId: fileInfo?.fileId || chunk.linkId,
      fileName: fileInfo?.fileName || 'Unknown',
      relativePath: fileInfo?.relativePath || '',
      chunkIndex: chunk.chunkIndex,
      headingContext: chunk.headingContext,
      content: chunk.content,
      score,
    }
  })

  return results
}
