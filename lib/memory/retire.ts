/**
 * `retireMemories` — the one way a memory row is deleted.
 *
 * A memory is named from three link columns on other rows, and its vector is
 * cached in its character's index. A bare row delete leaves all four behind:
 * an orphan vector at rank 1 blinded the gate (bug 200), and a deleted id left
 * in `consolidatedFrom` or `supersededById` overstated a digest and stranded
 * its members (bug 225). Every deletion therefore comes here, and here alone
 * calls `MemoriesRepository.bulkDeleteUnsafe` (a test greps for any other
 * caller). In order, it:
 *
 *   1. resolves the requested ids to rows and, under `keep: 'manual'`, spares
 *      what a policy path must never remove (MANUAL rows, cold rows, and a
 *      digest while any of its members survives — decision 4, bug 201);
 *   2. retires, with its last member, any digest whose `consolidatedFrom` the
 *      retirement would empty (invariant 8) — except under `reason:
 *      'retention'`, whose purpose is to let a digest outlive the cold members
 *      it replaced;
 *   3. scrubs the doomed ids from every row's `relatedMemoryIds` and from
 *      surviving digests' `consolidatedFrom`, and cuts `supersededById` on
 *      surviving members of a doomed digest (they become cap-demoted cold rows
 *      the next consolidation can re-digest) — all as SQL removal deltas
 *      applied against the rows at commit, so two retirements in one job, or
 *      two jobs, compose (bug 234);
 *   4. deletes the rows and evicts their vectors through `memoryIndex.remove`;
 *   5. in the parent, invalidates the holders' frozen archives, publishes
 *      `memories` and refreshes the Commonplace mirror of any digest it
 *      removed. In the job child every write above buffers, and the
 *      dispatcher's commit hook does these effects after the batch lands.
 *
 * Idempotent: ids already gone are scrubbed from links and otherwise ignored.
 *
 * @module memory/retire
 */

import { getRepositories } from '@/lib/repositories/factory'
import { rawQuery } from '@/lib/database/manager'
import { chunkArray, SQLITE_VARIABLE_CHUNK_SIZE } from '@/lib/utils/chunk'
import { logger } from '@/lib/logger'
import { publishRealtime } from '@/lib/realtime/bus'
import { memoryIndex } from './index-store'
import { policyProtectionOf, type PolicyProtection } from './policy-protection'
import { invalidateFrozenArchive } from './frozen-archive-cache'

const log = logger.child({ module: 'memory:retire' })

/** Why rows are being retired — logged, and it decides the digest cascade. */
export type RetireReason =
  /** `DELETE /memories/[id]` — the true purge of one row. */
  | 'item-delete'
  /** A chat's extracted memories wiped (`DELETE /memories?chatId=`, regenerate). */
  | 'chat-wipe'
  /** A deleted message, or a whole swipe group, took its memories with it. */
  | 'message-cascade'
  /** A line re-attributed to another speaker drops what was extracted for the old one. */
  | 'message-reattribution'
  /** A swipe re-roll discards the memories of the line it replaces. */
  | 'swipe-regenerate'
  /** A character (and with it every memory it holds) deleted. */
  | 'character-delete'
  /** A character archived: its memories travel in the bundle, not the database. */
  | 'character-archive'
  /** A restore replacing the data it is about to write back. */
  | 'restore-replace'
  /** Housekeeping retention: superseded cold rows past `coldRetentionDays`. */
  | 'retention'
  /** The near-duplicate fold removing the rows it folded into a survivor. */
  | 'near-duplicate-fold'

export interface RetireOptions {
  reason: RetireReason
  /**
   * `'manual'`: spare what a policy path must never remove — MANUAL rows,
   * cold rows, and a digest while any of its members survives. Omitted, every
   * requested row is retired (the per-row purge, cascades of a whole owner).
   */
  keep?: 'manual'
}

export interface RetireReport {
  requested: number
  /** Rows deleted (in the job child: rows the commit will delete). */
  retired: number
  retiredIds: string[]
  /** Requested rows left in place under `keep: 'manual'`. */
  spared: number
  sparedBy: Record<PolicyProtection, number>
  /** Digests retired because the retirement emptied their `consolidatedFrom`. */
  digestsRetiredWithLastMember: number
  vectorsRemoved: number
  neighboursTouched: number
  digestLinksScrubbed: number
  charactersAffected: number
}

