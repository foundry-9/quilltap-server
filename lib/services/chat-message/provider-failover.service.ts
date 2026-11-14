/**
 * Provider Failover Service
 *
 * Two kinds of failover, both landing in the same `StreamingState`:
 *
 *  - **Empty response** — the call succeeded and produced nothing. Retry the
 *    same provider once (usually transient), then, when the Concierge policy
 *    allows failover, the uncensored profile, then the profile's own fallback chain.
 *  - **Hard error** — the call did not succeed at all (auth, rate limit,
 *    network, missing model, 5xx). Walk the profile's fallback chain.
 *
 * Every stand-in — the same-profile retry, the Concierge's uncensored
 * understudy, each step of the fallback chain — is called by `callSubstitute`,
 * and nothing else. It owns everything that depends on which profile is being
 * called: the tools in that provider's shape and tool mode (#181), the image
 * transport budget, the model params, the stream, and the one "did it answer"
 * predicate (prose, or tool calls — #182). The three sites differ only in how
 * they pick the candidate and how they record the attempt.
 *
 * On an answer, `state.effectiveProfile` / `effectiveApiKey` / `effectiveCall`
 * are swapped together. That trio is the seam every downstream stage reads, so
 * finalization, token accounting and the tool loops continue on the stand-in's
 * own profile, tools and message array.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { isCurrentTurnStopped } from '@/lib/chat/turn-control'
import { describeModerationRefusal } from '@/lib/llm/moderation-finish-reason'
import { resolveUncensoredTextUnderstudy } from '@/lib/services/dangerous-content/understudy'
import { classifyRefusal, type RefusalEvidence } from '@/lib/services/dangerous-content/refusal'
import { recordModerationRefusal } from '@/lib/services/dangerous-content/refusal-ledger'
import {
  conciergeStateMayFailOver,
  type ConciergeState,
} from '@/lib/services/dangerous-content/chat-override'
import { readCurrentConciergeOnDuty, readCurrentConciergeState } from '@/lib/services/dangerous-content/current-state'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import { resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import { profileParams } from '@/lib/llm/cheap-llm'
import {
  applyImageTransportBudget,
  collectAttachmentMimeTypes,
} from '@/lib/chat/image-transport-budget'
import {
  buildFallbackChain,
  classifyFallbackTrigger,
  recordAttempt,
  type FallbackAttempt,
  type FallbackContext,
  type FallbackRepos,
} from '@/lib/llm/fallback'
import type { ConnectionProfile, Character } from '@/lib/schemas/types'
import { reanchorMultiCharacterTurn } from '@/lib/chat/multi-character-anchor'
import { profileUsesNamePrefill } from '@/lib/llm/multi-character-prefill'
import { profileRunsThinkingTurn } from '@/lib/plugins/provider-registry'
import type { ResolvedConciergePolicy } from '@/lib/services/dangerous-content/resolver.service'

/**
 * Reads only. `findApiKeyById` is needed on top of the engine's own surface
 * because an understudy's key has to be decrypted before its call goes out.
 */
export type FailoverRepos = FallbackRepos & {
  connections: { findApiKeyById(id: string): Promise<{ key_value: string } | null> }
}

import {
  streamMessage,
  encodeStatusEvent,
  safeEnqueue,
  encodeContentChunk,
  applyReasoningChunk,
  flushReasoningSegment,
} from './streaming.service'
import { detectToolCallsInResponse } from './tool-execution.service'
import type {
  EffectiveCall,
  FormatToolsFor,
  StreamingState,
  TurnCallMessage,
  TurnToolMode,
} from './types'
import { recordRouteFailure, setRouteVia, classifyEmptyBody, viaOf } from './route-trail'

const logger = createServiceLogger('ProviderFailover')

/**
 * Put a refused text turn on the chat's refusal ledger once its recovery has
 * run its course. The ledger drops anything but a stated refusal (an
 * `inferred` one never counts) and decides on the auto-switch. Never throws.
 */
async function recordTextRefusal(
  chatId: string,
  refusing: Pick<ConnectionProfile, 'id' | 'name' | 'provider' | 'modelName'>,
  evidence: RefusalEvidence | undefined,
  rerouted: boolean,
): Promise<void> {
  await recordModerationRefusal({
    chatId,
    kind: 'text',
    purpose: 'chat',
    refusedProfileId: refusing.id,
    refusedProfileName: refusing.name,
    provider: refusing.provider,
    modelName: refusing.modelName,
    evidence,
    rerouted,
  })
}

// ============================================================================
// THE SUBSTITUTE CALL
// ============================================================================

/**
 * What every stand-in call shares for one turn: the primary's call shape (its
 * message array as built, its tools, mode, params and stop sequences), the
 * slate's per-profile tool formatter, and the stream to write into.
 */
export interface FailoverTurn {
  state: StreamingState
  /** The primary's call: the shape `state.effectiveProfile` was sent with. */
  primaryCall: EffectiveCall
  /** Formats the turn's tools for a substitute (`TurnToolSlate.formatToolsFor`). */
  formatToolsFor: FormatToolsFor
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  /** Present re-applies the image transport budget for a substitute (bug 106). */
  repos?: FailoverRepos
}

export interface SubstituteCandidate {
  profile: ConnectionProfile
  apiKey: string
  /**
   * Clear the streaming buffers first: the stand-in's answer *replaces* what
   * came before rather than continuing it. The empty-body path keeps its
   * historical append (there is nothing to replace but reasoning).
   */
  replace: boolean
  /** For the image-budget log only. */
  kind?: string
}

export interface SubstituteResult {
  /** It answered — with prose or with tool calls. */
  answered: boolean
  /**
   * `skipped`: never called — its resolved tool mode differs from the turn's,
   * and the system prompt was built for the turn's (§8 decision 1).
   * `client-gone`: the operator's stream closed mid-call. The walk stops;
   * nothing is recorded as a provider failure.
   */
  outcome: 'answered' | 'empty' | 'error' | 'skipped' | 'client-gone'
  /** The thrown error (`error`), or why the candidate was passed over (`skipped`). */
  error?: unknown
}

