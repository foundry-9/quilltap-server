/**
 * Gather a candidate's neighbours for the decider: search the character's
 * index (both tiers), keep live rows, and replace each cold member a digest
 * supersedes with that digest.
 *
 * A vector whose row is gone (an orphan) must not stand at rank 1: with no row
 * behind it a live second match was never considered (bug 200). The search
 * widens past orphans so they cannot crowd live neighbours out of the top K.
 * Orphans are not pruned here; `retireMemories` owns deletion.
 *
 * When some stored vectors cannot be compared with the candidate's (their
 * length differs — a vocabulary refit or a profile switch is mid-reindex, or
 * the cache is stale), the vector search is blind to those rows and every
 * candidate would insert (bug 237). Admission then drops the cache once (the
 * rows may already be right) and, if rows still differ, finds likely
 * neighbours among them by word match and scores those few by embedding their
 * stored text with the candidate's profile.
 *
 * Reads only. Runs in the parent, where admission does.
 *
 * @module memory/admission/neighbours
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { cosineSimilarity, generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { refreshMemoryTimeZone } from '../time/calendar-refresh'
import { memoryIndex, embeddingTextFor } from '../index-store'
import type { AdmissionNeighbour } from './types'

const log = logger.child({ module: 'memory:admission:neighbours' })

/** Live neighbours the decider is shown. */
export const ADMISSION_TOP_K = 5
/** Widest search admission will make to see past orphan vectors. */
const ADMISSION_MAX_SEARCH_K = ADMISSION_TOP_K * 4
/** Longest supersession chain followed to a live digest. */
const MAX_DIGEST_HOPS = 3
/** Words of the candidate's text the unindexed fallback searches for. */
const FALLBACK_MAX_WORDS = 6
/** Shortest word the unindexed fallback searches for. */
const FALLBACK_MIN_WORD_LENGTH = 4

export interface GatheredNeighbours {
  neighbours: AdmissionNeighbour[]
  orphanIds: string[]
  searchedK: number
  /** Neighbours scored by re-embedding rows the index could not compare (bug 237). */
  reembedded?: number
}

/**
 * What the unindexed fallback needs: the candidate's text (to find likely
 * neighbours by word) and the user whose embedding profile scores them.
 */
export interface NeighbourProbe {
  text: string
  userId: string
}

interface ScoredHit {
  id: string
  score: number
}

/**
 * Make sure the index can compare the candidate with every row. A cache whose
 * vector lengths differ from the query's may only be stale: drop it once and
 * read the rows again. Returns how many rows still cannot be compared.
 */
async function unscorableRowCount(characterId: string, queryDimensions: number): Promise<number> {
  let shape = await memoryIndex.shape(characterId, queryDimensions)
  if (shape.size === 0 || shape.matching === shape.size) return 0
  memoryIndex.reload(characterId)
  shape = await memoryIndex.shape(characterId, queryDimensions)
  const unscorable = shape.size - shape.matching
  if (unscorable > 0) {
    log.warn('Admission index cannot compare some rows with the candidate; matching them by text', {
      characterId,
      queryDimensions,
      dominantDimensions: shape.dominantDimensions,
      unscorable,
      size: shape.size,
    })
  } else {
    log.debug('Admission index was stale; reloaded it from the rows', { characterId, queryDimensions })
  }
  return unscorable
}

function fallbackWords(text: string): string[] {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= FALLBACK_MIN_WORD_LENGTH),
  )
  // Longer words are the more distinctive ones.
  return [...words].sort((a, b) => b.length - a.length).slice(0, FALLBACK_MAX_WORDS)
}

/**
 * Likely neighbours among the rows the index cannot compare, best first:
 * rows sharing the most words with the candidate, each scored by embedding
 * its stored text with the candidate's profile. Embedding failures cost that
 * row alone.
 */