/** The columns retirement reads of each row. */
interface RetireRow {
  id: string
  characterId: string
  source: string | null
  tier: string | null
  aboutCharacterId: string | null
  consolidatedFrom: string | null
  supersededById: string | null
}

/** Warn when one retirement rewrites more neighbours than a cascade normally would. */
const NEIGHBOUR_WARN = 200

/** A digest that retires with its last member may itself be a member; bounded. */
const MAX_DIGEST_CASCADE_PASSES = 3

function emptyReport(requested: number): RetireReport {
  return {
    requested,
    retired: 0,
    retiredIds: [],
    spared: 0,
    sparedBy: { manual: 0, digest: 0, cold: 0 },
    digestsRetiredWithLastMember: 0,
    vectorsRemoved: 0,
    neighboursTouched: 0,
    digestLinksScrubbed: 0,
    charactersAffected: 0,
  }
}

function parseIdList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function resolveRows(ids: readonly string[]): Promise<RetireRow[]> {
  const rows: RetireRow[] = []
  for (const chunk of chunkArray([...ids], SQLITE_VARIABLE_CHUNK_SIZE)) {
    rows.push(
      ...(await rawQuery<RetireRow[]>(
        `SELECT id, characterId, source, tier, aboutCharacterId, consolidatedFrom, supersededById
           FROM memories WHERE id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      )),
    )
  }
  return rows
}

/** Ids among `ids` that exist as rows. */
async function existingIds(ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (const chunk of chunkArray([...ids], SQLITE_VARIABLE_CHUNK_SIZE)) {
    const rows = await rawQuery<Array<{ id: string }>>(
      `SELECT id FROM memories WHERE id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    )
    for (const row of rows) found.add(row.id)
  }
  return found
}

/**
 * Under `keep: 'manual'`: split the rows into those to retire and those to
 * spare. A digest is spared only while a member outside this retirement still
 * names it; a digest whose members are all going (or already gone) goes too.
 */
async function applyKeepManual(
  rows: RetireRow[],
  report: RetireReport,
): Promise<RetireRow[]> {
  const doomed: RetireRow[] = []
  const sparedDigests: RetireRow[] = []
  for (const row of rows) {
    const protection = policyProtectionOf({
      source: row.source as 'AUTO' | 'MANUAL' | 'CONSOLIDATED',
      tier: row.tier === 'cold' ? 'cold' : 'hot',
    })
    if (!protection) {
      doomed.push(row)
    } else if (protection === 'digest') {
      sparedDigests.push(row)
    } else {
      report.sparedBy[protection]++
    }
  }

  if (sparedDigests.length > 0) {
    const doomedIds = new Set(doomed.map((r) => r.id))
    const memberIds = [...new Set(sparedDigests.flatMap((d) => parseIdList(d.consolidatedFrom)))].filter(
      (id) => !doomedIds.has(id),
    )
    const members = memberIds.length > 0 ? await getRepositories().memories.findByIds(memberIds) : []
    // A member speaks for a digest only while it still names it: a row
    // promoted or re-consolidated elsewhere no longer does.
    const named = new Set(members.map((m) => m.supersededById).filter((id): id is string => !!id))
    for (const digest of sparedDigests) {
      if (named.has(digest.id)) {
        report.sparedBy.digest++
      } else {
        doomed.push(digest)
      }
    }
  }

  report.spared = rows.length - doomed.length
  return doomed
}

/**
 * Digests the retirement would leave with no member: every id in their
 * `consolidatedFrom` is being retired or is already gone. Repeated, bounded,
 * in case a retired digest was itself a member of another.
 */
async function cascadeEmptiedDigests(doomed: Map<string, RetireRow>): Promise<number> {
  const repos = getRepositories()
  let added = 0
  for (let pass = 0; pass < MAX_DIGEST_CASCADE_PASSES; pass++) {
    const holders = [...new Set([...doomed.values()].map((r) => r.characterId))]
    const digests = await repos.memories.findDigestsContainingMembers(holders, [...doomed.keys()])
    const candidates = digests.filter((d) => !doomed.has(d.id))
    if (candidates.length === 0) break

    const remainingIds = [
      ...new Set(candidates.flatMap((d) => d.consolidatedFrom.filter((id) => !doomed.has(id)))),
    ]
    const surviving = remainingIds.length > 0 ? await existingIds(remainingIds) : new Set<string>()

    const emptied = candidates.filter(
      (digest) => !digest.consolidatedFrom.some((id) => !doomed.has(id) && surviving.has(id)),
    )
    const addedThisPass = emptied.length
    for (const row of emptied.length > 0 ? await resolveRows(emptied.map((d) => d.id)) : []) {
      doomed.set(row.id, row)
      log.debug('Digest retires with its last member', {
        digestId: row.id,
        characterId: row.characterId,
        members: parseIdList(row.consolidatedFrom).length,
      })
    }
    added += addedThisPass
    if (addedThisPass === 0) break
  }
  return added
}

/**
 * Scrub the digest bookkeeping that names doomed rows: drop them from
 * surviving digests' `consolidatedFrom` (a removal delta), and cut
 * `supersededById` on surviving members of a doomed digest through
 * `memoryIndex.setTier` (still cold, no digest). Scoped to the doomed rows'
 * holders — a digest and its members share one. Returns rows rewritten.
 */
async function scrubDigestLinks(doomed: ReadonlySet<string>, holderIds: Iterable<string>): Promise<number> {
  const holders = [...new Set(holderIds)]
  if (doomed.size === 0 || holders.length === 0) return 0
  const repos = getRepositories()
  const doomedIds = [...doomed]
  let touched = 0

  const digests = await repos.memories.findDigestsContainingMembers(holders, doomedIds)
  for (const digest of digests) {
    if (doomed.has(digest.id)) continue
    const removed = (digest.consolidatedFrom ?? []).filter((id) => doomed.has(id))
    if (removed.length === 0) continue
    await repos.memories.removeConsolidatedMembers(digest.characterId, digest.id, removed)
    touched++
  }

  const orphanedByCharacter = new Map<string, string[]>()
  for (const member of await repos.memories.findIdsSupersededByAny(holders, doomedIds)) {
    if (doomed.has(member.id)) continue
    const list = orphanedByCharacter.get(member.characterId) ?? []
    list.push(member.id)
    orphanedByCharacter.set(member.characterId, list)
  }
  for (const [characterId, ids] of orphanedByCharacter) {
    await memoryIndex.setTier(characterId, ids, 'cold', { supersededById: null })
    touched += ids.length
  }

  log.debug('Scrubbed digest links to retired memories', {
    doomed: doomed.size,
    holders: holders.length,
    digestsScanned: digests.length,
    touched,
  })
  return touched
}

/** Holder id → the subject buckets of the digests a retirement removed. */
function digestBucketsOf(rows: Iterable<RetireRow>): Map<string, Set<string>> {
  const buckets = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.source !== 'CONSOLIDATED' || !row.aboutCharacterId) continue // no-subject bucket has no mirror
    const set = buckets.get(row.characterId) ?? new Set<string>()
    set.add(row.aboutCharacterId)
    buckets.set(row.characterId, set)
  }
  return buckets
}

