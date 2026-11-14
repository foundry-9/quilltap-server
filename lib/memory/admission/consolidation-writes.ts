/**
 * Consolidation's writes, as deltas, in the parent (refactor 4.13, A9).
 *
 * A maintenance run reads the corpus once, plans every digest
 * (`consolidation-plan.ts`, pure), embeds, and only then writes — so whatever
 * admission did to those rows in between (a reinforcement, a new link, a
 * retirement) used to be overwritten by absolute counts, links and member
 * lists computed from the snapshot. This writer is the remedy, and it follows
 * the rule every other writer of memory rows keeps:
 *
 *  - **Parent only, under admission's lock.** The job child reaches it over
 *    host-RPC (`applyConsolidation`). The lock is taken per write batch — one
 *    cluster's digests, its members and its contradictions — never for the
 *    whole run, so a turn's memory writes wait on one batch at most.
 *  - **Re-read, then decide.** A batch's rows are read again inside the lock.
 *    A digest is written only from members that all still stand (the row is
 *    there, still this holder's, still AUTO, not a keystone, not superseded
 *    elsewhere), and an existing digest is revised only when its text is the
 *    text the model revised; otherwise the batch is skipped as **stale**,
 *    nothing of it is written, and its rows stay unconsidered for the next run.
 *    A digest summarising a member the operator deleted would put the deleted
 *    fact back.
 *  - **Deltas.** A digest's count grows by `incrementReinforcement(by)`
 *    (capped against the count at write time), its members by
 *    `addConsolidatedMembers`, its links by {@link linkBothWays} and
 *    `removeRelatedMemoryIds`, and `lastReinforcedAt` only moves forward. A
 *    new digest is the sanctioned direct insert (CLAUDE.md), built from the
 *    re-read rows.
 *  - **Gone ids are dropped.** A link target, a tier-move row or a re-aim
 *    target that no longer exists is left out, so no retired id is written
 *    back into `relatedMemoryIds` or `consolidatedFrom`.
 *  - **Inbound links are found at write time** (`findIdsLinkingTo`), so a link
 *    admission added to a member after the read is re-aimed at its digest too.
 *
 * It announces nothing: the maintenance run's commit hook (child) or
 * `announceMaintenance` (parent) does.
 *
 * @module memory/admission/consolidation-writes
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { memoryIndex } from '../index-store'
import { calculateReinforcedImportance } from '../scoring'
import { RESOLVED_KEYWORD } from '../recall/tags'
import {
  DIGEST_REINFORCEMENT_CAP,
  type ConsolidationWritePlan,
  type PlannedDigestCreate,
  type PlannedDigestUpdate,
} from '../consolidation-plan'
import { withAdmissionLock } from './admit'
import { linkBothWays } from './links'
import { withoutEmbedding } from './apply'

const log = logger.child({ module: 'memory:admission:consolidation-writes' })

export interface ApplyConsolidationRequest {
  characterId: string
  plan: ConsolidationWritePlan
  /** Rows of clusters too small to fold, stamped considered with the plan. */
  extraConsidered: readonly string[]
  nowIso: string
}

export interface AppliedConsolidation {
  /** Input cluster indexes whose batch was written. */
  landedClusters: number[]
  /** Input cluster indexes skipped because their rows changed since the read. */
  staleClusters: number[]
  /** Every row the writes touched, as it now stands (no vectors). */
  rows: Memory[]
  /** Surviving rows whose links were re-aimed at a digest. */
  linksRewired: number
}

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

function uniq(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids))
}

/** Follow the run's supersession map to the row that finally stands. */
function remapper(supersededBy: ReadonlyMap<string, string>): (id: string) => string {
  return (id) => {
    let current = id
    for (let hop = 0; hop < 5; hop++) {
      const next = supersededBy.get(current)
      if (!next || next === current) break
      current = next
    }
    return current
  }
}

function referenceTimeIso(row: Memory): string {
  const created = row.createdAt
  return row.lastReinforcedAt && row.lastReinforcedAt > created ? row.lastReinforcedAt : created
}