/**
 * The one "did it answer" predicate. A response is an answer if it carries
 * prose, or a native tool call — a tool-call-only response goes to the tool
 * loop like the primary's would, never to the next stand-in (#182).
 */
export function responseAnswered(state: StreamingState, provider: string): boolean {
  if (state.fullResponse.trim().length > 0) return true
  if (!state.rawResponse) return false
  return detectToolCallsInResponse(state.rawResponse, provider).length > 0
}

/**
 * The call shape for one profile, or null when it cannot take this turn's
 * shape. The profile already holding the turn keeps its own (that is the
 * same-profile retry); any other gets tools formatted for its provider, the
 * transport budget re-applied for it, and its own params.
 */
async function callShapeFor(profile: ConnectionProfile, turn: FailoverTurn, kind?: string): Promise<EffectiveCall | null> {
  const { state, primaryCall } = turn
  if (profile.id === state.effectiveProfile.id) {
    return state.effectiveCall ?? primaryCall
  }

  const tools = await turn.formatToolsFor(profile)
  if (tools.resolvedToolMode !== primaryCall.toolMode) {
    logger.info('[Failover] Substitute passed over: its tool mode differs from the turn\'s', {
      chatId: turn.chatId,
      profileId: profile.id,
      provider: profile.provider,
      turnToolMode: primaryCall.toolMode,
      substituteToolMode: tools.resolvedToolMode,
    })
    return null
  }

  // The array was built for the primary. The substitute gets the whole
  // transport budget re-applied for its own profile — count, bytes and
  // capability — with the overflow described or omitted with a note (same
  // reference back when nothing changes).
  const budgeted = turn.repos
    ? (await applyImageTransportBudget(primaryCall.messages, profile, {
        repos: turn.repos,
        userId: turn.userId,
        logContext: { chatId: turn.chatId, ...(kind ? { kind } : {}) },
        describeOptions: { chatId: turn.chatId },
      })).messages
    : primaryCall.messages

  // The multi-character anchor was chosen for the primary's profile. A
  // substitute that refuses assistant prefill (Anthropic 4.6+) must not
  // inherit a trailing `[Name]` message, and one that prefills gets it (#217).
  const anchored = reanchorMultiCharacterTurn(
    budgeted,
    turn.character.name,
    profileUsesNamePrefill(
      profile,
      profileRunsThinkingTurn(
        profile.provider,
        profile.modelName,
        profile.parameters as Record<string, unknown> | null | undefined
      )
    ),
  )

  return {
    messages: anchored,
    tools: tools.actualTools,
    toolMode: tools.resolvedToolMode,
    useNativeWebSearch: tools.useNativeWebSearch,
    modelParams: profileParams(profile) ?? {},
    stop: tools.stopSequences,
  }
}

/**
 * Call one stand-in for this turn. The only place a substitute is called.
 *
 * Shapes the call for `candidate.profile`, streams it into `turn.state`, and
 * decides whether it answered. On an answer the profile, key and call shape
 * are installed on the state together; otherwise the state's profile is left
 * alone (the caller records the attempt against the candidate).
 *
 * Never throws: a provider failure comes back as `outcome: 'error'`.
 */
export async function callSubstitute(
  candidate: SubstituteCandidate,
  turn: FailoverTurn,
): Promise<SubstituteResult> {
  const { state } = turn

  let call: EffectiveCall | null
  try {
    call = await callShapeFor(candidate.profile, turn, candidate.kind)
  } catch (error) {
    return { answered: false, outcome: 'error', error }
  }
  if (!call) {
    return {
      answered: false,
      outcome: 'skipped',
      error: new Error(`tool mode differs from the turn's (${turn.primaryCall.toolMode}); not called`),
    }
  }

  if (candidate.replace) resetStreamingBuffersForSwap(state)

  try {
    const streamed = await restreamInto(state, {
      connectionProfile: candidate.profile,
      apiKey: candidate.apiKey,
      call,
      userId: turn.userId,
      chatId: turn.chatId,
      character: turn.character,
      controller: turn.controller,
      encoder: turn.encoder,
      preGeneratedAssistantMessageId: turn.preGeneratedAssistantMessageId,
    })
    if (streamed.clientGone) {
      logger.info('[Failover] The client went away mid-substitute; stopping', {
        chatId: turn.chatId,
        profileId: candidate.profile.id,
        partialLength: state.fullResponse.length,
      })
      return { answered: false, outcome: 'client-gone' }
    }
  } catch (error) {
    return { answered: false, outcome: 'error', error }
  }

  if (!responseAnswered(state, candidate.profile.provider)) {
    return { answered: false, outcome: 'empty' }
  }

  state.effectiveProfile = candidate.profile
  state.effectiveApiKey = candidate.apiKey
  state.effectiveCall = call
  logger.debug('[Failover] Substitute answered', {
    chatId: turn.chatId,
    profileId: candidate.profile.id,
    provider: candidate.profile.provider,
    toolCount: call.tools.length,
    toolMode: call.toolMode,
    responseLength: state.fullResponse.length,
  })
  return { answered: true, outcome: 'answered' }
}

/** The thrown error's message, for the trail and the log. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The primary's call shape, as the turn's callers hand it over. */
interface TurnCallOptions {
  formattedMessages: TurnCallMessage[]
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  /** The turn's resolved tool mode (`TurnToolSlate.resolvedToolMode`). */
  resolvedToolMode: TurnToolMode
  /** `TurnToolSlate.formatToolsFor`: the tools in a substitute's own shape. */
  formatToolsFor: FormatToolsFor
  /** Provider stop sequences the primary was sent with. */
  stop?: string[]
}

function primaryCallOf(opts: TurnCallOptions): EffectiveCall {
  return {
    messages: opts.formattedMessages,
    tools: opts.actualTools,
    toolMode: opts.resolvedToolMode,
    useNativeWebSearch: opts.useNativeWebSearch,
    modelParams: opts.modelParams,
    stop: opts.stop,
  }
}

// ============================================================================
// EMPTY RESPONSE
// ============================================================================

