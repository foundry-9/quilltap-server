/**
 * The Commonplace mirror, written from committed rows (bug 208).
 *
 * After consolidation, each touched subject bucket's hot digests are mirrored
 * into the holder's vault (`Commonplace/<Subject>.md`, `Commonplace/Self.md`),
 * where the extractor's canon loaders read them back as established fact. That
 * makes the mirror an effect that must never run ahead of the digests it
 * describes: a file written before the batch commits, from a batch that then
 * fails, hands the extractor phantom canon.
 *
 * So the mirror is built here from the database, never from a plan:
 *
 *   - **Job runs** (the forked child): the child writes no vault files. The
 *     parent's dispatcher calls {@link mirrorCommonplaceAfterCommit} once the
 *     job's write batch has committed; a failed batch never reaches it.
 *   - **In-process runs** (the parent): `runConsolidation` commits as it goes,
 *     then calls {@link mirrorCommonplaceForSubjects} itself.
 *
 * Parent-only. Called in the job child it does nothing and says so.
 *
 * @module memory/commonplace-mirror
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import type { Character, Memory } from '@/lib/schemas/types'
import {
  writeCommonplaceDigestsToVault,
  type CommonplaceMirrorFile,
} from '@/lib/file-storage/commonplace-digest-vault-bridge'

const log = logger.child({ module: 'memory:commonplace-mirror' })

/**
 * Most digests read per bucket. The renderer ranks by `reinforcedImportance`
 * and trims to a ~1,500-token body, which a few dozen digests already fill;
 * the repository returns them best first.
 */
export const COMMONPLACE_MIRROR_DIGESTS_PER_BUCKET = 200

/** A buffered write as the dispatcher sees it. */
export interface CommittedMemoryWrite {
  method: string
  args: readonly unknown[]
}

/** The job types whose committed batch can change a Commonplace mirror. */
const MIRRORING_JOB_TYPES = new Set<string>(['MEMORY_CONSOLIDATION'])

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

/**
 * The holders and digest-subject buckets a committed consolidation batch
 * touched. A created digest names its holder and subject on its data; a
 * revised one (`updateForCharacter` with `consolidatedFrom` in the patch) is
 * named by id, and its subject is read back from the committed row.
 */