/** A row a digest may still be written from, or sent cold under one. */
function stands(row: Memory | undefined, characterId: string): row is Memory {
  return !!row && row.characterId === characterId && row.source === 'AUTO' && !row.keystone
}

/** Why a batch cannot be written, or null when it can. */
function staleReason(
  characterId: string,
  creates: readonly PlannedDigestCreate[],
  updates: readonly PlannedDigestUpdate[],
  fresh: ReadonlyMap<string, Memory>,
): string | null {
  for (const update of updates) {
    const row = fresh.get(update.id)
    if (!row || row.characterId !== characterId) return `digest ${update.id} is gone`
    if (row.source !== 'CONSOLIDATED' || row.tier === 'cold') return `digest ${update.id} is no longer a hot digest`
    if (row.content !== update.baseContent) return `digest ${update.id} changed since the read`
  }
  for (const digest of [...creates, ...updates]) {
    for (const memberId of digest.memberIds) {
      const member = fresh.get(memberId)
      if (!stands(member, characterId)) return `member ${memberId} no longer stands`
      if (member.supersededById && member.supersededById !== digest.id) return `member ${memberId} was taken in elsewhere`
    }
  }
  return null
}

/** One cluster's writes, under the lock. Returns the ids it touched, or null when stale. */
async function applyBatch(
  request: ApplyConsolidationRequest,
  clusterIndex: number,
  remap: (id: string) => string,
): Promise<{ touched: string[]; rewired: number } | null> {
  const { characterId, plan, nowIso } = request
  const repos = getRepositories()
  const creates = plan.creates.filter((d) => d.clusterIndex === clusterIndex)
  const updates = plan.updates.filter((d) => d.clusterIndex === clusterIndex)
  const moves = plan.tierMoves.filter((m) => m.clusterIndex === clusterIndex)
  const marks = plan.resolvedMarks.filter((m) => m.clusterIndex === clusterIndex)
  const batchDigestIds = new Set([...creates, ...updates].map((d) => d.id))

  const readIds = uniq([
    ...creates.flatMap((d) => d.memberIds),
    ...updates.flatMap((d) => [d.id, ...d.memberIds]),
    ...moves.flatMap((m) => [m.supersededById, ...m.ids]),
    ...marks.map((m) => m.id),
  ])
  const fresh = new Map((await repos.memories.findByIds(readIds)).map((m) => [m.id, m]))

  const stale = staleReason(characterId, creates, updates, fresh)
  if (stale) {
    log.info('Consolidation batch skipped: its rows changed since the read; the next run retries it', {
      characterId,
      clusterIndex,
      reason: stale,
    })
    return null
  }

  const touched = new Set<string>()
  // Ids this batch sends cold; links to them are internal to the batch now.
  const goingCold = new Set(moves.flatMap((m) => m.ids).filter((id) => stands(fresh.get(id), characterId)))
  const exists = async (ids: readonly string[]): Promise<Set<string>> => {
    const want = uniq(ids).filter((id) => !fresh.has(id) && !batchDigestIds.has(id))
    const found = want.length > 0 ? await repos.memories.findByIds(want) : []
    return new Set([
      ...found.map((m) => m.id),
      ...ids.filter((id) => fresh.has(id) || batchDigestIds.has(id)),
    ])
  }
  /** A digest's links: its rows' links re-aimed, minus itself, the batch's cold rows and gone ids. */
  const outboundLinks = async (digestId: string, rows: readonly Memory[]): Promise<string[]> => {
    const candidates = uniq(
      rows
        .flatMap((r) => r.relatedMemoryIds ?? [])
        .map(remap)
        .filter((id) => id !== digestId && !goingCold.has(id)),
    )
    const live = await exists(candidates)
    return candidates.filter((id) => live.has(id))
  }

  // ── New digests: the sanctioned direct insert, built from the re-read rows.
  for (const create of creates) {
    const members = create.memberIds.map((id) => fresh.get(id) as Memory)
    const reinforcementCount = Math.min(
      DIGEST_REINFORCEMENT_CAP,
      Math.max(1, members.reduce((sum, m) => sum + (m.reinforcementCount ?? 1), 0)),
    )
    const lastReinforcedAt = members.map(referenceTimeIso).sort().at(-1) ?? nowIso
    const data = {
      ...create.data,
      reinforcementCount,
      reinforcedImportance: calculateReinforcedImportance(create.importance, reinforcementCount),
      lastReinforcedAt,
      consolidatedFrom: [...create.memberIds],
      relatedMemoryIds: [],
    }
    // The vector rides in the create itself, so a digest never exists
    // without it; the index then caches it without a second write.
    await repos.memories.create(
      create.embedding ? { ...data, embedding: create.embedding } : data,
      { id: create.id, createdAt: nowIso, updatedAt: nowIso },
    )
    if (create.embedding) {
      await memoryIndex.indexInserted(characterId, [{ id: create.id, embedding: create.embedding, tier: 'hot' }])
    }
    touched.add(create.id)
    const links = await outboundLinks(create.id, members)
    if (links.length > 0) {
      await linkBothWays(characterId, create.id, links)
      for (const id of links) touched.add(id)
    }
    log.debug('Digest created', { characterId, memoryId: create.id, members: members.length, reinforcementCount, links: links.length })
  }

  // ── Existing digests: the revision as fields, everything else as deltas.
  for (const update of updates) {
    const digest = fresh.get(update.id) as Memory
    const members = update.memberIds.map((id) => fresh.get(id) as Memory)
    const priorMembers = new Set(digest.consolidatedFrom ?? [])
    const newMembers = members.filter((m) => !priorMembers.has(m.id))
    const currentCount = digest.reinforcementCount ?? 1
    const countDelta = Math.max(
      0,
      Math.min(
        newMembers.reduce((sum, m) => sum + (m.reinforcementCount ?? 1), 0),
        DIGEST_REINFORCEMENT_CAP - currentCount,
      ),
    )
    if (update.embedding) {
      // The revised text and its vector land in one row update.
      await memoryIndex.upsert(characterId, [
        { id: update.id, embedding: update.embedding, tier: 'hot', alongside: update.patch },
      ])
    } else {
      await repos.memories.updateForCharacter(characterId, update.id, update.patch)
    }
    // Recomputes reinforcedImportance from the revised importance; moves the
    // time forward even when the cap leaves nothing to count.
    await repos.memories.incrementReinforcement(characterId, update.id, update.reinforcedAt, countDelta)
    if (newMembers.length > 0) {
      await repos.memories.addConsolidatedMembers(characterId, update.id, newMembers.map((m) => m.id))
    }
    const wanted = await outboundLinks(update.id, [digest, ...members])
    const current = new Set(digest.relatedMemoryIds ?? [])
    const addLinks = wanted.filter((id) => !current.has(id))
    const removeLinks = [...current].filter((id) => id === update.id || goingCold.has(id))
    if (removeLinks.length > 0) await repos.memories.removeRelatedMemoryIds(characterId, update.id, removeLinks)
    if (addLinks.length > 0) {
      await linkBothWays(characterId, update.id, addLinks)
      for (const id of addLinks) touched.add(id)
    }
    touched.add(update.id)
    log.debug('Digest revised in place', {
      characterId,
      memoryId: update.id,
      newMembers: newMembers.length,
      countDelta,
      linksAdded: addLinks.length,
      linksRemoved: removeLinks.length,
    })
  }

  // ── Members and contradicted rows go cold under what stands.
  for (const move of moves) {
    const ids = move.ids.filter((id) => goingCold.has(id))
    const target = remap(move.supersededById)
    if (ids.length === 0) continue
    if (!(await exists([target])).has(target)) {
      log.debug('Tier move skipped: its superseder is gone', { characterId, supersededById: target, rows: ids.length })
      for (const id of ids) goingCold.delete(id)
      continue
    }
    await memoryIndex.setTier(characterId, ids, 'cold', { supersededById: target, consolidatedAt: nowIso })
    for (const id of ids) touched.add(id)
  }

  // ── Inbound links to the rows that went cold, found now and re-aimed.
  let rewired = 0
  if (goingCold.size > 0) {
    for (const row of await repos.memories.findIdsLinkingTo(characterId, [...goingCold])) {
      if (goingCold.has(row.id) || batchDigestIds.has(row.id)) continue
      const stale = row.relatedMemoryIds.filter((id) => goingCold.has(id))
      if (stale.length === 0) continue
      const targets = uniq(stale.map(remap).filter((id) => id !== row.id && !goingCold.has(id)))
      const live = await exists(targets)
      await repos.memories.removeRelatedMemoryIds(characterId, row.id, stale)
      const aim = targets.filter((id) => live.has(id))
      if (aim.length > 0) await linkBothWays(characterId, row.id, aim)
      touched.add(row.id)
      for (const id of aim) touched.add(id)
      rewired++
    }
  }

  // ── Settled grievances: their keywords as they are now, plus the marker.
  for (const mark of marks) {
    const row = fresh.get(mark.id)
    if (!row || row.characterId !== characterId) continue
    const keywords = row.keywords ?? []
    if (keywords.includes(RESOLVED_KEYWORD)) continue
    // Keywords are not embedded (embeddingTextFor), so this is a plain field write.
    await repos.memories.updateForCharacter(characterId, mark.id, { keywords: [...keywords, RESOLVED_KEYWORD] })
    touched.add(mark.id)
  }

  return { touched: [...touched], rewired }
}