export interface AttemptEmptyResponseRecoveryOptions extends TurnCallOptions {
  state: StreamingState
  toolMessagesLength: number
  contentWasFlaggedDangerous: boolean
  conciergePolicy: ResolvedConciergePolicy
  /**
   * The chat's Concierge state when the turn began. A Locked chat never
   * reroutes a refusal to the uncensored desk, whatever the policy says. The
   * chat is re-read at refusal time; this is used only if that read fails.
   * Absent reads as Moderated.
   */
  conciergeState?: ConciergeState
  connectionProfile: ConnectionProfile
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  /**
   * Reads only. Present enables the third and last recovery step: the
   * effective profile's own fallback chain. Optional so a caller that has no
   * repository handle (tests, and any future path that only wants the local
   * retries) keeps today's two-step behaviour.
   */
  repos?: FailoverRepos
  /** Capability flags for the chain. Required alongside `repos`. */
  fallbackContext?: Omit<FallbackContext, 'userId' | 'purpose' | 'alreadyTried'>
}

export interface EmptyResponseRecoveryFlags {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  /** Whether the profile's fallback chain was walked after the two local
   *  retries came back empty. */
  chainFallbackAttempted: boolean
  /** The failed attempts from that chain walk, for the log and the message. */
  chainAttempts: FallbackAttempt[]
  /**
   * Some retry or stand-in answered — with prose or with tool calls. The
   * caller runs the tool loops again: an answer that is only a tool call has
   * not been acted on yet (#182).
   */
  recovered: boolean
  /** The client went away mid-retry; the walk stopped there. */
  clientGone: boolean
}

/**
 * Attempt to recover from an empty assistant response.
 * Mutates `state` directly — the caller reads updated values from the same object.
 */
export async function attemptEmptyResponseRecovery(
  opts: AttemptEmptyResponseRecoveryOptions,
): Promise<EmptyResponseRecoveryFlags> {
  const {
    state,
    toolMessagesLength,
    contentWasFlaggedDangerous,
    conciergePolicy,
    conciergeState,
    userId,
    chatId,
    character,
    controller,
    encoder,
    repos,
    fallbackContext,
  } = opts
  const turn: FailoverTurn = {
    state,
    primaryCall: primaryCallOf(opts),
    formatToolsFor: opts.formatToolsFor,
    userId,
    chatId,
    character,
    controller,
    encoder,
    preGeneratedAssistantMessageId: opts.preGeneratedAssistantMessageId,
    repos,
  }

  let uncensoredRetryAttempted = false
  let sameProviderRetryAttempted = false
  let recovered = false
  let clientGone = false

  // Profiles this recovery has already spent. The chain walk at the bottom
  // reads it so a route that has already come back empty isn't asked twice.
  const triedProfileIds: string[] = []

  const flags = (): EmptyResponseRecoveryFlags => ({
    uncensoredRetryAttempted,
    sameProviderRetryAttempted,
    chainFallbackAttempted: false,
    chainAttempts: [],
    recovered,
    clientGone,
  })

  // The operator stopped the turn: an empty reply is what they asked for, not
  // a failure to recover from. Never re-ask the model behind their back.
  if (isCurrentTurnStopped()) {
    logger.info('Skipping empty-response recovery: the operator stopped the turn', { chatId })
    return flags()
  }

  if (state.fullResponse.trim().length !== 0 || toolMessagesLength > 0) {
    return flags()
  }

  // The call that opened this recovery produced nothing. Record it on the
  // turn's route trail once, here, while `state.rawResponse` still holds the
  // finish reason that tells a stated refusal from a plain empty body —
  // `resetStreamingBuffersForSwap` clears it further down the chain.
  //
  // `state.routeVia` is whatever the effective profile already was: 'primary'
  // normally, 'concierge' when the Concierge's *pre-call* reroute installed
  // this profile before anything was tried.
  const openingVerdict = classifyEmptyBody(state, contentWasFlaggedDangerous)
  recordRouteFailure(state, state.effectiveProfile, state.routeVia, openingVerdict.outcome,
    openingVerdict.trigger, openingVerdict.detail, openingVerdict.evidence)
  const openingProfile = state.effectiveProfile
  let uncensoredRecovered = false
  // The turn's refusal, for the chat's ledger: the opening verdict, or — when
  // the opening was a plain empty body — a refusal the same-provider retry
  // then stated. One per turn either way. Recorded on the way out so the log
  // can say whether the Concierge's reroute answered.
  let turnRefusal: { profile: typeof openingProfile; evidence: typeof openingVerdict.evidence } | null =
    openingVerdict.outcome === 'refused' ? { profile: openingProfile, evidence: openingVerdict.evidence } : null
  const recordOpeningRefusal = async (): Promise<void> => {
    if (!turnRefusal) return
    await recordTextRefusal(chatId, turnRefusal.profile, turnRefusal.evidence, uncensoredRecovered)
  }

  if (!contentWasFlaggedDangerous) {
    sameProviderRetryAttempted = true
    triedProfileIds.push(state.effectiveProfile.id)
    logger.warn('[EmptyResponse] Empty response from provider that passed moderation, retrying same provider', {
      chatId,
      provider: state.effectiveProfile.provider,
      model: state.effectiveProfile.modelName,
    })

    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'retrying',
      message: 'Empty response received — retrying...',
      characterName: character.name,
      characterId: character.id,
    }))

    const retry = await callSubstitute(
      { profile: state.effectiveProfile, apiKey: state.effectiveApiKey, replace: false },
      turn,
    )

    if (retry.answered) {
      recovered = true
      setRouteVia(state, 'retry')
      logger.info('[EmptyResponse] Same-provider retry succeeded', {
        chatId,
        provider: state.effectiveProfile.provider,
        model: state.effectiveProfile.modelName,
        responseLength: state.fullResponse.length,
      })
    } else if (retry.outcome === 'client-gone') {
      clientGone = true
      await recordOpeningRefusal()
      return flags()
    } else if (retry.outcome === 'error') {
      const retryMessage = messageOf(retry.error)
      recordRouteFailure(state, state.effectiveProfile, 'retry', 'failed',
        classifyFallbackTrigger(retry.error) ?? 'provider-error', retryMessage)
      logger.error('[EmptyResponse] Same-provider retry failed', {
        chatId,
        error: retryMessage,
      })
    } else {
      // Classify BEFORE anything downstream resets the buffers: the finish
      // reason that tells a refusal from a plain empty body lives in
      // `state.rawResponse`, which `resetStreamingBuffersForSwap` clears.
      const retryVerdict = classifyEmptyBody(state, contentWasFlaggedDangerous)
      recordRouteFailure(state, state.effectiveProfile, 'retry', retryVerdict.outcome,
        retryVerdict.trigger, retryVerdict.detail, retryVerdict.evidence)
      if (!turnRefusal && retryVerdict.outcome === 'refused') {
        turnRefusal = { profile: state.effectiveProfile, evidence: retryVerdict.evidence }
      }
      logger.warn('[EmptyResponse] Same-provider retry also returned empty', {
        chatId,
        provider: state.effectiveProfile.provider,
        model: state.effectiveProfile.modelName,
      })
    }
  }

  // Read at refusal time, not when the turn began: the operator may have
  // locked the chat while the provider was thinking.
  const lockedOut = !recovered
    && !conciergeStateMayFailOver(await readCurrentConciergeState(chatId, conciergeState))
  if (!recovered && lockedOut && turnRefusal) {
    // A Locked chat's refusal stands. Say so, once, and let the ordinary
    // chain below have its turn.
    logger.info('[EmptyResponse] Refusal not rerouted: the chat is Locked', {
      chatId,
      provider: turnRefusal.profile.provider,
      model: turnRefusal.profile.modelName,
    })
    await postConciergeRefusalAnnouncement({
      chatId,
      kind: 'refusal-not-permitted',
      details: {
        refusingProvider: turnRefusal.profile.provider,
        refusingModel: turnRefusal.profile.modelName,
        purpose: 'text',
        reason: 'locked',
      },
    })
  }

  // The policy was resolved when the turn began; the Concierge may have been
  // sent off duty since. Only asked when there is a refusal to act on.
  if (
    !recovered && !lockedOut && conciergePolicy.failoverAllowed
    && await readCurrentConciergeOnDuty(userId, conciergePolicy.onDuty)
  ) {
    const uncensored = await attemptUncensoredRetry({
      turn,
      conciergePolicy,
      alreadyTried: triedProfileIds,
      contentWasFlaggedDangerous,
      refusalWasStated: openingVerdict.outcome === 'refused',
      replace: false,
    })
    uncensoredRetryAttempted = uncensored.attempted
    uncensoredRecovered = uncensored.recovered
    if (uncensored.recovered) recovered = true
    if (uncensored.understudyId) triedProfileIds.push(uncensored.understudyId)
    if (uncensored.clientGone) {
      clientGone = true
      await recordOpeningRefusal()
      return flags()
    }
  }

  // Third and last: the effective profile's own fallback chain.
  //
  // Deliberately last. An empty body is usually transient (the same-profile
  // retry above catches that), and when it isn't it is usually a refusal —
  // a *content* problem, which the uncensored reroute exists to answer. Only
  // once both have come back empty is it worth concluding the route itself is
  // no good and calling for the understudy.
  //
  // Note `state.effectiveProfile` may by now be the uncensored profile: it is
  // a connection profile like any other and carries its own understudy, whose
  // chain then runs with `dangerous: true` so tier picks stay cleared for the
  // content.
  if (!recovered && repos && fallbackContext) {
    const chainResult = await attemptEmptyResponseChainFallback({
      turn,
      repos,
      context: {
        ...fallbackContext,
        userId,
        purpose: 'chat',
        // An uncensored reroute already happened, or the content was flagged:
        // either way a stand-in must be cleared for this content.
        dangerous: fallbackContext.dangerous || uncensoredRetryAttempted || contentWasFlaggedDangerous,
        alreadyTried: triedProfileIds,
      },
    })

    await recordOpeningRefusal()
    return {
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
      chainFallbackAttempted: true,
      chainAttempts: chainResult.attempts,
      recovered: chainResult.recovered,
      clientGone: chainResult.clientGone === true,
    }
  }

  await recordOpeningRefusal()
  return flags()
}

