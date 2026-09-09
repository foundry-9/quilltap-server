/**
 * Route Trail — the call sheet for one assistant turn.
 *
 * Every connection profile that was *tried* for a message, in the order tried,
 * with why each one stepped aside. This module is the ONLY writer of
 * `StreamingState.routeFailures` / `routeVia` and the only composer of the
 * persisted `routeTrail` column: failures are recorded where they happen (the
 * failover service), and the answering row is composed once at finalization,
 * because the primary's "success" is only known after the empty-body check has
 * run.
 *
 * The trail deliberately overlaps `FallbackChainResult.attempts` /
 * `summarizeFallbackAttempts`: those are the per-walk transient that feeds the
 * user-facing error text, this is the per-message persisted record. The
 * alternative would be threading chat state into the provider-layer fallback
 * engine, which must stay ignorant of it.
 *
 * @module services/chat-message/route-trail
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { extractFinishReason } from '@/lib/llm/extract-finish-reason'
import { isModerationFinishReason } from '@/lib/llm/moderation-finish-reason'
import type { RouteAttempt, RouteAttemptVia } from '@/lib/schemas/chat.types'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { FallbackTrigger, FallbackCandidateKind } from '@/lib/llm/fallback'
import type { StreamingState } from './types'

const logger = createServiceLogger('RouteTrail')

/** `detail` is a short reason for a human, never the full error body — it can
 *  run long and can carry fragments of the request. */
const DETAIL_MAX = 200

function truncateDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined
  const trimmed = detail.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length > DETAIL_MAX ? `${trimmed.slice(0, DETAIL_MAX - 1)}…` : trimmed
}

/** How a chain candidate came to be offered, in the trail's vocabulary. */
export function viaOf(kind: FallbackCandidateKind): RouteAttemptVia {
  switch (kind) {
    case 'configured':
      return 'understudy'
    case 'tier-pick':
      return 'tier-pick'
    // Unreachable inside a walk — the failing profile is always in
    // `alreadyTried` — but the mapping is total so a future caller is safe.
    case 'primary':
    default:
      return 'primary'
  }
}

/**
 * Append a failed or refused attempt to the turn's trail.
 *
 * Call it at the point the failure is already being logged; the profile is
 * whoever was actually asked, which for the Concierge's uncensored reroute is
 * NOT `state.effectiveProfile` (that swap only happens on success).
 */
export function recordRouteFailure(
  state: StreamingState,
  profile: ConnectionProfile,
  via: RouteAttemptVia,
  outcome: 'failed' | 'refused',
  trigger: FallbackTrigger,
  detail?: string,
  evidence?: 'finish-reason' | 'inferred'
): void {
  const attempt: RouteAttempt = {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    via,
    outcome,
    trigger,
    ...(evidence ? { evidence } : {}),
    ...(truncateDetail(detail) ? { detail: truncateDetail(detail) } : {}),
  }
  state.routeFailures.push(attempt)
  logger.debug('Recorded a route-trail failure', {
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    model: profile.modelName,
    via,
    outcome,
    trigger,
    evidence,
    failuresSoFar: state.routeFailures.length,
  })
}

/** Tag how `state.effectiveProfile` came to hold the turn. Set beside every swap. */
export function setRouteVia(state: StreamingState, via: RouteAttemptVia): void {
  state.routeVia = via
  logger.debug('Route trail: the answering seat changed hands', {
    profileId: state.effectiveProfile.id,
    profileName: state.effectiveProfile.name,
    via,
  })
}

/** The verdict on a call that produced nothing. */
export interface EmptyBodyVerdict {
  outcome: 'failed' | 'refused'
  trigger: 'empty-response' | 'moderation-refusal'
  evidence?: 'finish-reason' | 'inferred'
  detail?: string
}

/**
 * Classify an empty body.
 *
 * A provider that named a moderation stop is testimony: a stated refusal. An
 * empty body on a turn the Concierge had already flagged is the existing
 * code's own reading — it skips the same-profile retry on exactly that basis —
 * so it is recorded as an *inferred* refusal. Anything else is a plain empty
 * response, which is usually transient.
 *
 * **Must be called before `resetStreamingBuffersForSwap`**, which clears
 * `state.rawResponse` — the finish reason lives in there.
 */
export function classifyEmptyBody(
  state: StreamingState,
  contentWasFlaggedDangerous: boolean
): EmptyBodyVerdict {
  const finishReason = extractFinishReason(state.rawResponse)

  if (isModerationFinishReason(finishReason)) {
    return {
      outcome: 'refused',
      trigger: 'moderation-refusal',
      evidence: 'finish-reason',
      detail: `finish_reason: ${finishReason}`,
    }
  }

  if (contentWasFlaggedDangerous) {
    return {
      outcome: 'refused',
      trigger: 'moderation-refusal',
      evidence: 'inferred',
      detail: 'empty response on content the Concierge had flagged',
    }
  }

  // No detail when the provider said nothing about why: "fell over:
  // empty-response (empty response)" is a tooltip repeating itself.
  return {
    outcome: 'failed',
    trigger: 'empty-response',
    ...(finishReason ? { detail: `finish_reason: ${finishReason}` } : {}),
  }
}

/**
 * The value to persist: NULL when nothing failed, else every failure in order
 * followed by the profile that answered.
 *
 * NULL is the whole point of the design — a one-entry trail says nothing the
 * `provider`/`modelName` columns already say, and assistant rows are the
 * largest table in the instance.
 */
export function buildRouteTrail(
  state: StreamingState,
  logContext?: { chatId?: string; messageId?: string }
): RouteAttempt[] | null {
  if (state.routeFailures.length === 0) return null

  const answered: RouteAttempt = {
    profileId: state.effectiveProfile.id,
    profileName: state.effectiveProfile.name,
    provider: state.effectiveProfile.provider,
    modelName: state.effectiveProfile.modelName,
    via: state.routeVia,
    outcome: 'answered',
  }

  const trail = [...state.routeFailures, answered]

  logger.debug('Composed a route trail for the turn', {
    ...logContext,
    length: trail.length,
    trail: trail.map((a) => ({
      profileName: a.profileName,
      via: a.via,
      outcome: a.outcome,
      trigger: a.trigger,
    })),
  })

  return trail
}
