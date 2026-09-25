/**
 * Image failover — the one chokepoint every image call site sends its provider
 * call through.
 *
 * The Salon's `generate_image` tool, the Lantern's story backgrounds, Aurora's
 * avatar job and the legacy image dialog each used to carry their own
 * try/catch reroute with its own detection and its own gate. Now each owns
 * only what is profile-specific — building the parameters, LoRA trigger
 * phrases, the LLM-log line — inside an `attempt` closure, and this module
 * owns the rest:
 *
 *   1. ask the primary;
 *   2. on a throw, `classifyRefusal`. Not a refusal → rethrow untouched (a rate
 *      limit is not the Concierge's business);
 *   3. a refusal → record it on the trail, and on the chat's refusal ledger
 *      (`recordModerationRefusal`) once the outcome is known — whether or not
 *      the reroute later succeeds;
 *   4. the chat may not fail over (`mayFailOver` — it is Locked) → announce
 *      `refusal-not-permitted` with `reason: 'locked'`, rethrow; mode is not
 *      `AUTO_ROUTE` → announce `refusal-not-permitted`, rethrow;
 *   5. ask the understudy resolver (excluding the primary). Nobody →
 *      announce `refusal-no-understudy`, rethrow;
 *   6. ask the understudy once. It answers → announce `refusal-rerouted` and
 *      return; it fails → record its own verdict and rethrow.
 *
 * Every rethrow carries the trail on the error (`conciergeTrail`), so a
 * caller that surfaces the failure can still show what was tried. The
 * pre-flight classifier reroutes stay where they are; this is the post-hoc
 * half, and it asks the same resolver they do.
 *
 * @module services/dangerous-content/image-failover
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { classifyFallbackTrigger } from '@/lib/llm/fallback'
import type { RouteAttempt, RouteAttemptVia } from '@/lib/schemas/chat.types'
import type { ImageProfile } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import {
  postConciergeRefusalAnnouncement,
  type ConciergeRefusalKind,
} from '@/lib/services/concierge-notifications/writer'
import { conciergeStateMayFailOver, getConciergeState, type ConciergeState } from './chat-override'
import { readCurrentConciergeState } from './current-state'
import { classifyRefusal, type RefusalVerdict } from './refusal'
import { recordModerationRefusal } from './refusal-ledger'
import { resolveUncensoredImageUnderstudy } from './understudy'

const logger = createServiceLogger('ConciergeImageFailover')

/** The fields of a profile the trail and the announcement read. */
export interface FailoverProfile {
  id: string
  name: string
  provider: string
  modelName: string
}

export interface ImageFailoverContext<P extends FailoverProfile = ImageProfile> {
  userId: string
  /** Announcements need it; the dialog may have none. */
  chatId?: string | null
  purpose: 'tool' | 'lantern' | 'avatar' | 'dialog'
  /** Already resolved WITH the chat where there is one. */
  settings: DangerousContentSettings
  /**
   * The chat's Concierge state when the call began, where there is a chat. A
   * Locked chat never fails over, whatever the mode says. At refusal time the
   * chokepoint re-reads the chat (by `chatId`) and uses this only if that read
   * fails. Absent (the dialog) reads as Moderated.
   */
  chat?: { conciergeMode?: ConciergeState | null } | null
  /**
   * Who could stand in, excluding the given ids. Defaults to
   * `resolveUncensoredImageUnderstudy`. The legacy dialog, which still draws
   * from connection profiles, supplies its own.
   */
  resolveUnderstudy?: (exclude: string[]) => Promise<{ profile: P; apiKey: string } | null>
  /** How the trail labels the profiles. Default `'image'`. */
  profileKind?: 'connection' | 'image'
  /**
   * How the primary came to be asked. `'concierge'` when a pre-flight
   * classifier reroute already swapped it in; default `'primary'`.
   */
  primaryVia?: RouteAttemptVia
}

export interface ImageFailoverOutcome<T, P extends FailoverProfile = ImageProfile> {
  result: T
  /** The profile that answered. */
  profile: P
  apiKey: string
  rerouted: boolean
  /** Empty when the primary answered first time; otherwise ends with the answering row. */
  trail: RouteAttempt[]
}

/** An error rethrown by the chokepoint, carrying what was tried. */
export type ConciergeTrailError = Error & { conciergeTrail?: RouteAttempt[] }