export interface AttemptUncensoredRetryOptions {
  turn: FailoverTurn
  conciergePolicy: ResolvedConciergePolicy
  /** Profile ids already spent on this call; the understudy is never one of them. */
  alreadyTried: string[]
  /** Passed to the empty-body classifier when the understudy comes back empty. */
  contentWasFlaggedDangerous: boolean
  /**
   * Whether the failure that opened this retry was a stated or inferred
   * content refusal. Only then does "nobody to ask" earn the Concierge's
   * `refusal-no-understudy` bubble — the one text case the user can act on.
   */
  refusalWasStated: boolean
  /**
   * Clear the streaming buffers before the understudy streams. The hard-error
   * path needs it (the primary may have left reasoning behind); the empty-body
   * path keeps its historical append.
   */
  replace: boolean
}

export interface UncensoredRetryResult {
  /** An understudy was found and asked. */
  attempted: boolean
  /** It answered; `state` now holds its response and it is the effective profile. */
  recovered: boolean
  /** The understudy that was asked, for the caller's loop guard. */
  understudyId?: string
  /** The client went away mid-call; the caller stops its walk. */
  clientGone?: boolean
}

/**
 * Ask the Concierge's uncensored understudy to take a turn the effective
 * profile refused or left empty.
 *
 * The *policy* — `conciergePolicy.failoverAllowed` only — is the caller's,
 * stated at its call site.
 * This function asks `resolveUncensoredTextUnderstudy` (the configured
 * uncensored profile, else any `isDangerousCompatible` one), excluding every
 * profile already tried, calls it through `callSubstitute`, and records the
 * outcome on the route trail. Used by the empty-body recovery and by the
 * hard-error failover when the error was a content refusal.
 */
