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
 * Reads only. Runs in the parent, where admission does.
 *
 * @module memory/admission/neighbours
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { memoryIndex } from '../index-store'
import type { AdmissionNeighbour } from './types'

const log = logger.child({ module: 'memory:admission:neighbours' })

/** Live neighbours the decider is shown. */
export const ADMISSION_TOP_K = 5
/** Widest search admission will make to see past orphan vectors. */
const ADMISSION_MAX_SEARCH_K = ADMISSION_TOP_K * 4
/** Longest supersession chain followed to a live digest. */
const MAX_DIGEST_HOPS = 3

export interface GatheredNeighbours {
  neighbours: AdmissionNeighbour[]
  orphanIds: string[]
  searchedK: number
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
export async function gatherNeighbours(characterId: string, embedding: Float32Array): Promise<GatheredNeighbours> {
  const repos = getRepositories()
  let k = ADMISSION_TOP_K
  let hits = await memoryIndex.search(characterId, embedding, { limit: k, hotOnly: false })
  let rows = new Map<string, Memory>()
  for (;;) {
    const ids = hits.map((h) => h.id)
    const found = ids.length > 0 ? await repos.memories.findByIds(ids) : []
    rows = new Map(found.map((m) => [m.id, m]))
    const live = hits.filter((h) => rows.has(h.id)).length
    const exhausted = hits.length < k
    if (live >= ADMISSION_TOP_K || exhausted || k >= ADMISSION_MAX_SEARCH_K) break
    k = Math.min(ADMISSION_MAX_SEARCH_K, k + (ADMISSION_TOP_K - live))
    hits = await memoryIndex.search(characterId, embedding, { limit: k, hotOnly: false })
  }

  const orphanIds = hits.filter((h) => !rows.has(h.id)).map((h) => h.id)
  if (orphanIds.length > 0) {
    log.warn('Vector index holds entries with no memory row; ignoring them', { characterId, orphanIds, searchedK: k })
  }

  const byId = new Map<string, AdmissionNeighbour>()
  for (const hit of hits.filter((h) => rows.has(h.id)).slice(0, ADMISSION_TOP_K)) {
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
  })
  return { neighbours, orphanIds, searchedK: k }
}
