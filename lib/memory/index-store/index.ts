/**
 * The memory index: the only writer of `memories.embedding` / `memories.tier`
 * and the only reader of the in-process vector cache. See `memory-index.ts`.
 *
 * @module memory/index-store
 */

export {
  memoryIndex,
  type MemoryIndex,
  type MemoryIndexEntry,
  type MemoryIndexUpsert,
  type MemoryIndexSearchOptions,
  type MemoryIndexShape,
  type MemoryIndexHit,
  type MemoryIndexEntryView,
} from './memory-index'
export { embeddingTextFor, type EmbeddingTextSource } from './embedding-text'