export async function attemptUncensoredRetry(
  opts: AttemptUncensoredRetryOptions
): Promise<UncensoredRetryResult> {
  const { turn, conciergePolicy, alreadyTried, contentWasFlaggedDangerous, refusalWasStated, replace } = opts
  const { state, userId, chatId, character, controller, encoder } = turn

  const understudy = await resolveUncensoredTextUnderstudy({
    userId,
    conciergePolicy,
    exclude: [...alreadyTried, state.effectiveProfile.id],
    // What the array is actually carrying, so the scan does not offer a
    // substitute the payload rules out (bug 106).
    turnAttachmentMimeTypes: collectAttachmentMimeTypes(turn.primaryCall.messages),
  })

  if (!understudy) {
    logger.warn('[DangerousContent] No uncensored understudy to retry this turn with', {
      chatId,
      provider: state.effectiveProfile.provider,
      model: state.effectiveProfile.modelName,
      refusalWasStated,
    })
    if (refusalWasStated) {
      await postConciergeRefusalAnnouncement({
        chatId,
        kind: 'refusal-no-understudy',
        details: {
          refusingProvider: state.effectiveProfile.provider,
          refusingModel: state.effectiveProfile.modelName,
          purpose: 'text',
        },
      })
    }
    return { attempted: false, recovered: false }
  }

  const reroute = understudy.profile
  logger.warn('[DangerousContent] Attempting uncensored retry', {
    chatId,
    originalProvider: state.effectiveProfile.provider,
    originalModel: state.effectiveProfile.modelName,
    uncensoredProfileId: reroute.id,
    uncensoredProvider: reroute.provider,
    uncensoredModel: reroute.modelName,
    contentWasFlaggedDangerous,
    refusalWasStated,
  })

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'rerouting',
    message: 'Retrying with uncensored provider...',
    characterName: character.name,
    characterId: character.id,
  }))

  // Captured before the call: on an answer `callSubstitute` swaps the state
  // to the understudy, and the log below names the profile that refused.
  const refusing = state.effectiveProfile
  const result = await callSubstitute(
    { profile: reroute, apiKey: understudy.apiKey, replace, kind: 'concierge' },
    turn,
  )

  if (result.answered) {
    setRouteVia(state, 'concierge')
    logger.info('[DangerousContent] Uncensored retry succeeded', {
      chatId,
      uncensoredProvider: reroute.provider,
      uncensoredModel: reroute.modelName,
      responseLength: state.fullResponse.length,
    })
    return { attempted: true, recovered: true, understudyId: reroute.id }
  }

  if (result.outcome === 'client-gone') {
    return { attempted: true, recovered: false, understudyId: reroute.id, clientGone: true }
  }

  // Recorded from `reroute`, NOT from `state`: the swap only happens on an
  // answer, so an uncensored profile that fails is otherwise absent from
  // every record — and this row is precisely the one the user asked for.
  if (result.outcome === 'empty') {
    // Classified here, before anything resets the buffers.
    const verdict = classifyEmptyBody(state, contentWasFlaggedDangerous)
    recordRouteFailure(state, reroute, 'concierge', verdict.outcome, verdict.trigger,
      verdict.detail, verdict.evidence)
    logger.error('[DangerousContent] Both safe and uncensored providers returned empty', {
      chatId,
      safeProvider: refusing.provider,
      safeModel: refusing.modelName,
      uncensoredProvider: reroute.provider,
      uncensoredModel: reroute.modelName,
    })
  } else if (result.outcome === 'skipped') {
    recordRouteFailure(state, reroute, 'concierge', 'failed', 'provider-error', messageOf(result.error))
  } else {
    const retryMessage = messageOf(result.error)
    const refusal = classifyRefusal({ error: result.error })
    if (refusal.refused) {
      recordRouteFailure(state, reroute, 'concierge', 'refused', 'moderation-refusal',
        refusal.detail ?? retryMessage, refusal.evidence)
    } else {
      recordRouteFailure(state, reroute, 'concierge', 'failed',
        classifyFallbackTrigger(result.error) ?? 'provider-error', retryMessage)
    }
    logger.error('[DangerousContent] Uncensored retry failed', {
      chatId,
      error: retryMessage,
    })
  }

  if (replace) resetStreamingBuffersForSwap(state)
  return { attempted: true, recovered: false, understudyId: reroute.id }
}

export function getEmptyResponseReason({
  uncensoredRetryAttempted,
  sameProviderRetryAttempted,
  contentWasFlaggedDangerous,
  chainAttempts = [],
  finishReason,
  provider,
  modelName,
}: {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  contentWasFlaggedDangerous: boolean
  /** Failed attempts from the fallback chain, when one was walked. */
  chainAttempts?: FallbackAttempt[]
  /** Provider-reported finish reason from the final chunk, when known. */
  finishReason?: string | null
  provider?: string
  modelName?: string
}): string {
  // The understudies get named first when there were any: "and the stand-ins
  // failed too" is the part that tells the user where to look, and it would be
  // lost inside the generic advice below.
  const understudies = chainAttempts.slice(1)
  const understudyRoll =
    understudies.length > 0
      ? ` The fallback chain was tried as well: ${understudies
          .map((a) => `${a.profileName} (${a.trigger})`)
          .join(', ')}.`
      : ''
  // A provider that named its refusal outright gets to say so. Everything
  // below this point is inference from an empty body; this is testimony, and
  // it changes the advice — "try resending" is wrong for a moderation stop
  // (bug 93).
  const refusal = describeModerationRefusal(finishReason, provider ?? 'The provider', modelName ?? 'model')
  if (refusal) {
    if (uncensoredRetryAttempted) {
      return `${refusal} An uncensored provider was tried as well and also returned empty.${understudyRoll}`
    }
    return `${refusal}${understudyRoll}`
  }

  if (uncensoredRetryAttempted && sameProviderRetryAttempted) {
    return `The AI model returned an empty response after retrying, and an uncensored provider also returned empty. This may indicate the content was filtered by both providers.${understudyRoll}`
  }

  if (uncensoredRetryAttempted) {
    return `The AI model returned an empty response, and retrying with an uncensored provider also returned empty. This may indicate the content was filtered by both providers.${understudyRoll}`
  }

  if (contentWasFlaggedDangerous) {
    return `The AI model returned an empty response, likely because the Concierge flagged this content as dangerous and the provider refused to generate a response. Consider configuring an uncensored text profile in the Concierge settings so refused content can be rerouted to an uncensored provider.${understudyRoll}`
  }

  if (sameProviderRetryAttempted) {
    return `The AI model returned an empty response twice. This may be a temporary issue with the provider. Please try resending your message.${understudyRoll}`
  }

  return `The AI model returned an empty response. This is a known issue with some providers. Please try resending your message.${understudyRoll}`
}

