/**
 * When the Built-in (TF-IDF) vocabulary needs a refit.
 *
 * A refit rebuilds the vocabulary from every memory and help doc and then
 * re-embeds all of them (`EMBEDDING_REFIT` → `EMBEDDING_REINDEX_ALL`): a few
 * hundred jobs, a new vector width, and a window in which stored vectors and
 * fresh ones cannot be compared (bug 237). A memory written between refits is
 * embedded against the current vocabulary, its new words out of vocabulary
 * until the next fit — the ordinary TF-IDF trade — so a single edit is never
 * a reason to refit. The vocabulary is refit when it is:
 *
 *  - `unfitted` — there is no vocabulary row;
 *  - `text-shape` — fitted before {@link BUILTIN_TEXT_SHAPE_EPOCH}, when the
 *    BUILTIN path stopped embedding memory anchor lines (stored vectors and
 *    the vocabulary still carry them);
 *  - `drift` — the memories created since the fit reach
 *    max({@link REFIT_MIN_NEW_MEMORIES}, {@link REFIT_DRIFT_FRACTION} × all).
 *
 * `evaluateRefitNeed` is the pure rule; `assessBuiltinRefit` reads the
 * counts; `checkBuiltinRefit` runs it for the default profile (boot and the
 * scheduled maintenance pass) and enqueues the refit when one is due.
 * Design of record: docs/developer/features/builtin-tfidf-memory-tuning.md §6.
 *
 * @module embedding/builtin-refit-policy
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { EmbeddingProfile } from '@/lib/schemas/types'

const log = logger.child({ module: 'embedding:builtin-refit-policy' })

/**
 * Vocabularies fitted before this instant were fitted (and their vectors
 * embedded) with memory anchor lines; they are refit once.
 */
export const BUILTIN_TEXT_SHAPE_EPOCH = '2026-10-14T00:00:00.000Z'

/** Fewest new memories that count as drift, however small the corpus. */
export const REFIT_MIN_NEW_MEMORIES = 25

/** Share of the corpus that, created since the fit, counts as drift. */
export const REFIT_DRIFT_FRACTION = 0.1

export type BuiltinRefitReason = 'unfitted' | 'text-shape' | 'drift'

export interface RefitNeedInput {
  /** The vocabulary's `fittedAt`, or null when there is none. */
  fittedAt: string | null
  /** Memories created at or after `fittedAt`. */
  newSinceFit: number
  /** All memories. */
  totalMemories: number
}

/** The drift bar for a corpus of `totalMemories`. */
export function driftThreshold(totalMemories: number): number {
  return Math.max(REFIT_MIN_NEW_MEMORIES, Math.ceil(REFIT_DRIFT_FRACTION * totalMemories))
}

/** Why the vocabulary needs a refit, or null when it does not. Pure. */
export function evaluateRefitNeed(input: RefitNeedInput): BuiltinRefitReason | null {
  if (!input.fittedAt) return 'unfitted'
  const fitted = Date.parse(input.fittedAt)
  if (!Number.isFinite(fitted) || fitted < Date.parse(BUILTIN_TEXT_SHAPE_EPOCH)) return 'text-shape'
  if (input.newSinceFit >= driftThreshold(input.totalMemories)) return 'drift'
  return null
}

export interface RefitAssessment extends RefitNeedInput {
  reason: BuiltinRefitReason | null
}

/** Read the counts for `profile`'s vocabulary and evaluate the rule. */
export async function assessBuiltinRefit(profile: Pick<EmbeddingProfile, 'id'>): Promise<RefitAssessment> {
  const repos = getRepositories()
  const vocabulary = await repos.tfidfVocabularies.findByProfileId(profile.id)
  const fittedAt = vocabulary?.fittedAt ?? null
  let newSinceFit = 0
  let totalMemories = 0
  const characterIds = await repos.memories.findDistinctCharacterIds()
  for (const characterId of characterIds) {
    totalMemories += await repos.memories.countByCharacterId(characterId)
    if (fittedAt) newSinceFit += await repos.memories.countCreatedSince(characterId, fittedAt)
  }
  const input = { fittedAt, newSinceFit, totalMemories }
  const reason = evaluateRefitNeed(input)
  log.debug('Assessed the TF-IDF vocabulary', {
    profileId: profile.id,
    ...input,
    driftThreshold: driftThreshold(totalMemories),
    reason,
  })
  return { ...input, reason }
}

/**
 * The job type of a refit or full reindex already pending or running, if any.
 * A due reason stays due until that job finishes, so a second enqueue would
 * only repeat it.
 */
export async function refitInHand(): Promise<'EMBEDDING_REFIT' | 'EMBEDDING_REINDEX_ALL' | null> {
  const repos = getRepositories()
  for (const type of ['EMBEDDING_REFIT', 'EMBEDDING_REINDEX_ALL'] as const) {
    const recent = await repos.backgroundJobs.findRecentByType(type, 10)
    if (recent.some((job) => job.status === 'PENDING' || job.status === 'PROCESSING')) return type
  }
  return null
}

export interface BuiltinRefitCheck {
  profileId: string | null
  reason: BuiltinRefitReason | null
  enqueued: boolean
}

/**
 * Refit the default profile's vocabulary when it is due (BUILTIN only), unless
 * a refit or full reindex is already queued or running. Runs in the parent.
 * Never throws.
 */
export async function checkBuiltinRefit(): Promise<BuiltinRefitCheck> {
  try {
    const repos = getRepositories()
    const profile = (await repos.embeddingProfiles.findAll()).find((p) => p.isDefault) ?? null
    if (!profile || profile.provider !== 'BUILTIN') {
      return { profileId: profile?.id ?? null, reason: null, enqueued: false }
    }
    const { reason } = await assessBuiltinRefit(profile)
    if (!reason) return { profileId: profile.id, reason: null, enqueued: false }

    const inHand = await refitInHand()
    if (inHand) {
      log.info('TF-IDF refit due but one is already in hand; not enqueueing another', {
        profileId: profile.id,
        reason,
        inHand,
      })
      return { profileId: profile.id, reason, enqueued: false }
    }

    // The characters with memories are the corpus a refit with no memories
    // would skip; there is nothing to fit when the instance holds none.
    if (reason === 'unfitted' && (await repos.memories.findDistinctCharacterIds()).length === 0) {
      return { profileId: profile.id, reason, enqueued: false }
    }

    const { enqueueEmbeddingRefit } = await import('@/lib/background-jobs/queue-service')
    await enqueueEmbeddingRefit(profile.userId, { profileId: profile.id, triggerReindex: true })
    log.info('TF-IDF vocabulary refit enqueued', { profileId: profile.id, reason })
    return { profileId: profile.id, reason, enqueued: true }
  } catch (error) {
    log.warn('TF-IDF refit check failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { profileId: null, reason: null, enqueued: false }
  }
}