export async function subjectsTouchedByWrites(
  writes: readonly CommittedMemoryWrite[],
): Promise<Map<string, Set<string>>> {
  const touched = new Map<string, Set<string>>()
  const add = (holderId: unknown, subjectId: unknown): void => {
    if (typeof holderId !== 'string' || !holderId) return
    if (typeof subjectId !== 'string' || !subjectId) return // the no-subject bucket has no mirror
    const set = touched.get(holderId) ?? new Set<string>()
    set.add(subjectId)
    touched.set(holderId, set)
  }

  const revised: Array<{ holderId: string; memoryId: string }> = []
  for (const write of writes) {
    if (write.method === 'memories.create') {
      const data = write.args?.[0] as Partial<Memory> | undefined
      if (data && data.source === 'CONSOLIDATED') add(data.characterId, data.aboutCharacterId)
      continue
    }
    if (write.method === 'memories.updateForCharacter') {
      const [holderId, memoryId, patch] = write.args as [unknown, unknown, Record<string, unknown> | undefined]
      if (typeof holderId === 'string' && typeof memoryId === 'string' && patch && 'consolidatedFrom' in patch) {
        revised.push({ holderId, memoryId })
      }
    }
  }

  if (revised.length > 0) {
    const repos = getRepositories()
    for (const { holderId, memoryId } of revised) {
      try {
        const row = await repos.memories.findByIdForCharacter(holderId, memoryId)
        if (row && row.source === 'CONSOLIDATED') add(holderId, row.aboutCharacterId)
      } catch (error) {
        log.debug('Revised digest unreadable while collecting mirror subjects; skipped', {
          characterId: holderId,
          memoryId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return touched
}

/**
 * Rewrite the holder's Commonplace files for the given subjects from the hot
 * digests the database holds now. Returns the number of files written. Never
 * throws — the digests are the record; the mirror is their echo.
 */
export async function mirrorCommonplaceForSubjects(
  holderCharacterId: string,
  subjectCharacterIds: Iterable<string>,
  updatedAt: string = new Date().toISOString(),
): Promise<number> {
  const subjects = Array.from(new Set(subjectCharacterIds))
  if (subjects.length === 0) return 0
  if (isJobChild()) {
    log.debug('Commonplace mirror is parent-only; the commit hook writes it', {
      characterId: holderCharacterId,
      subjects: subjects.length,
    })
    return 0
  }

  try {
    const repos = getRepositories()
    const holder = await repos.characters.findByIdRaw(holderCharacterId)
    if (!holder) {
      log.debug('Commonplace mirror skipped: holder not found', { characterId: holderCharacterId })
      return 0
    }

    const files: CommonplaceMirrorFile[] = []
    for (const subjectId of subjects) {
      const isSelf = subjectId === holderCharacterId
      let subjectName = holder.name
      if (!isSelf) {
        let subject: Character | null = null
        try {
          subject = await repos.characters.findById(subjectId)
        } catch {
          subject = null
        }
        if (!subject) {
          try {
            subject = await repos.characters.findByIdRaw(subjectId)
          } catch {
            subject = null
          }
        }
        if (!subject) {
          log.debug('Commonplace mirror skips a bucket whose subject no longer exists', {
            characterId: holderCharacterId,
            subjectId,
          })
          continue
        }
        subjectName = subject.name
      }

      const digests = await repos.memories.findHotDigests(
        holderCharacterId,
        isSelf ? 'self' : subjectId,
        COMMONPLACE_MIRROR_DIGESTS_PER_BUCKET,
      )
      files.push({
        subjectCharacterId: subjectId,
        subjectName,
        isSelf,
        digests: digests.map((d) => ({
          content: d.content,
          kind: d.kind ?? 'semantic',
          occurredAt: d.occurredAt ?? null,
          reinforcedImportance: d.reinforcedImportance ?? d.importance,
        })),
      })
    }
    if (files.length === 0) return 0

    const result = await writeCommonplaceDigestsToVault({ holderCharacterId, files, updatedAt })
    log.debug('Commonplace mirror written from committed digests', {
      characterId: holderCharacterId,
      buckets: files.length,
      written: result.written,
      unchanged: result.unchanged,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
    })
    return result.written
  } catch (error) {
    log.warn('Commonplace mirror failed (the digests are committed regardless)', {
      characterId: holderCharacterId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/**
 * Dispatcher commit hook: once a consolidation job's batch has committed,
 * mirror every bucket it touched. Never throws.
 */
export async function mirrorCommonplaceAfterCommit(
  jobType: string | undefined,
  payload: Record<string, unknown> | undefined,
  writes: readonly CommittedMemoryWrite[],
): Promise<void> {
  if (!jobType || !MIRRORING_JOB_TYPES.has(jobType)) return
  if (payload?.dryRun === true) return
  try {
    const touched = await subjectsTouchedByWrites(writes)
    if (touched.size === 0) {
      log.debug('Committed consolidation batch touched no mirrored bucket', { jobType })
      return
    }
    const updatedAt = new Date().toISOString()
    for (const [holderId, subjects] of touched) {
      await mirrorCommonplaceForSubjects(holderId, subjects, updatedAt)
    }
  } catch (error) {
    log.warn('Commonplace mirror after commit failed (non-fatal)', {
      jobType,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** The buffered memories writes that delete rows, and where each names its ids. */
const MEMORY_DELETE_WRITES: Readonly<Record<string, (args: readonly unknown[]) => unknown[]>> = {
  // `retireMemories` is the only deleter, and this is its only delete.
  'memories.bulkDeleteUnsafe': (args) => (Array.isArray(args[1]) ? args[1] : []),
}

/** Every memory id a write batch deletes. Pure. */
export function memoryIdsDeletedByWrites(writes: readonly CommittedMemoryWrite[]): string[] {
  const ids = new Set<string>()
  for (const write of writes) {
    const pick = MEMORY_DELETE_WRITES[write.method]
    if (!pick) continue
    for (const id of pick(write.args ?? [])) {
      if (typeof id === 'string' && id) ids.add(id)
    }
  }
  return Array.from(ids)
}

/**
 * The holders and subject buckets of the digests a write batch is about to
 * delete. Must run **before** the batch commits — a deleted row cannot be
 * read afterwards. Any job type counts: a digest deleted by a housekeeping
 * sweep or a dedup merge leaves its bucket's mirror as stale as one deleted by
 * consolidation. Never throws; a failed read resolves nothing.
 */
export async function digestBucketsDeletedByWrites(
  writes: readonly CommittedMemoryWrite[],
): Promise<Map<string, Set<string>>> {
  const buckets = new Map<string, Set<string>>()
  const ids = memoryIdsDeletedByWrites(writes)
  if (ids.length === 0) return buckets
  try {
    const rows = await getRepositories().memories.findDigestSubjectsByIds(ids)
    for (const row of rows) {
      if (!row.characterId || !row.aboutCharacterId) continue // the no-subject bucket has no mirror
      const set = buckets.get(row.characterId) ?? new Set<string>()
      set.add(row.aboutCharacterId)
      buckets.set(row.characterId, set)
    }
    log.debug('Resolved digest buckets a batch deletes', { deletedIds: ids.length, digests: rows.length })
  } catch (error) {
    log.debug('Digest bucket lookup before commit failed; no mirror refresh', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return buckets
}

/**
 * Dispatcher commit hook for digest deletes: once the batch that deleted them
 * has committed, rewrite each bucket's mirror from what remains (see
 * {@link digestBucketsDeletedByWrites}, which the dispatcher calls before
 * commit). Never throws.
 */
export async function mirrorCommonplaceForDeletedDigests(
  buckets: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<void> {
  if (buckets.size === 0) return
  const updatedAt = new Date().toISOString()
  for (const [holderId, subjects] of buckets) {
    await mirrorCommonplaceForSubjects(holderId, subjects, updatedAt)
  }
  log.debug('Commonplace mirror refreshed after a committed digest delete', { holders: buckets.size })
}