/** The trail a failed image call carried out of the chokepoint, if any. */
export function getConciergeTrail(error: unknown): RouteAttempt[] | null {
  if (error && typeof error === 'object' && Array.isArray((error as ConciergeTrailError).conciergeTrail)) {
    const trail = (error as ConciergeTrailError).conciergeTrail!
    return trail.length > 0 ? trail : null
  }
  return null
}

function attachTrail(error: unknown, trail: RouteAttempt[]): unknown {
  if (error && typeof error === 'object') {
    try {
      ;(error as ConciergeTrailError).conciergeTrail = [...trail]
      return error
    } catch {
      // A frozen error: fall through and wrap it.
    }
  }
  const wrapped: ConciergeTrailError = new Error(getErrorMessage(error))
  wrapped.conciergeTrail = [...trail]
  return wrapped
}

const DETAIL_MAX = 200

function truncate(text: string | undefined): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return trimmed.length > DETAIL_MAX ? `${trimmed.slice(0, DETAIL_MAX - 1)}…` : trimmed
}

function row(
  profile: FailoverProfile,
  profileKind: 'connection' | 'image',
  via: RouteAttemptVia,
  outcome: RouteAttempt['outcome'],
  extra: Pick<RouteAttempt, 'trigger' | 'evidence' | 'detail'> = {},
): RouteAttempt {
  const detail = truncate(extra.detail)
  return {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    via,
    outcome,
    ...(profileKind === 'image' ? { profileKind } : {}),
    ...(extra.trigger ? { trigger: extra.trigger } : {}),
    ...(extra.evidence ? { evidence: extra.evidence } : {}),
    ...(detail ? { detail } : {}),
  }
}

async function announce(
  ctx: ImageFailoverContext<FailoverProfile>,
  kind: ConciergeRefusalKind,
  refusing: FailoverProfile,
  answeringProfileName?: string,
  reason?: 'locked' | 'mode',
): Promise<void> {
  if (!ctx.chatId) {
    logger.debug('No chat to announce the refusal in', { kind, purpose: ctx.purpose })
    return
  }
  await postConciergeRefusalAnnouncement({
    chatId: ctx.chatId,
    kind,
    details: {
      refusingProvider: refusing.provider,
      refusingModel: refusing.modelName,
      answeringProfileName,
      purpose: ctx.purpose,
      ...(reason ? { reason } : {}),
    },
  })
}

/**
 * Put the primary's refusal on the chat's ledger. The ledger decides whether
 * the evidence counts and whether it earns the auto-switch; a chatless call
 * (the legacy dialog) records nothing. Never throws.
 */
async function ledger(
  ctx: ImageFailoverContext<FailoverProfile>,
  refusing: FailoverProfile,
  verdict: RefusalVerdict,
  rerouted: boolean,
): Promise<void> {
  if (!ctx.chatId) return
  await recordModerationRefusal({
    chatId: ctx.chatId,
    kind: 'image',
    purpose: ctx.purpose,
    refusedProfileId: refusing.id,
    refusedProfileName: refusing.name,
    provider: refusing.provider,
    modelName: refusing.modelName,
    evidence: verdict.evidence,
    rerouted,
  })
}

/**
 * Run an image call, failing over once to an uncensored understudy when the
 * provider refuses on content grounds.
 */
