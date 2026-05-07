/**
 * Mount Chunk In-Memory Cache
 *
 * Keeps the embedded chunks for each document mount point resident in
 * process memory so we don't re-decode thousands of Float32 BLOBs from
 * SQLCipher on every chat turn. The corpus is mostly static; chunks
 * change only when documents are re-indexed or deleted, so the cache is
 * a good fit here.
 *
 * Mirrors the shape of `VectorStoreManager` in `lib/embedding/vector-store.ts`:
 * a module-scoped Map keyed by mount point, populated lazily on first use,
 * explicitly invalidated by the embedding pipeline.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

/**
 * A single chunk with everything `searchDocumentChunks` needs — no further
 * DB round-trips required to render results.
 */
export interface CachedMountChunk {
  id: string
  mountPointId: string
  fileId: string
  chunkIndex: number
  headingContext: string | null
  content: string
  embedding: Float32Array
}

interface CacheEntry {
  chunks: CachedMountChunk[]
  loadedAt: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Load chunks for a single mount point from the repository and freeze them
 * into the cache shape.
 */
async function loadMountPoint(mountPointId: string): Promise<CachedMountChunk[]> {
  const repos = getRepositories()
  const chunks = await repos.docMountChunks.findAllWithEmbeddingsByMountPointIds([mountPointId])

  const cached: CachedMountChunk[] = chunks.map(chunk => ({
    id: chunk.id,
    mountPointId: chunk.mountPointId,
    fileId: chunk.fileId,
    chunkIndex: chunk.chunkIndex,
    headingContext: chunk.headingContext ?? null,
    content: chunk.content,
    // Zod transforms guarantee Float32Array, but guard against the
    // (impossible) legacy number[] shape in case a future schema change drifts.
    embedding: chunk.embedding instanceof Float32Array
      ? chunk.embedding
      : new Float32Array(chunk.embedding as unknown as ArrayLike<number>),
  }))

  return cached
}

/**
 * Return the cached chunks for a set of mount points, loading any that
 * aren't in the cache yet. Order of results is stable per mountPointId
 * but not guaranteed across mount points.
 */
export async function getChunksForMountPoints(mountPointIds: string[]): Promise<CachedMountChunk[]> {
  const results: CachedMountChunk[] = []
  for (const mountPointId of mountPointIds) {
    let entry = cache.get(mountPointId)
    if (!entry) {
      const chunks = await loadMountPoint(mountPointId)
      entry = { chunks, loadedAt: Date.now() }
      cache.set(mountPointId, entry)
    }
    results.push(...entry.chunks)
  }
  return results
}

/**
 * Drop the cache entry for a single mount point. Call after any embedding
 * write, chunk delete, or scan that changes the set of chunks for that
 * mount point.
 */
export function invalidateMountPoint(mountPointId: string): void {
  if (cache.delete(mountPointId)) {
  }
}

/**
 * Nuke the entire cache. Used when the embedding profile changes and all
 * chunks are going to be re-embedded.
 */
export function invalidateAll(): void {
  const size = cache.size
  cache.clear()
  if (size > 0) {
  }
}

/**
 * Stats for diagnostic endpoints.
 */
export function getStats(): { mountPoints: number; totalChunks: number } {
  let totalChunks = 0
  for (const entry of cache.values()) {
    totalChunks += entry.chunks.length
  }
  return { mountPoints: cache.size, totalChunks }
}
