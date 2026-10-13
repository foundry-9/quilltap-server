/**
 * Anchor Gate Probe — measurement only (memory-recall-and-housekeeping-fixes F2)
 *
 * Since the episodic spine, gate and stored embeddings carry an anchor line
 * (dates, entities). Hypothesis: two tellings of one fact on different days,
 * with different entity sets, now embed below the REINFORCE band, so
 * restatements land as INSERT / INSERT_RELATED rows instead of reinforcing.
 *
 * This probe takes a character's most recent rows (each one survived the gate
 * as a new row), and for each:
 *
 * - **anchored**: embeds it the way the gate did (summary + content + anchor
 *   line) and scores it against the anchored embeddings of OLDER rows — the
 *   ones the gate could have seen when this row was written.
 * - **anchor-free**: embeds it without the anchor line and scores it against
 *   anchor-free embeddings of the same older neighbours (the union of both
 *   searches' top-K, re-embedded on the fly).
 *
 * For each side it asks admission's own decider (`decideAdmission`, with the
 * thresholds from the settings façade) what it would do with the row against
 * those neighbours, and reports how many rows would fold (reinforce, absorb or
 * promote) and how many would be absorbed as near-duplicates. If anchor-free
 * folds are materially higher, admission should compare on anchor-free text.
 * Nothing is written: no rows, no vectors, no access stamps.
 *
 * Caveats: content may have gained `[+]` footnotes since the row was written,
 * and the store holds the row's CURRENT vector, so the anchored side is an
 * approximation of what the gate saw — the anchor-free side is computed the
 * same way, so the comparison between them is like for like.
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { memoryIndex, embeddingTextFor } from './index-store'
import { generateEmbeddingForUser, cosineSimilarity } from '@/lib/embedding/embedding-service'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { refreshMemoryTimeZone } from './time/calendar-refresh'
import { resolveMemorySettings } from './settings'
import { decideAdmission, type AdmissionAction, type AdmissionNeighbour } from './admission'

const logger = createServiceLogger('AnchorGateProbe')

/** Neighbours pulled from each search when looking for a row's best match. */
const PROBE_TOP_K = 5

export interface AnchorGateProbeRow {
  memoryId: string
  summary: string
  createdAt: string
  hasAnchorLine: boolean
  /** Best cosine against older rows, anchored text vs. anchored vectors. */
  anchoredBest: number | null
  anchoredBestId: string | null
  /** What admission would do with the row, anchored. */
  anchoredAction: AdmissionAction['kind'] | null
  /** Best cosine against older rows, anchor-free text on both sides. */
  anchorFreeBest: number | null
  anchorFreeBestId: string | null
  /** What admission would do with the row, anchor-free. */
  anchorFreeAction: AdmissionAction['kind'] | null
}

export interface AnchorGateProbeBand {
  /** Rows admission would fold into an older row (reinforce, absorb or promote). */
  reinforce: number
  /** Rows admission would absorb as near-duplicates (no new detail). */
  nearDuplicate: number
}

export interface AnchorGateProbeResult {
  characterId: string
  sampled: number
  /** Rows that actually carry an anchor line (only these can differ). */
  anchoredRows: number
  thresholds: { reinforce: number; nearDuplicate: number }
  anchored: AnchorGateProbeBand
  anchorFree: AnchorGateProbeBand
  /** Rows admission would insert anchored but fold anchor-free. */
  crossedOnlyWithoutAnchors: number
  embeddingsGenerated: number
  rows: AnchorGateProbeRow[]
}

export interface RunAnchorGateProbeInput {
  characterId: string
  userId: string
  /** How many of the character's most recent rows to probe (default 50, max 200). */
  limit?: number
  embeddingProfileId?: string
}

function hasAnchors(memory: Memory, timeZone: string): boolean {
  return (
    embeddingTextFor(memory, timeZone) !==
    embeddingTextFor({ summary: memory.summary, content: memory.content })
  )
}