export async function generateImageWithConciergeFailover<T, P extends FailoverProfile = ImageProfile>(
  primary: { profile: P; apiKey: string },
  attempt: (profile: P, apiKey: string) => Promise<T>,
  ctx: ImageFailoverContext<P>,
): Promise<ImageFailoverOutcome<T, P>> {
  const profileKind = ctx.profileKind ?? 'image'
  const primaryVia = ctx.primaryVia ?? 'primary'
  const logContext = {
    purpose: ctx.purpose,
    chatId: ctx.chatId ?? undefined,
    primaryProfileId: primary.profile.id,
    primaryProvider: primary.profile.provider,
    primaryModel: primary.profile.modelName,
  }

  // 1. The primary.
  let primaryError: unknown
  try {
    const result = await attempt(primary.profile, primary.apiKey)
    logger.debug('Image call answered first time', logContext)
    return { result, profile: primary.profile, apiKey: primary.apiKey, rerouted: false, trail: [] }
  } catch (error) {
    primaryError = error
  }

  // 2. Is it the Concierge's business?
  const verdict = classifyRefusal({ error: primaryError })
  if (!verdict.refused) {
    logger.debug('Image call failed for a reason that is not a refusal; rethrowing untouched', {
      ...logContext,
      error: getErrorMessage(primaryError),
    })
    throw primaryError
  }

  // 3. A refusal: the trail's first row.
  const trail: RouteAttempt[] = [
    row(primary.profile, profileKind, primaryVia, 'refused', {
      trigger: 'moderation-refusal',
      evidence: verdict.evidence,
      detail: verdict.detail,
    }),
  ]
  logger.info('Image provider refused on content grounds', {
    ...logContext,
    evidence: verdict.evidence,
    detail: verdict.detail,
    mode: ctx.settings.mode,
  })

  // 4. The caller's policy, stated here where a reader can see it: a Locked
  //    chat never fails over, and otherwise failover obeys Auto-Route. The
  //    state is read now, not when the call began: the operator may have
  //    locked the chat while the provider was thinking.
  const conciergeState = await readCurrentConciergeState(ctx.chatId, getConciergeState(ctx.chat))
  if (!conciergeStateMayFailOver(conciergeState)) {
    logger.info('Refusal not rerouted: the chat is Locked', {
      ...logContext,
      conciergeState,
    })
    await announce(ctx as ImageFailoverContext<FailoverProfile>, 'refusal-not-permitted', primary.profile, undefined, 'locked')
    await ledger(ctx as ImageFailoverContext<FailoverProfile>, primary.profile, verdict, false)
    throw attachTrail(primaryError, trail)
  }
  if (ctx.settings.mode !== 'AUTO_ROUTE') {
    logger.info('Refusal not rerouted: the Concierge mode does not permit it', {
      ...logContext,
      mode: ctx.settings.mode,
    })
    await announce(ctx as ImageFailoverContext<FailoverProfile>, 'refusal-not-permitted', primary.profile)
    await ledger(ctx as ImageFailoverContext<FailoverProfile>, primary.profile, verdict, false)
    throw attachTrail(primaryError, trail)
  }

  // 5. Who could stand in?
  const exclude = [primary.profile.id]
  const understudy = ctx.resolveUnderstudy
    ? await ctx.resolveUnderstudy(exclude)
    : ((await resolveUncensoredImageUnderstudy({
        userId: ctx.userId,
        settings: ctx.settings,
        exclude,
      })) as { profile: P; apiKey: string } | null)

  if (!understudy) {
    logger.warn('Refusal not rerouted: no uncensored understudy is available', logContext)
    await announce(ctx as ImageFailoverContext<FailoverProfile>, 'refusal-no-understudy', primary.profile)
    await ledger(ctx as ImageFailoverContext<FailoverProfile>, primary.profile, verdict, false)
    throw attachTrail(primaryError, trail)
  }

  // 6. One more try.
  logger.info('Rerouting a refused image call to an uncensored understudy', {
    ...logContext,
    understudyProfileId: understudy.profile.id,
    understudyName: understudy.profile.name,
    understudyProvider: understudy.profile.provider,
    understudyModel: understudy.profile.modelName,
  })
  try {
    const result = await attempt(understudy.profile, understudy.apiKey)
    trail.push(row(understudy.profile, profileKind, 'concierge', 'answered'))
    logger.info('Uncensored understudy answered a refused image call', {
      ...logContext,
      understudyProfileId: understudy.profile.id,
      understudyName: understudy.profile.name,
    })
    await announce(
      ctx as ImageFailoverContext<FailoverProfile>,
      'refusal-rerouted',
      primary.profile,
      understudy.profile.name,
    )
    await ledger(ctx as ImageFailoverContext<FailoverProfile>, primary.profile, verdict, true)
    return { result, profile: understudy.profile, apiKey: understudy.apiKey, rerouted: true, trail }
  } catch (understudyError) {
    const understudyVerdict = classifyRefusal({ error: understudyError })
    trail.push(
      understudyVerdict.refused
        ? row(understudy.profile, profileKind, 'concierge', 'refused', {
            trigger: 'moderation-refusal',
            evidence: understudyVerdict.evidence,
            detail: understudyVerdict.detail,
          })
        : row(understudy.profile, profileKind, 'concierge', 'failed', {
            trigger: classifyFallbackTrigger(understudyError) ?? 'provider-error',
            detail: getErrorMessage(understudyError),
          }),
    )
    logger.error('Uncensored understudy also failed a refused image call', {
      ...logContext,
      understudyProfileId: understudy.profile.id,
      understudyName: understudy.profile.name,
      understudyRefused: understudyVerdict.refused,
      error: getErrorMessage(understudyError),
    })
    await ledger(ctx as ImageFailoverContext<FailoverProfile>, primary.profile, verdict, false)
    throw attachTrail(understudyError, trail)
  }
}