/**
 * Apply a consolidation plan in the parent: one batch per cluster, each under
 * admission's lock. Never throws for a stale batch; a write that throws
 * mid-batch propagates (the batch's earlier writes stand, as every
 * parent-side writer's do).
 */
export async function applyConsolidationPlan(request: ApplyConsolidationRequest): Promise<AppliedConsolidation> {
  if (isJobChild()) {
    throw new Error('applyConsolidationPlan runs in the parent; the job child writes through host-RPC (applyConsolidation)')
  }
  const { characterId, plan, nowIso } = request
  const remap = remapper(plan.supersededBy)
  const clusterCount = plan.digestsByCluster.length
  const result: AppliedConsolidation = { landedClusters: [], staleClusters: [], rows: [], linksRewired: 0 }
  const touched = new Set<string>()

  for (let c = 0; c < clusterCount; c++) {
    const applied = await withAdmissionLock(characterId, () => applyBatch(request, c, remap))
    if (!applied) {
      result.staleClusters.push(c)
      continue
    }
    result.landedClusters.push(c)
    result.linksRewired += applied.rewired
    for (const id of applied.touched) touched.add(id)
  }

  // Considered stamps are plain field writes; a stale cluster's rows stay
  // unconsidered so the next run takes them up again.
  const landed = new Set(result.landedClusters)
  const considered = uniq([
    ...plan.consideredByCluster.flatMap((ids, c) => (landed.has(c) ? ids : [])),
    ...request.extraConsidered,
  ])
  if (considered.length > 0) {
    await getRepositories().memories.markConsidered(characterId, considered, nowIso)
    for (const id of considered) touched.add(id)
  }

  if (touched.size > 0) {
    result.rows = (await getRepositories().memories.findByIds([...touched]))
      .filter((m) => m.characterId === characterId)
      .map(withoutEmbedding)
    // The job child's cache still holds the old tiers and rows; it reloads on next use.
    try {
      const { notifyChild } = await import('@/lib/background-jobs/host/processor-host')
      notifyChild('vectorStore', characterId)
    } catch (error) {
      log.debug('Could not tell the job child to drop its memory index cache', {
        characterId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  log.debug('Consolidation plan applied', {
    characterId,
    clusters: clusterCount,
    landed: result.landedClusters.length,
    stale: result.staleClusters.length,
    linksRewired: result.linksRewired,
    rowsTouched: touched.size,
  })
  return result
}

/**
 * Apply the plan from wherever the run is: directly in the parent, over
 * host-RPC from the job child.
 */
export async function applyConsolidationWrites(request: ApplyConsolidationRequest): Promise<AppliedConsolidation> {
  if (!isJobChild()) return applyConsolidationPlan(request)
  const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client')
  return callHost<AppliedConsolidation>('applyConsolidation', request)
}