async function unindexedNeighbourHits(
  characterId: string,
  embedding: Float32Array,
  probe: NeighbourProbe,
  skip: ReadonlySet<string>,
): Promise<{ hits: ScoredHit[]; rows: Memory[] }> {
  const comparable = new Set(
    (await memoryIndex.entries(characterId))
      .filter((e) => e.embedding.length === embedding.length)
      .map((e) => e.id),
  )
  const repos = getRepositories()
  const overlap = new Map<string, { memory: Memory; words: number }>()
  for (const word of fallbackWords(probe.text)) {
    for (const memory of await repos.memories.searchByContent(characterId, word)) {
      if (comparable.has(memory.id) || skip.has(memory.id)) continue
      const prior = overlap.get(memory.id)
      overlap.set(memory.id, { memory, words: (prior?.words ?? 0) + 1 })
    }
  }
  const picked = [...overlap.values()]
    .sort((a, b) => b.words - a.words)
    .slice(0, ADMISSION_TOP_K)
    .map((o) => o.memory)
  if (picked.length === 0) return { hits: [], rows: [] }

  const timeZone = await refreshMemoryTimeZone()
  const hits: ScoredHit[] = []
  const rows: Memory[] = []
  for (const memory of picked) {
    try {
      const { embedding: fresh } = await generateEmbeddingForUser(
        embeddingTextFor(memory, timeZone),
        probe.userId,
        undefined,
        { priority: 'background' },
      )
      if (fresh.length !== embedding.length) continue
      hits.push({ id: memory.id, score: cosineSimilarity(embedding, fresh) })
      rows.push(memory)
    } catch (error) {
      log.debug('Could not re-embed an unindexed neighbour; skipping it', {
        characterId,
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  log.debug('Scored unindexed admission neighbours by re-embedding', {
    characterId,
    candidates: overlap.size,
    scored: hits.length,
  })
  return { hits, rows }
}

/**
 * Follow a cold member's `supersededById` (up to {@link MAX_DIGEST_HOPS}) to the
 * digest that replaced it. A missing digest leaves the row as it is, marked
 * `danglingDigest`, so the decider treats it as a cold row nothing supersedes.
 */
async function resolveDigest(memory: Memory): Promise<{ memory: Memory; via?: string; danglingDigest?: boolean }> {
  if (memory.tier !== 'cold' || !memory.supersededById) return { memory }
  const repos = getRepositories()
  let current = memory
  for (let hop = 0; hop < MAX_DIGEST_HOPS && current.tier === 'cold' && current.supersededById; hop++) {
    const [digest] = await repos.memories.findByIds([current.supersededById])
    if (!digest) {
      log.debug('Superseding digest missing; the cold row stands for itself', {
        memoryId: current.id,
        supersededById: current.supersededById,
      })
      return current === memory
        ? { memory: current, danglingDigest: true }
        : { memory: current, via: memory.id, danglingDigest: true }
    }
    current = digest
  }
  return current === memory ? { memory } : { memory: current, via: memory.id }
}

/**
 * The candidate's neighbours, best first, each row once (several members of
 * one cluster collapse onto their digest at the best cosine).
 */
export async function gatherNeighbours(
  characterId: string,
  embedding: Float32Array,
  opts: { exclude?: ReadonlySet<string>; probe?: NeighbourProbe } = {},
): Promise<GatheredNeighbours> {
  const repos = getRepositories()
  const exclude = opts.exclude
  const unscorable = await unscorableRowCount(characterId, embedding.length)
  // `exclude` (the dry run's rows a regenerate would retire) is searched past,
  // as if those rows were already gone.
  const search = async (limit: number) => {
    const found = await memoryIndex.search(characterId, embedding, { limit, hotOnly: false })
    return { exhausted: found.length < limit, hits: exclude ? found.filter((h) => !exclude.has(h.id)) : found }
  }
  let k = ADMISSION_TOP_K
  let { hits, exhausted } = await search(k)
  let rows = new Map<string, Memory>()
  for (;;) {
    const ids = hits.map((h) => h.id)
    const found = ids.length > 0 ? await repos.memories.findByIds(ids) : []
    rows = new Map(found.map((m) => [m.id, m]))
    const live = hits.filter((h) => rows.has(h.id)).length
    if (live >= ADMISSION_TOP_K || exhausted || k >= ADMISSION_MAX_SEARCH_K) break
    k = Math.min(ADMISSION_MAX_SEARCH_K, k + (ADMISSION_TOP_K - live))
    ;({ hits, exhausted } = await search(k))
  }

  const orphanIds = hits.filter((h) => !rows.has(h.id)).map((h) => h.id)
  if (orphanIds.length > 0) {
    log.warn('Vector index holds entries with no memory row; ignoring them', { characterId, orphanIds, searchedK: k })
  }

  let scored: ScoredHit[] = hits.filter((h) => rows.has(h.id))
  let reembedded = 0
  if (unscorable > 0 && opts.probe) {
    const extra = await unindexedNeighbourHits(characterId, embedding, opts.probe, new Set([...scored.map((h) => h.id), ...(exclude ?? [])]))
    for (const memory of extra.rows) rows.set(memory.id, memory)
    reembedded = extra.hits.length
    scored = [...scored, ...extra.hits].sort((a, b) => b.score - a.score)
  }

  const byId = new Map<string, AdmissionNeighbour>()
  for (const hit of scored.slice(0, ADMISSION_TOP_K)) {
    const resolved = await resolveDigest(rows.get(hit.id)!)
    const prior = byId.get(resolved.memory.id)
    if (prior && prior.cosine >= hit.score) continue
    byId.set(resolved.memory.id, {
      memory: resolved.memory,
      cosine: hit.score,
      ...(resolved.via ? { via: resolved.via } : {}),
      ...(resolved.danglingDigest ? { danglingDigest: true } : {}),
    })
  }
  const neighbours = Array.from(byId.values()).sort((a, b) => b.cosine - a.cosine)
  log.debug('Gathered admission neighbours', {
    characterId,
    neighbours: neighbours.length,
    redirected: neighbours.filter((n) => n.via).length,
    orphans: orphanIds.length,
    searchedK: k,
    reembedded,
  })
  return { neighbours, orphanIds, searchedK: k, ...(reembedded > 0 ? { reembedded } : {}) }
}