interface RestreamOptions {
  connectionProfile: ConnectionProfile
  apiKey: string
  /** The call shape for `connectionProfile` (`callShapeFor`). */
  call: EffectiveCall
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
}

/**
 * Re-stream a response into the mutable StreamingState.
 *
 * Appends to `state.fullResponse` rather than replacing it. Callers that are
 * *substituting* a response rather than continuing one must clear the
 * streaming buffers first — see `resetStreamingBuffersForSwap`.
 *
 * Every frame goes through `safeEnqueue`. A closed controller is the client
 * going away, not the provider failing: the stream stops and reports
 * `clientGone`, with whatever arrived kept in the buffers for the partial
 * preserver, instead of throwing into a failover site that would read it as a
 * provider error.
 */
async function restreamInto(
  state: StreamingState,
  opts: RestreamOptions
): Promise<{ clientGone: boolean }> {
  for await (const chunk of streamMessage({
    messages: opts.call.messages,
    connectionProfile: opts.connectionProfile,
    apiKey: opts.apiKey,
    modelParams: opts.call.modelParams,
    tools: opts.call.tools,
    useNativeWebSearch: opts.call.useNativeWebSearch,
    userId: opts.userId,
    messageId: opts.preGeneratedAssistantMessageId,
    chatId: opts.chatId,
    characterId: opts.character.id,
    stop: opts.call.stop,
  })) {
    applyReasoningChunk(state, chunk, opts.controller, opts.encoder)
    if (chunk.content) {
      // Buffered before it is sent: a chunk the provider produced is kept for
      // the partial preserver even when nobody is left to read it.
      let delivered = true
      if (!state.hasStartedStreaming) {
        delivered = safeEnqueue(opts.controller, encodeStatusEvent(opts.encoder, {
          stage: 'streaming',
          message: `${opts.character.name} is responding...`,
          characterName: opts.character.name,
          characterId: opts.character.id,
        })) !== false
        state.hasStartedStreaming = true
      }
      flushReasoningSegment(state)
      state.fullResponse += chunk.content
      if (delivered) {
        delivered = safeEnqueue(opts.controller, encodeContentChunk(opts.encoder, chunk.content)) !== false
      }
      if (!delivered) return { clientGone: true }
    }

    if (chunk.done) {
      state.usage = chunk.usage || null
      state.cacheUsage = chunk.cacheUsage || null
      state.attachmentResults = chunk.attachmentResults || null
      state.rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) {
        state.thoughtSignature = chunk.thoughtSignature
      }
      flushReasoningSegment(state)
    }
  }
  return { clientGone: false }
}

// ============================================================================
// FALLBACK CHAINS
// ============================================================================

/**
 * Clear the streaming buffers so a re-stream *substitutes* a response instead
 * of continuing one.
 *
 * `restreamInto` appends, which is right when it is retrying a call that
 * produced nothing. A chain walk is different: the failed attempt may have
 * left reasoning in the buffers before it died, and the understudy's answer
 * must not be glued onto the corpse of the one before it.
 *
 * Reasoning is display-only and the client replaces its buffer wholesale on
 * each cumulative update, so clearing it server-side and re-streaming lands
 * correctly on the client too.
 */
function resetStreamingBuffersForSwap(state: StreamingState): void {
  state.fullResponse = ''
  state.usage = null
  state.cacheUsage = null
  state.attachmentResults = null
  state.rawResponse = undefined
  state.thoughtSignature = undefined
  state.reasoningContent = ''
  state.reasoningSegments = []
  state.reasoningFlushedLen = 0
}

interface WalkFallbackChainOptions {
  turn: FailoverTurn
  /**
   * Reads only. `findApiKeyById` is needed on top of the engine's own surface
   * because an understudy's key has to be decrypted before its call goes out.
   */
  repos: FailoverRepos
  /**
   * Everything a stand-in needs from this call.
   *
   * `context.alreadyTried` matters more here than it looks: the
   * empty-response path may have burned the uncensored profile before the
   * chain is even reached, and a chain that re-offered it would spend a whole
   * attempt re-learning what it already knows. The failing profile itself is
   * added by the walk, so callers need only list the *extra* ones.
   */
  context: FallbackContext
}

export interface FallbackChainResult {
  /** True when some understudy answered; `state` now holds their response. */
  recovered: boolean
  /** Every failed attempt in order, starting with the profile that opened the
   *  chain. Empty when no chain was walked at all. */
  attempts: FallbackAttempt[]
  /** Whether the chain offered an auto-picked tier candidate. Feeds the
   *  "no tier replacement qualified" half of the user-facing summary. */
  tierPickWasOffered: boolean
  /** The client went away mid-call; the walk stopped without calling anyone else. */
  clientGone?: boolean
}

/**
 * Walk a profile's fallback chain, calling each candidate through
 * `callSubstitute` until one answers.
 *
 * `openingFailure` is the attempt that sent us here — the primary's error, or
 * its empty response. It leads the attempt trail and seeds the loop guard, so
 * the chain never re-offers the profile that just failed.
 *
 * On exhaustion the buffers are left empty — a stray fragment from a dead
 * understudy is not this character's words.
 */
