/**
 * Stage 3 — hydrate: read the rows the pool names, in one batch, and apply the
 * row filters every path shares — tier (`includeCold`), exclusions, importance
 * (`reinforcedImportance`), source and subject (`aboutCharacterId`). The tool
 * path's literal-phrase boost lands here, on the relevance it gathered with.
 *
 * Also the one other read the pipeline makes: the one-hop neighbours of the
 * ranked hits, for related expansion ({@link hydrateNeighbours}).
 *
 * @module memory/recall/hydrate
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { Memory } from '@/lib/schemas/types'
import { applyLiteralBoost, containsLiteralPhrase } from '@/lib/embedding/literal-boost'
import { filterImportance } from '../scoring'
import { RELATED_EXPANSION } from './tags'
import type { Gathered } from './gather'
import { traceStage, type HydratedHit, type RecallCandidate, type RecallTrace } from './types'

/** The row filters. Every field is optional; absent means "no filter". */
export interface HydrateFilters {
  includeCold: boolean
  excludeIds?: ReadonlySet<string>
  minImportance?: number
  source?: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
  aboutCharacterId?: string
}

/** True when a row passes the filters. */
export function passesFilters(memory: Memory, filters: HydrateFilters): boolean {
  if (filters.excludeIds?.has(memory.id)) return false
  if (!filters.includeCold && memory.tier === 'cold') return false
  if (filters.minImportance !== undefined && filterImportance(memory) < filters.minImportance) return false
  if (filters.source && memory.source !== filters.source) return false
  if (filters.aboutCharacterId && memory.aboutCharacterId !== filters.aboutCharacterId) return false
  return true
}

/** Read the pool's rows and keep the ones that pass, in pool order. */
export async function hydrate(
  gathered: Gathered,
  filters: HydrateFilters,
  trace: RecallTrace = [],
  label?: string,
): Promise<HydratedHit[]> {
  const missing = gathered.hits.filter(h => !h.memory).map(h => h.id)
  const rows = missing.length > 0 ? await getRepositories().memories.findByIds(missing) : []
  const byId = new Map(rows.map(m => [m.id, m]))

  const out: HydratedHit[] = []
  let dropped = 0
  const literalPhrase = gathered.literalPhrase
  for (const hit of gathered.hits) {
    const memory = hit.memory ?? byId.get(hit.id)
    if (!memory || !passesFilters(memory, filters)) {
      dropped++
      continue
    }
    const literal = literalPhrase
      ? gathered.literalHitIds.has(memory.id) ||
        containsLiteralPhrase(memory.content, literalPhrase) ||
        containsLiteralPhrase(memory.summary, literalPhrase)
      : false
    out.push({
      memory,
      rawScore: hit.score,
      score: literal ? applyLiteralBoost(hit.score) : hit.score,
      usedEmbedding: gathered.strategy === 'vector',
    })
  }
  traceStage(trace, 'hydrate', { read: rows.length, kept: out.length, dropped }, label)
  return out
}

/**
 * The one-hop neighbours of the top `limit` ranked hits that are not already
 * in the pool: at most `RELATED_EXPANSION.maxPerHit` per seed and `maxTotal` in
 * all, read in one batch and filtered like the pool (plus the character
 * scope). `select` scores them.
 */
export async function hydrateNeighbours(
  ranked: readonly RecallCandidate[],
  limit: number,
  characterId: string,
  filters: HydrateFilters,
): Promise<Memory[]> {
  const inPool = new Set(ranked.map(r => r.memory.id))
  const neighbourIds: string[] = []
  const seen = new Set<string>()
  for (const seed of ranked.slice(0, limit)) {
    let fromSeed = 0
    for (const neighbourId of seed.memory.relatedMemoryIds ?? []) {
      if (neighbourIds.length >= RELATED_EXPANSION.maxTotal) break
      if (fromSeed >= RELATED_EXPANSION.maxPerHit) break
      if (inPool.has(neighbourId) || seen.has(neighbourId)) continue
      if (filters.excludeIds?.has(neighbourId)) continue
      seen.add(neighbourId)
      neighbourIds.push(neighbourId)
      fromSeed++
    }
    if (neighbourIds.length >= RELATED_EXPANSION.maxTotal) break
  }
  if (neighbourIds.length === 0) return []
  const rows = await getRepositories().memories.findByIds(neighbourIds)
  return rows.filter(m => m.characterId === characterId && passesFilters(m, { ...filters, aboutCharacterId: undefined }))
}