export async function runAnchorGateProbe(input: RunAnchorGateProbeInput): Promise<AnchorGateProbeResult> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50))
  const repos = getRepositories()
  const sample = await repos.memories.findRecent(input.characterId, limit)
  const thresholds = (await resolveMemorySettings(input.userId)).admission
  // Anchor dates render on the instance's memory calendar, as the gate's do.
  const memoryTimeZone = await refreshMemoryTimeZone()

  // Neighbours are looked up by id across the whole corpus; createdAt decides
  // which ones the gate could have seen.
  const createdAtById = new Map<string, number>()
  const memoryCache = new Map<string, Memory>()
  for (const m of sample) {
    createdAtById.set(m.id, Date.parse(m.createdAt))
    memoryCache.set(m.id, m)
  }

  let embeddingsGenerated = 0
  const embed = async (text: string): Promise<Float32Array> => {
    embeddingsGenerated++
    const result = await generateEmbeddingForUser(text, input.userId, input.embeddingProfileId, {
      priority: 'background',
    })
    return result.embedding
  }

  const anchorFreeCache = new Map<string, Float32Array>()
  const anchorFreeEmbedding = async (memory: Memory): Promise<Float32Array> => {
    const cached = anchorFreeCache.get(memory.id)
    if (cached) return cached
    const vec = await embed(embeddingTextFor({ summary: memory.summary, content: memory.content }))
    anchorFreeCache.set(memory.id, vec)
    return vec
  }

  const loadMemories = async (ids: string[]): Promise<Map<string, Memory>> => {
    const missing = ids.filter(id => !memoryCache.has(id))
    if (missing.length > 0) {
      for (const m of await repos.memories.findByIds(missing)) {
        memoryCache.set(m.id, m)
        createdAtById.set(m.id, Date.parse(m.createdAt))
      }
    }
    return memoryCache
  }

  // Admission's own decision for a row against scored older neighbours.
  // (The probe does not follow superseded members to their digests; it
  // measures text against text.)
  const decide = (memory: Memory, scored: Array<{ id: string; cosine: number }>): AdmissionAction['kind'] => {
    const neighbours: AdmissionNeighbour[] = scored
      .map(({ id, cosine }) => ({ memory: memoryCache.get(id), cosine }))
      .filter((n): n is AdmissionNeighbour => n.memory !== undefined)
    return decideAdmission({
      candidate: {
        holderId: memory.characterId,
        aboutId: memory.aboutCharacterId,
        kind: memory.kind,
        source: memory.source,
        occurredAt: memory.occurredAt,
      },
      neighbours,
      thresholds,
    }).action.kind
  }
  const folds = (kind: AdmissionAction['kind'] | null): boolean =>
    kind === 'reinforce' || kind === 'absorb' || kind === 'promote-and-reinforce'

  const rows: AnchorGateProbeRow[] = []
  for (const memory of sample) {
    const createdMs = Date.parse(memory.createdAt)
    const anchored = hasAnchors(memory, memoryTimeZone)
    const row: AnchorGateProbeRow = {
      memoryId: memory.id,
      summary: memory.summary,
      createdAt: memory.createdAt,
      hasAnchorLine: anchored,
      anchoredBest: null,
      anchoredBestId: null,
      anchorFreeBest: null,
      anchorFreeBestId: null,
      anchorFreeAction: null,
      anchoredAction: null,
    }

    try {
      const anchoredVec = await embed(embeddingTextFor(memory, memoryTimeZone))
      const shape = await memoryIndex.shape(input.characterId, anchoredVec.length)
      if (shape.size > 0 && shape.matching === 0) {
        logger.warn('Probe embedding dimension does not match the store; skipping row', {
          memoryId: memory.id,
          probe: anchoredVec.length,
          store: shape.dominantDimensions,
        })
        rows.push(row)
        continue
      }
      const freeVec = anchored ? await anchorFreeEmbedding(memory) : anchoredVec

      // Over-fetch so filtering out self and newer rows still leaves K.
      const fetchK = PROBE_TOP_K * 4
      const anchoredHits = await memoryIndex.search(input.characterId, anchoredVec, { limit: fetchK, hotOnly: false })
      const freeHits = anchored
        ? await memoryIndex.search(input.characterId, freeVec, { limit: fetchK, hotOnly: false })
        : anchoredHits
      await loadMemories([...anchoredHits, ...freeHits].map(h => h.id))

      const isOlder = (id: string): boolean => {
        if (id === memory.id) return false
        const t = createdAtById.get(id)
        return t !== undefined && Number.isFinite(t) && t < createdMs
      }

      const olderAnchored = anchoredHits.filter(h => isOlder(h.id)).slice(0, PROBE_TOP_K)
      if (olderAnchored.length > 0) {
        row.anchoredBest = olderAnchored[0].score
        row.anchoredBestId = olderAnchored[0].id
      }
      row.anchoredAction = decide(memory, olderAnchored.map(h => ({ id: h.id, cosine: h.score })))

      // Anchor-free side: re-embed the union of both searches' older
      // neighbours without their anchor lines and score like for like.
      const neighbourIds = Array.from(
        new Set([...olderAnchored, ...freeHits.filter(h => isOlder(h.id)).slice(0, PROBE_TOP_K)].map(h => h.id)),
      )
      const anchorFreeScores: Array<{ id: string; cosine: number }> = []
      for (const id of neighbourIds) {
        const neighbour = memoryCache.get(id)
        if (!neighbour) continue
        const neighbourVec = hasAnchors(neighbour, memoryTimeZone)
          ? await anchorFreeEmbedding(neighbour)
          : neighbour.embedding && neighbour.embedding.length === freeVec.length
            ? neighbour.embedding
            : await anchorFreeEmbedding(neighbour)
        const score = cosineSimilarity(freeVec, neighbourVec)
        anchorFreeScores.push({ id, cosine: score })
        if (row.anchorFreeBest === null || score > row.anchorFreeBest) {
          row.anchorFreeBest = score
          row.anchorFreeBestId = id
        }
      }
      row.anchorFreeAction = decide(memory, anchorFreeScores)
    } catch (error) {
      logger.warn('Probe failed for row; continuing', {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    rows.push(row)
  }

  const band = (pick: (r: AnchorGateProbeRow) => AdmissionAction['kind'] | null): AnchorGateProbeBand => ({
    reinforce: rows.filter(r => folds(pick(r))).length,
    nearDuplicate: rows.filter(r => pick(r) === 'absorb').length,
  })

  const result: AnchorGateProbeResult = {
    characterId: input.characterId,
    sampled: sample.length,
    anchoredRows: rows.filter(r => r.hasAnchorLine).length,
    thresholds: { reinforce: thresholds.reinforce, nearDuplicate: thresholds.nearDuplicate },
    anchored: band(r => r.anchoredAction),
    anchorFree: band(r => r.anchorFreeAction),
    crossedOnlyWithoutAnchors: rows.filter(r => !folds(r.anchoredAction) && folds(r.anchorFreeAction)).length,
    embeddingsGenerated,
    rows,
  }

  logger.info('Anchor gate probe complete', {
    characterId: input.characterId,
    sampled: result.sampled,
    anchoredRows: result.anchoredRows,
    anchored: result.anchored,
    anchorFree: result.anchorFree,
    crossedOnlyWithoutAnchors: result.crossedOnlyWithoutAnchors,
    embeddingsGenerated,
  })
  return result
}