/**
 * The parent-side effects of a retirement. In the job child every one of these
 * is the dispatcher's, after the batch commits (the archive and mirror hooks,
 * `topicsForCompletedJob`), so this does nothing there.
 */
async function announceRetirement(characterIds: Iterable<string>, digestRows: Iterable<RetireRow>): Promise<void> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    log.debug('Retired in the job child; the dispatcher announces after commit')
    return
  }
  for (const characterId of characterIds) invalidateFrozenArchive(characterId)
  publishRealtime('memories')
  const buckets = digestBucketsOf(digestRows)
  if (buckets.size === 0) return
  try {
    const { mirrorCommonplaceForSubjects } = await import('./commonplace-mirror')
    for (const [holderId, subjects] of buckets) {
      const written = await mirrorCommonplaceForSubjects(holderId, subjects)
      log.debug('Refreshed Commonplace mirror after retiring a digest', {
        characterId: holderId,
        subjects: subjects.size,
        written,
      })
    }
  } catch (error) {
    log.warn('Commonplace mirror refresh after retiring a digest failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Retire memory rows: scrub every link that names them, delete them, evict
 * their vectors, and announce it. The only deletion of a memory row.
 */
export async function retireMemories(ids: readonly string[], opts: RetireOptions): Promise<RetireReport> {
  const requestedIds = [...new Set(ids)]
  const report = emptyReport(requestedIds.length)
  if (requestedIds.length === 0) return report

  const startedAt = Date.now()
  const repos = getRepositories()

  let rows = await resolveRows(requestedIds)
  if (opts.keep === 'manual') {
    rows = await applyKeepManual(rows, report)
  }

  const doomed = new Map(rows.map((r) => [r.id, r]))
  if (opts.reason !== 'retention' && doomed.size > 0) {
    report.digestsRetiredWithLastMember = await cascadeEmptiedDigests(doomed)
  }

  // The neighbour scrub is one SQL removal delta across every holder (bug
  // 234). With nothing kept back it takes every requested id, found or
  // already gone, so a stale id leaves its neighbours too; a spared row's id
  // must stay linked.
  const scrubIds = opts.keep === 'manual'
    ? [...doomed.keys()]
    : [...new Set([...requestedIds, ...doomed.keys()])]
  if (scrubIds.length > 0) {
    report.neighboursTouched = (await repos.memories.removeRelatedMemoryIdsEverywhere(scrubIds)) ?? 0
  }

  if (doomed.size === 0) {
    log.debug('Nothing to retire', { reason: opts.reason, requested: report.requested, spared: report.spared })
    return report
  }

  const idsByCharacter = new Map<string, string[]>()
  for (const row of doomed.values()) {
    const list = idsByCharacter.get(row.characterId) ?? []
    list.push(row.id)
    idsByCharacter.set(row.characterId, list)
  }
  report.charactersAffected = idsByCharacter.size
  report.digestLinksScrubbed = await scrubDigestLinks(new Set(doomed.keys()), idsByCharacter.keys())

  // In the job child the delete buffers and returns nothing; the ids were
  // resolved against the database just above, so their count is what the
  // commit removes.
  for (const [characterId, characterIds] of idsByCharacter) {
    const result: unknown = await repos.memories.bulkDeleteUnsafe(characterId, characterIds)
    report.retired += typeof result === 'number' && Number.isFinite(result) ? result : characterIds.length
    report.vectorsRemoved += await memoryIndex.remove(characterId, characterIds)
  }
  report.retiredIds = [...doomed.keys()]

  const logFields = {
    reason: opts.reason,
    keep: opts.keep ?? null,
    requested: report.requested,
    retired: report.retired,
    spared: report.spared,
    sparedBy: report.sparedBy,
    digestsRetiredWithLastMember: report.digestsRetiredWithLastMember,
    vectorsRemoved: report.vectorsRemoved,
    neighboursTouched: report.neighboursTouched,
    digestLinksScrubbed: report.digestLinksScrubbed,
    charactersAffected: report.charactersAffected,
    durationMs: Date.now() - startedAt,
  }
  if (report.neighboursTouched >= NEIGHBOUR_WARN) {
    log.warn('Retirement rewrote an unusually large neighbour set', logFields)
  }
  log.debug('Retired memories', logFields)

  if (report.retired > 0) {
    await announceRetirement(idsByCharacter.keys(), doomed.values())
  }
  return report
}

/**
 * Wipe what extraction wrote for a chat (`DELETE /memories?chatId=`,
 * `MEMORY_REGENERATE_CHAT`): every memory the chat sourced, under `keep:
 * 'manual'` — a regenerate never destroys a hand-written row, a cold row, or a
 * digest that still has a member (bug 201, decision 4). The per-row delete
 * remains the way to purge any of them.
 */
export async function retireChatMemories(chatId: string): Promise<RetireReport> {
  const memories = await getRepositories().memories.findByChatId(chatId)
  const report = await retireMemories(memories.map((m) => m.id), { reason: 'chat-wipe', keep: 'manual' })
  if (report.spared > 0) {
    log.info('Chat wipe spared manual, cold and digest rows', {
      chatId,
      spared: report.spared,
      sparedBy: report.sparedBy,
    })
  }
  log.debug('Wiped a chat\'s extracted memories', { chatId, retired: report.retired, spared: report.spared })
  return report
}
