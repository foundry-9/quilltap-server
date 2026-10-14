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
 *  - `text-shape` — stamped with an older `textShapeVersion` than
 *    {@link LEXICAL_TEXT_SHAPE_VERSION} (0: fitted, and its memories embedded,
 *    with anchor lines before the BUILTIN path left them out);
 *  - `drift` — the memories created since the fit reach
 *    max({@link REFIT_MIN_NEW_MEMORIES}, {@link REFIT_DRIFT_FRACTION} × all).
 *
 * The counts read the corpus the refit fits on — every memory row
 * (`countCorpusSince`); `handleEmbeddingRefit` fits every memory of every
 * character holding one — so a due refit always has something to fit and
 * clears its own reason.
 *
 * `evaluateRefitNeed` is the pure rule; `assessBuiltinRefit` reads the
 * counts; `enqueueRefitIfDue` is the one serialised check-then-enqueue, used
 * by the debounced `scheduleRefit` and by `checkBuiltinRefit` (the default
 * profile, from boot and the scheduled maintenance pass).
 * Design of record: docs/developer/features/complete/builtin-tfidf-memory-tuning.md §6.
 *
 * @module embedding/builtin-refit-policy
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { EmbeddingProfile } from '@/lib/schemas/types'
import { processSingleton } from '@/lib/utils/process-singleton'
import { isLexicalEmbeddingProvider } from './cosine-scale'
// Direct module, not the index-store barrel (it imports the embedding service).
import { LEXICAL_TEXT_SHAPE_VERSION } from '@/lib/memory/index-store/embedding-text'

export { LEXICAL_TEXT_SHAPE_VERSION }

const log = logger.child({ module: 'embedding:builtin-refit-policy' })

/** Fewest new memories that count as drift, however small the corpus. */
export const REFIT_MIN_NEW_MEMORIES = 25

/** Share of the corpus that, created since the fit, counts as drift. */
export const REFIT_DRIFT_FRACTION = 0.1

export type BuiltinRefitReason = 'unfitted' | 'text-shape' | 'drift'

export interface RefitNeedInput {
  /** The vocabulary's `fittedAt`, or null when there is none. */
  fittedAt: string | null
  /** The vocabulary's `textShapeVersion` (absent on rows from before the column reads 0). */
  textShapeVersion?: number | null
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
  if ((input.textShapeVersion ?? 0) < LEXICAL_TEXT_SHAPE_VERSION) return 'text-shape'
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
  const textShapeVersion = vocabulary?.textShapeVersion ?? 0
  const { total: totalMemories, createdSince: newSinceFit } = await repos.memories.countCorpusSince(fittedAt)
  const input = { fittedAt, textShapeVersion, newSinceFit, totalMemories }
  const reason = evaluateRefitNeed(input)
  log.debug('Assessed the TF-IDF vocabulary', {
    profileId: profile.id,
    ...input,
    driftThreshold: driftThreshold(totalMemories),
    reason,
  })
  return { ...input, reason }
}

export interface RefitInHand {
  type: 'EMBEDDING_REFIT' | 'EMBEDDING_REINDEX_ALL'
  status: 'PENDING' | 'PROCESSING'
}

/**
 * A refit or full reindex already pending or running, if any (queried by
 * status, so a pending job in backoff is always seen). A due reason stays due
 * until that job finishes, so a second enqueue would only repeat it.
 */
export async function refitInHand(): Promise<RefitInHand | null> {
  const repos = getRepositories()
  for (const type of ['EMBEDDING_REFIT', 'EMBEDDING_REINDEX_ALL'] as const) {
    const active = await repos.backgroundJobs.findActiveByType(type)
    const job = active.find((j) => j.status === 'PENDING') ?? active.find((j) => j.status === 'PROCESSING')
    if (job) return { type, status: job.status as RefitInHand['status'] }
  }
  return null
}

export interface RefitDecision {
  reason: BuiltinRefitReason | 'forced' | null
  enqueued: boolean
  /** Why nothing was enqueued for a due reason. */
  heldBy?: 'nothing-to-fit' | RefitInHand
}

/** The tail of the check-then-enqueue chain (process-wide, so concurrent callers queue). */
const refitChain = processSingleton('embedding.builtinRefitChain', () => ({ tail: Promise.resolve() as Promise<unknown> }))

/**
 * Enqueue a refit-with-reindex for `profile` when one is due — or always,
 * with `force` — unless a refit is already in hand. Serialised process-wide:
 * the check and the enqueue are one step, so boot, the maintenance pass and a
 * debounced memory edit firing together enqueue one refit, not three.
 *
 * A forced request (an import) is held only by a *pending* refit, which will
 * read the grown corpus when it runs; a running one may have read it already.
 */
export async function enqueueRefitIfDue(
  profile: Pick<EmbeddingProfile, 'id' | 'userId'>,
  opts: { force?: boolean; source: string },
): Promise<RefitDecision> {
  const run = async (): Promise<RefitDecision> => {
    let reason: RefitDecision['reason'] = opts.force ? 'forced' : null
    if (!opts.force) {
      const assessment = await assessBuiltinRefit(profile)
      reason = assessment.reason
      if (!reason) return { reason: null, enqueued: false }
      // No memories: the refit has nothing to fit and would leave the reason standing.
      if (assessment.totalMemories === 0) {
        log.debug('TF-IDF refit due but there are no memories to fit', { profileId: profile.id, reason, source: opts.source })
        return { reason, enqueued: false, heldBy: 'nothing-to-fit' }
      }
    }
    const inHand = await refitInHand()
    if (inHand && (!opts.force || inHand.status === 'PENDING')) {
      log.info('TF-IDF refit due but one is already in hand; not enqueueing another', {
        profileId: profile.id,
        reason,
        inHand,
        source: opts.source,
      })
      return { reason, enqueued: false, heldBy: inHand }
    }
    const { enqueueEmbeddingRefit } = await import('@/lib/background-jobs/queue-service')
    await enqueueEmbeddingRefit(profile.userId, { profileId: profile.id, triggerReindex: true })
    log.info('TF-IDF vocabulary refit enqueued', { profileId: profile.id, reason, source: opts.source })
    return { reason, enqueued: true }
  }
  const result = refitChain.tail.then(run, run)
  refitChain.tail = result.catch(() => undefined)
  return result
}

export interface BuiltinRefitCheck {
  profileId: string | null
  reason: BuiltinRefitReason | null
  enqueued: boolean
}

/**
 * Refit the instance default profile's vocabulary when it is due (BUILTIN
 * only). Boot and the scheduled maintenance pass call it; runs in the parent.
 * Never throws.
 */
export async function checkBuiltinRefit(): Promise<BuiltinRefitCheck> {
  try {
    const profile = await getRepositories().embeddingProfiles.findInstanceDefault()
    if (!profile || !isLexicalEmbeddingProvider(profile.provider)) {
      return { profileId: profile?.id ?? null, reason: null, enqueued: false }
    }
    const decision = await enqueueRefitIfDue(profile, { source: 'check' })
    return {
      profileId: profile.id,
      reason: decision.reason === 'forced' ? null : decision.reason,
      enqueued: decision.enqueued,
    }
  } catch (error) {
    log.warn('TF-IDF refit check failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { profileId: null, reason: null, enqueued: false }
  }
}