async function walkFallbackChain(
  opts: WalkFallbackChainOptions,
  openingFailure: FallbackAttempt
): Promise<FallbackChainResult> {
  const { turn, repos, context } = opts
  const { state, chatId, character, controller, encoder } = turn

  const failedProfile = state.effectiveProfile
  const attempts: FallbackAttempt[] = [openingFailure]

  const chain = await buildFallbackChain(failedProfile, repos, {
    ...context,
    alreadyTried: [...context.alreadyTried, failedProfile.id],
  })

  const tierPickWasOffered = chain.some((c) => c.kind === 'tier-pick')

  for (const candidate of chain) {
    const understudy = candidate.profile
    const via = viaOf(candidate.kind)

    const keyResolution = await resolveConnectionProfileApiKey(repos, understudy)
    if (!keyResolution.ok) {
      logger.warn('[Failover] Understudy has no usable API key; moving on', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        reason: keyResolution.reason,
      })
      attempts.push(recordAttempt(understudy, 'auth', new Error(keyResolution.reason)))
      recordRouteFailure(state, understudy, via, 'failed', 'auth', keyResolution.reason)
      continue
    }

    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'failing-over',
      message: `${understudy.name} is standing in for ${character.name}...`,
      characterName: character.name,
      characterId: character.id,
    }))

    const result = await callSubstitute(
      { profile: understudy, apiKey: keyResolution.apiKey, replace: true, kind: candidate.kind },
      turn,
    )

    if (result.answered) {
      setRouteVia(state, via)
      logger.info('[Failover] Understudy answered', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        provider: understudy.provider,
        model: understudy.modelName,
        kind: candidate.kind,
        responseLength: state.fullResponse.length,
        failedAttemptsBefore: attempts.length,
      })
      return { recovered: true, attempts, tierPickWasOffered }
    }

    if (result.outcome === 'client-gone') {
      // Nobody is listening: calling the next stand-in would spend a paid
      // call on an empty room, and this one did not fail. What arrived stays
      // in the buffers for the partial preserver.
      return { recovered: false, attempts, tierPickWasOffered, clientGone: true }
    }

    if (result.outcome === 'empty') {
      attempts.push(recordAttempt(understudy, 'empty-response', new Error('empty response')))
      // Classified HERE, before the next iteration's `resetStreamingBuffersForSwap`
      // wipes `state.rawResponse` — that is where the finish reason lives, and
      // it is the only thing that tells a stated refusal from a blank body.
      const understudyVerdict = classifyEmptyBody(state, context.dangerous)
      recordRouteFailure(state, understudy, via, understudyVerdict.outcome,
        understudyVerdict.trigger, understudyVerdict.detail, understudyVerdict.evidence)
      logger.warn('[Failover] Understudy returned an empty response', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        kind: candidate.kind,
      })
      continue
    }

    // `error` or `skipped`: the call failed, or was never made.
    const understudyTrigger = result.outcome === 'skipped'
      ? 'provider-error'
      : classifyFallbackTrigger(result.error) ?? 'provider-error'
    const understudyMessage = messageOf(result.error)
    attempts.push(recordAttempt(understudy, understudyTrigger, result.error))
    recordRouteFailure(state, understudy, via, 'failed', understudyTrigger, understudyMessage)
    logger.warn(result.outcome === 'skipped'
      ? '[Failover] Understudy passed over'
      : '[Failover] Understudy also failed', {
      chatId,
      understudyId: understudy.id,
      understudyName: understudy.name,
      provider: understudy.provider,
      model: understudy.modelName,
      kind: candidate.kind,
      trigger: understudyTrigger,
      error: understudyMessage,
    })
  }

  logger.error('[Failover] Fallback chain exhausted', {
    chatId,
    profileId: failedProfile.id,
    purpose: context.purpose,
    tierPickWasOffered,
    attempts: attempts.map((a) => ({
      profileName: a.profileName,
      provider: a.provider,
      trigger: a.trigger,
    })),
  })

  resetStreamingBuffersForSwap(state)

  return { recovered: false, attempts, tierPickWasOffered }
}

// ============================================================================
// HARD ERROR
// ============================================================================

export interface AttemptHardErrorFailoverOptions extends TurnCallOptions {
  state: StreamingState
  /** Reads only; see `WalkFallbackChainOptions.repos`. */
  repos: FailoverRepos
  /** See `WalkFallbackChainOptions.context`. */
  context: FallbackContext
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  /** The error that ended the primary attempt. */
  error: unknown
  /**
   * The Concierge policy for this chat. When the error is a content refusal
   * and the policy allows failover, the uncensored understudy is tried before
   * the chain. Absent means no uncensored retry.
   */
  conciergePolicy?: ResolvedConciergePolicy
  /**
   * The chat's Concierge state when the turn began. A Locked chat never
   * reroutes a refusal to the uncensored desk, whatever the policy says. The
   * chat is re-read at refusal time; this is used only if that read fails.
   * Absent reads as Moderated.
   */
  conciergeState?: ConciergeState
}

/**
 * Walk the effective profile's fallback chain after a hard error.
 *
 * Returns `recovered: false` with no attempts when the failure is not
 * fallback-eligible — a token-limit overrun, a tool-unsupported rejection, one
 * of our own validation bugs — so the caller rethrows exactly as it did before
 * this feature existed.
 *
 * **Only runs before the first content chunk.** Once prose has reached the
 * user, a partial answer is worth more than a substituted one: the client has
 * already rendered the text, and `preservePartialOnError` will save it with an
 * OOC marker explaining the abrupt end. Nearly every hard error worth failing
 * over for — auth, rate limit, model-missing, connection refused — arrives
 * before a single token does.
 */
export async function attemptHardErrorFailover(
  opts: AttemptHardErrorFailoverOptions
): Promise<FallbackChainResult> {
  const { state, error, chatId, context, repos } = opts
  const trigger = classifyFallbackTrigger(error)

  if (!trigger) {
    logger.debug('[Failover] Error is not fallback-eligible; leaving it to the caller', {
      chatId,
      profileId: state.effectiveProfile.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    return { recovered: false, attempts: [], tierPickWasOffered: false }
  }

  if (state.hasStartedStreaming) {
    logger.info('[Failover] Skipping chain: content already reached the user', {
      chatId,
      profileId: state.effectiveProfile.id,
      trigger,
      partialLength: state.fullResponse.length,
    })
    return { recovered: false, attempts: [], tierPickWasOffered: false }
  }

  const turn: FailoverTurn = {
    state,
    primaryCall: primaryCallOf(opts),
    formatToolsFor: opts.formatToolsFor,
    userId: context.userId,
    chatId,
    character: opts.character,
    controller: opts.controller,
    encoder: opts.encoder,
    preGeneratedAssistantMessageId: opts.preGeneratedAssistantMessageId,
    repos,
  }
  const walk = (walkContext: FallbackContext, opening: FallbackAttempt) =>
    walkFallbackChain({ turn, repos, context: walkContext }, opening)

  const failureMessage = messageOf(error)

  logger.warn('[Failover] Primary call failed; walking the fallback chain', {
    chatId,
    profileId: state.effectiveProfile.id,
    provider: state.effectiveProfile.provider,
    model: state.effectiveProfile.modelName,
    trigger,
    purpose: context.purpose,
    error: failureMessage,
  })

  const openingAttempt = recordAttempt(state.effectiveProfile, trigger, error)

  if (trigger === 'moderation-refusal') {
    // A thrown refusal reroutes like an empty one: the uncensored understudy
    // first, and only if that also fails, the profile's own chain — cleared
    // for the content, since a mainstream stand-in would hand it straight back
    // to the moderation that refused it. Same-provider retry stays skipped:
    // resending refused content to the provider that refused it is futile.
    //
    // The failure that opens the trail is recorded as a refusal. `state.routeVia`
    // is whatever the effective profile already was — 'primary' normally,
    // 'concierge' when the Concierge's pre-call reroute had already swapped it.
    const refusal = classifyRefusal({ error })
    recordRouteFailure(state, state.effectiveProfile, state.routeVia, 'refused', trigger,
      refusal.detail ?? failureMessage, refusal.evidence)
    const refusingProfile = state.effectiveProfile

    const alreadyTried = [...context.alreadyTried]
    // The caller's gate, stated here: a Locked chat's refusal stands, and
    // otherwise the Concierge reroutes only when his policy allows failover.
    // Read at refusal time, not when the turn began.
    if (!conciergeStateMayFailOver(await readCurrentConciergeState(chatId, opts.conciergeState))) {
      logger.info('[Failover] Refusal not rerouted to an uncensored profile: the chat is Locked', { chatId })
      await postConciergeRefusalAnnouncement({
        chatId,
        kind: 'refusal-not-permitted',
        details: {
          refusingProvider: refusingProfile.provider,
          refusingModel: refusingProfile.modelName,
          purpose: 'text',
          reason: 'locked',
        },
      })
      await recordTextRefusal(chatId, refusingProfile, refusal.evidence, false)
      return walk(context, openingAttempt)
    }
    // Re-asked at refusal time: the Concierge may have gone off duty mid-call.
    if (
      opts.conciergePolicy?.failoverAllowed
      && await readCurrentConciergeOnDuty(context.userId, opts.conciergePolicy.onDuty)
    ) {
      const uncensored = await attemptUncensoredRetry({
        turn,
        conciergePolicy: opts.conciergePolicy,
        alreadyTried,
        contentWasFlaggedDangerous: context.dangerous,
        refusalWasStated: true,
        replace: true,
      })
      if (uncensored.recovered) {
        await recordTextRefusal(chatId, refusingProfile, refusal.evidence, true)
        return { recovered: true, attempts: [openingAttempt], tierPickWasOffered: false }
      }
      await recordTextRefusal(chatId, refusingProfile, refusal.evidence, false)
      if (uncensored.clientGone) {
        return { recovered: false, attempts: [openingAttempt], tierPickWasOffered: false, clientGone: true }
      }
      if (uncensored.understudyId) alreadyTried.push(uncensored.understudyId)

      // `state.effectiveProfile` is still the profile that refused (the swap
      // only happens on success), so this is the refusing profile's own
      // chain; the understudy is in `alreadyTried` and never re-offered.
      logger.debug('[Failover] Uncensored retry did not recover a refusal; walking the chain cleared for the content', {
        chatId,
        profileId: state.effectiveProfile.id,
        understudyId: uncensored.understudyId,
        alreadyTried,
      })
      return walk({ ...context, dangerous: true, alreadyTried }, openingAttempt)
    }

    logger.info('[Failover] Refusal not rerouted to an uncensored profile: the Concierge policy does not permit it', {
      chatId,
      conciergeSource: opts.conciergePolicy?.source,
      conciergeState: opts.conciergePolicy?.state,
    })
    await recordTextRefusal(chatId, refusingProfile, refusal.evidence, false)
    return walk(context, openingAttempt)
  }

  // The failure that opens the chain is the trail's first row. `state.routeVia`
  // is whatever the effective profile already was — 'primary' normally,
  // 'concierge' when the Concierge's pre-call reroute had already swapped it.
  recordRouteFailure(state, state.effectiveProfile, state.routeVia, 'failed', trigger, failureMessage)

  return walk(context, openingAttempt)
}


/**
 * Walk the effective profile's fallback chain after an *empty* response.
 *
 * Runs last in the empty-response order — after the same-profile retry and,
 * when the Concierge allows failover, after the uncensored reroute. Those two come first
 * on purpose: an empty body is usually transient, and when it isn't it is
 * usually a refusal, which is a content problem the uncensored profile exists
 * to answer. Only once both have come back empty is it worth concluding the
 * route itself is no good and calling for the understudy.
 *
 * Note this runs against `state.effectiveProfile`, which by then may be the
 * *uncensored* profile rather than the one the chat started with — that
 * profile carries its own `fallbackProfileId`/`allowTierFallback`, and its
 * chain runs with `dangerous: true` so tier picks stay cleared for the
 * content.
 */
async function attemptEmptyResponseChainFallback(
  opts: WalkFallbackChainOptions
): Promise<FallbackChainResult> {
  const { turn, context } = opts
  const { state, chatId } = turn

  logger.warn('[Failover] Empty response survived local recovery; walking the fallback chain', {
    chatId,
    profileId: state.effectiveProfile.id,
    provider: state.effectiveProfile.provider,
    model: state.effectiveProfile.modelName,
    purpose: context.purpose,
    dangerous: context.dangerous,
  })

  return walkFallbackChain(
    opts,
    recordAttempt(state.effectiveProfile, 'empty-response', new Error('empty response'))
  )
}
