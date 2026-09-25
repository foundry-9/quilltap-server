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
 * `state.effectiveProfile` / `state.effectiveApiKey` are the single mutable
 * seam every downstream stage already reads, so a swap made here composes with
 * message finalization, token accounting and the tool loop for free.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { describeModerationRefusal } from '@/lib/llm/moderation-finish-reason'
import { resolveUncensoredTextUnderstudy } from '@/lib/services/dangerous-content/understudy'
import { classifyRefusal, type RefusalEvidence } from '@/lib/services/dangerous-content/refusal'
import { recordModerationRefusal } from '@/lib/services/dangerous-content/refusal-ledger'
import {
  conciergeStateMayFailOver,
  type ConciergeState,
} from '@/lib/services/dangerous-content/chat-override'
import { readCurrentConciergeState } from '@/lib/services/dangerous-content/current-state'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import { resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import {
  adaptMessagesForProfile,
  collectAttachmentMimeTypes,
} from '@/lib/chat/message-attachment-adapter'
import {
  buildFallbackChain,
  classifyFallbackTrigger,
  recordAttempt,
  type FallbackAttempt,
  type FallbackContext,
  type FallbackRepos,
} from '@/lib/llm/fallback'
import type { ConnectionProfile, Character } from '@/lib/schemas/types'
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
import type { StreamingState } from './types'
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

export interface AttemptEmptyResponseRecoveryOptions {
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
  formattedMessages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    reasoningContent?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }>
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
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
  /** Provider stop sequences to carry into a chain attempt. */
  stop?: string[]
}

export interface EmptyResponseRecoveryFlags {
  uncensoredRetryAttempted: boolean
  sameProviderRetryAttempted: boolean
  /** Whether the profile's fallback chain was walked after the two local
   *  retries came back empty. */
  chainFallbackAttempted: boolean
  /** The failed attempts from that chain walk, for the log and the message. */
  chainAttempts: FallbackAttempt[]
}

/**
 * Attempt to recover from an empty assistant response.
 * Mutates `state` directly — the caller reads updated values from the same object.
 */
export async function attemptEmptyResponseRecovery({
  state,
  toolMessagesLength,
  contentWasFlaggedDangerous,
  conciergePolicy,
  conciergeState,
  formattedMessages,
  modelParams,
  actualTools,
  useNativeWebSearch,
  userId,
  chatId,
  character,
  controller,
  encoder,
  preGeneratedAssistantMessageId,
  repos,
  fallbackContext,
  stop,
}: AttemptEmptyResponseRecoveryOptions): Promise<EmptyResponseRecoveryFlags> {
  let uncensoredRetryAttempted = false
  let sameProviderRetryAttempted = false

  // Profiles this recovery has already spent. The chain walk at the bottom
  // reads it so a route that has already come back empty isn't asked twice.
  const triedProfileIds: string[] = []

  const flags = (): EmptyResponseRecoveryFlags => ({
    uncensoredRetryAttempted,
    sameProviderRetryAttempted,
    chainFallbackAttempted: false,
    chainAttempts: [],
  })

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

    try {
      await restreamInto(state, {
        connectionProfile: state.effectiveProfile,
        apiKey: state.effectiveApiKey,
        formattedMessages,
        modelParams,
        actualTools,
        useNativeWebSearch,
        userId,
        chatId,
        character,
        controller,
        encoder,
        preGeneratedAssistantMessageId,
      })

      if (state.fullResponse.trim().length > 0) {
        setRouteVia(state, 'retry')
        logger.info('[EmptyResponse] Same-provider retry succeeded', {
          chatId,
          provider: state.effectiveProfile.provider,
          model: state.effectiveProfile.modelName,
          responseLength: state.fullResponse.length,
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
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
      recordRouteFailure(state, state.effectiveProfile, 'retry', 'failed',
        classifyFallbackTrigger(retryError) ?? 'provider-error', retryMessage)
      logger.error('[EmptyResponse] Same-provider retry failed', {
        chatId,
        error: retryMessage,
      })
    }
  }

  // Read at refusal time, not when the turn began: the operator may have
  // locked the chat while the provider was thinking.
  const lockedOut = state.fullResponse.trim().length === 0
    && !conciergeStateMayFailOver(await readCurrentConciergeState(chatId, conciergeState))
  if (state.fullResponse.trim().length === 0 && lockedOut && turnRefusal) {
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

  if (state.fullResponse.trim().length === 0 && !lockedOut && conciergePolicy.failoverAllowed) {
    const uncensored = await attemptUncensoredRetry({
      state,
      conciergePolicy,
      formattedMessages,
      modelParams,
      actualTools,
      useNativeWebSearch,
      userId,
      chatId,
      character,
      controller,
      encoder,
      preGeneratedAssistantMessageId,
      repos,
      alreadyTried: triedProfileIds,
      contentWasFlaggedDangerous,
      refusalWasStated: openingVerdict.outcome === 'refused',
      substitute: false,
    })
    uncensoredRetryAttempted = uncensored.attempted
    uncensoredRecovered = uncensored.recovered
    if (uncensored.understudyId) triedProfileIds.push(uncensored.understudyId)
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
  if (state.fullResponse.trim().length === 0 && repos && fallbackContext) {
    const chainResult = await attemptEmptyResponseChainFallback({
      state,
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
      formattedMessages,
      modelParams,
      actualTools,
      useNativeWebSearch,
      chatId,
      character,
      controller,
      encoder,
      preGeneratedAssistantMessageId,
      stop,
    })

    await recordOpeningRefusal()
    return {
      uncensoredRetryAttempted,
      sameProviderRetryAttempted,
      chainFallbackAttempted: true,
      chainAttempts: chainResult.attempts,
    }
  }

  await recordOpeningRefusal()
  return flags()
}

export interface AttemptUncensoredRetryOptions {
  state: StreamingState
  conciergePolicy: ResolvedConciergePolicy
  formattedMessages: AttemptEmptyResponseRecoveryOptions['formattedMessages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  /** Present re-adapts the message array for the understudy (bug 106). */
  repos?: FailoverRepos
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
  substitute: boolean
  stop?: string[]
}

export interface UncensoredRetryResult {
  /** An understudy was found and asked. */
  attempted: boolean
  /** It answered; `state` now holds its response and it is the effective profile. */
  recovered: boolean
  /** The understudy that was asked, for the caller's loop guard. */
  understudyId?: string
}

/**
 * Ask the Concierge's uncensored understudy to take a turn the effective
 * profile refused or left empty.
 *
 * The *policy* — `conciergePolicy.failoverAllowed` only — is the caller's,
 * stated at its call site.
 * This function asks `resolveUncensoredTextUnderstudy` (the configured
 * uncensored profile, else any `isDangerousCompatible` one), excluding every
 * profile already tried, streams one attempt, and records the outcome on the
 * route trail. Used by the empty-body recovery and by the hard-error failover
 * when the error was a content refusal.
 */
export async function attemptUncensoredRetry(
  opts: AttemptUncensoredRetryOptions
): Promise<UncensoredRetryResult> {
  const {
    state, conciergePolicy, formattedMessages, modelParams, actualTools, useNativeWebSearch,
    userId, chatId, character, controller, encoder, preGeneratedAssistantMessageId, repos,
    alreadyTried, contentWasFlaggedDangerous, refusalWasStated, substitute, stop,
  } = opts

  const understudy = await resolveUncensoredTextUnderstudy({
    userId,
    conciergePolicy,
    exclude: [...alreadyTried, state.effectiveProfile.id],
    // What the array is actually carrying, so the scan does not offer a
    // substitute the payload rules out (bug 106).
    turnAttachmentMimeTypes: collectAttachmentMimeTypes(formattedMessages),
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

  try {
    // The array was built for the profile that just refused. An explicitly
    // configured uncensored profile is honoured ahead of the scan, so it may
    // still be one that cannot read this turn's images — re-decide before
    // spending the attempt, or the gateway 400s (bug 106).
    const reroutedMessages = repos
      ? await adaptMessagesForProfile(formattedMessages, reroute, repos, userId, { chatId })
      : formattedMessages

    if (substitute) resetStreamingBuffersForSwap(state)

    await restreamInto(state, {
      connectionProfile: reroute,
      apiKey: understudy.apiKey,
      formattedMessages: reroutedMessages,
      modelParams,
      actualTools,
      useNativeWebSearch,
      userId,
      chatId,
      character,
      controller,
      encoder,
      preGeneratedAssistantMessageId,
      stop,
    })

    if (state.fullResponse.trim().length > 0) {
      state.effectiveProfile = reroute
      state.effectiveApiKey = understudy.apiKey
      setRouteVia(state, 'concierge')
      logger.info('[DangerousContent] Uncensored retry succeeded', {
        chatId,
        uncensoredProvider: reroute.provider,
        uncensoredModel: reroute.modelName,
        responseLength: state.fullResponse.length,
      })
      return { attempted: true, recovered: true, understudyId: reroute.id }
    }

    // Recorded from `reroute`, NOT from `state`: the swap above only happens
    // on success, so an uncensored profile that comes back empty is otherwise
    // absent from every record — and this row is precisely the one the user
    // asked for. Classified here, before anything resets the buffers.
    const verdict = classifyEmptyBody(state, contentWasFlaggedDangerous)
    recordRouteFailure(state, reroute, 'concierge', verdict.outcome, verdict.trigger,
      verdict.detail, verdict.evidence)
    logger.error('[DangerousContent] Both safe and uncensored providers returned empty', {
      chatId,
      safeProvider: state.effectiveProfile.provider,
      safeModel: state.effectiveProfile.modelName,
      uncensoredProvider: reroute.provider,
      uncensoredModel: reroute.modelName,
    })
  } catch (retryError) {
    const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
    const refusal = classifyRefusal({ error: retryError })
    if (refusal.refused) {
      recordRouteFailure(state, reroute, 'concierge', 'refused', 'moderation-refusal',
        refusal.detail ?? retryMessage, refusal.evidence)
    } else {
      recordRouteFailure(state, reroute, 'concierge', 'failed',
        classifyFallbackTrigger(retryError) ?? 'provider-error', retryMessage)
    }
    logger.error('[DangerousContent] Uncensored retry failed', {
      chatId,
      error: retryMessage,
    })
  }

  if (substitute) resetStreamingBuffersForSwap(state)
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

export interface RestreamOptions {
  connectionProfile: ConnectionProfile
  apiKey: string
  formattedMessages: AttemptEmptyResponseRecoveryOptions['formattedMessages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  userId: string
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  /**
   * Provider stop sequences (e.g. simple-json's `</tool_call>`). Optional so
   * the empty-response callers above keep their existing behaviour; the
   * hard-error failover path passes the primary call's sequences so a
   * pseudo-tool profile's framing survives the swap.
   *
   * Note there is deliberately no `previousResponseId` here: it is an OpenAI
   * Responses-API chaining token, and handing it to a different account —
   * never mind a different provider — is meaningless at best.
   */
  stop?: string[]
}

/**
 * Re-stream a response into the mutable StreamingState.
 *
 * Appends to `state.fullResponse` rather than replacing it. Callers that are
 * *substituting* a response rather than continuing one must clear the
 * streaming buffers first — see `resetStreamingBuffersForSwap`.
 */
export async function restreamInto(
  state: StreamingState,
  opts: RestreamOptions
): Promise<void> {
  for await (const chunk of streamMessage({
    messages: opts.formattedMessages,
    connectionProfile: opts.connectionProfile,
    apiKey: opts.apiKey,
    modelParams: opts.modelParams,
    tools: opts.actualTools,
    useNativeWebSearch: opts.useNativeWebSearch,
    userId: opts.userId,
    messageId: opts.preGeneratedAssistantMessageId,
    chatId: opts.chatId,
    characterId: opts.character.id,
    stop: opts.stop,
  })) {
    applyReasoningChunk(state, chunk, opts.controller, opts.encoder)
    if (chunk.content) {
      if (!state.hasStartedStreaming) {
        safeEnqueue(opts.controller, encodeStatusEvent(opts.encoder, {
          stage: 'streaming',
          message: `${opts.character.name} is responding...`,
          characterName: opts.character.name,
          characterId: opts.character.id,
        }))
        state.hasStartedStreaming = true
      }
      flushReasoningSegment(state)
      state.fullResponse += chunk.content
      opts.controller.enqueue(encodeContentChunk(opts.encoder, chunk.content))
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

export interface WalkFallbackChainOptions {
  state: StreamingState
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
  formattedMessages: AttemptEmptyResponseRecoveryOptions['formattedMessages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  chatId: string
  character: Pick<Character, 'id' | 'name'>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preGeneratedAssistantMessageId?: string
  stop?: string[]
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
}

/**
 * Walk a profile's fallback chain, streaming the first answer that arrives
 * into `state`.
 *
 * `openingFailure` is the attempt that sent us here — the primary's error, or
 * its empty response. It leads the attempt trail and seeds the loop guard, so
 * the chain never re-offers the profile that just failed.
 *
 * On success `state.effectiveProfile` / `effectiveApiKey` are swapped to the
 * understudy: that pair is the seam every downstream stage reads, so
 * finalization, token accounting and the tool loop all attribute the message
 * to whoever actually wrote it. On exhaustion the buffers are left empty — a
 * stray fragment from a dead understudy is not this character's words.
 */
async function walkFallbackChain(
  opts: WalkFallbackChainOptions,
  openingFailure: FallbackAttempt
): Promise<FallbackChainResult> {
  const {
    state, repos, context, formattedMessages, modelParams, actualTools,
    useNativeWebSearch, chatId, character, controller, encoder,
    preGeneratedAssistantMessageId, stop,
  } = opts

  const failedProfile = state.effectiveProfile
  const attempts: FallbackAttempt[] = [openingFailure]

  const chain = await buildFallbackChain(failedProfile, repos, {
    ...context,
    alreadyTried: [...context.alreadyTried, failedProfile.id],
  })

  const tierPickWasOffered = chain.some((c) => c.kind === 'tier-pick')

  for (const candidate of chain) {
    const understudy = candidate.profile

    const keyResolution = await resolveConnectionProfileApiKey(repos, understudy)
    if (!keyResolution.ok) {
      logger.warn('[Failover] Understudy has no usable API key; moving on', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        reason: keyResolution.reason,
      })
      attempts.push(recordAttempt(understudy, 'auth', new Error(keyResolution.reason)))
      recordRouteFailure(state, understudy, viaOf(candidate.kind), 'failed', 'auth', keyResolution.reason)
      continue
    }

    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'failing-over',
      message: `${understudy.name} is standing in for ${character.name}...`,
      characterName: character.name,
      characterId: character.id,
    }))

    resetStreamingBuffersForSwap(state)

    try {
      await restreamInto(state, {
        connectionProfile: understudy,
        apiKey: keyResolution.apiKey,
        formattedMessages,
        modelParams,
        actualTools,
        useNativeWebSearch,
        userId: context.userId,
        chatId,
        character,
        controller,
        encoder,
        preGeneratedAssistantMessageId,
        stop,
      })
    } catch (understudyError) {
      const understudyTrigger = classifyFallbackTrigger(understudyError) ?? 'provider-error'
      const understudyMessage = understudyError instanceof Error ? understudyError.message : String(understudyError)
      attempts.push(recordAttempt(understudy, understudyTrigger, understudyError))
      recordRouteFailure(state, understudy, viaOf(candidate.kind), 'failed', understudyTrigger, understudyMessage)
      logger.warn('[Failover] Understudy also failed', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        provider: understudy.provider,
        model: understudy.modelName,
        kind: candidate.kind,
        trigger: understudyTrigger,
        error: understudyError instanceof Error ? understudyError.message : String(understudyError),
      })
      continue
    }

    if (state.fullResponse.trim().length === 0) {
      attempts.push(recordAttempt(understudy, 'empty-response', new Error('empty response')))
      // Classified HERE, before the next iteration's `resetStreamingBuffersForSwap`
      // wipes `state.rawResponse` — that is where the finish reason lives, and
      // it is the only thing that tells a stated refusal from a blank body.
      const understudyVerdict = classifyEmptyBody(state, context.dangerous)
      recordRouteFailure(state, understudy, viaOf(candidate.kind), understudyVerdict.outcome,
        understudyVerdict.trigger, understudyVerdict.detail, understudyVerdict.evidence)
      logger.warn('[Failover] Understudy returned an empty response', {
        chatId,
        understudyId: understudy.id,
        understudyName: understudy.name,
        kind: candidate.kind,
      })
      continue
    }

    state.effectiveProfile = understudy
    state.effectiveApiKey = keyResolution.apiKey
    setRouteVia(state, viaOf(candidate.kind))

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

export interface AttemptHardErrorFailoverOptions extends WalkFallbackChainOptions {
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
  const { state, error, chatId, context } = opts
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

  const failureMessage = error instanceof Error ? error.message : String(error)

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
      return walkFallbackChain(opts, openingAttempt)
    }
    if (opts.conciergePolicy?.failoverAllowed) {
      const uncensored = await attemptUncensoredRetry({
        state,
        conciergePolicy: opts.conciergePolicy,
        formattedMessages: opts.formattedMessages,
        modelParams: opts.modelParams,
        actualTools: opts.actualTools,
        useNativeWebSearch: opts.useNativeWebSearch,
        userId: context.userId,
        chatId,
        character: opts.character,
        controller: opts.controller,
        encoder: opts.encoder,
        preGeneratedAssistantMessageId: opts.preGeneratedAssistantMessageId,
        repos: opts.repos,
        alreadyTried,
        contentWasFlaggedDangerous: context.dangerous,
        refusalWasStated: true,
        substitute: true,
        stop: opts.stop,
      })
      if (uncensored.recovered) {
        await recordTextRefusal(chatId, refusingProfile, refusal.evidence, true)
        return { recovered: true, attempts: [openingAttempt], tierPickWasOffered: false }
      }
      if (uncensored.understudyId) alreadyTried.push(uncensored.understudyId)
      await recordTextRefusal(chatId, refusingProfile, refusal.evidence, false)

      // `state.effectiveProfile` is still the profile that refused (the swap
      // only happens on success), so this is the refusing profile's own
      // chain; the understudy is in `alreadyTried` and never re-offered.
      logger.debug('[Failover] Uncensored retry did not recover a refusal; walking the chain cleared for the content', {
        chatId,
        profileId: state.effectiveProfile.id,
        understudyId: uncensored.understudyId,
        alreadyTried,
      })
      return walkFallbackChain(
        { ...opts, context: { ...context, dangerous: true, alreadyTried } },
        openingAttempt,
      )
    }

    logger.info('[Failover] Refusal not rerouted to an uncensored profile: the Concierge policy does not permit it', {
      chatId,
      conciergeSource: opts.conciergePolicy?.source,
      conciergeState: opts.conciergePolicy?.state,
    })
    await recordTextRefusal(chatId, refusingProfile, refusal.evidence, false)
    return walkFallbackChain(opts, openingAttempt)
  }

  // The failure that opens the chain is the trail's first row. `state.routeVia`
  // is whatever the effective profile already was — 'primary' normally,
  // 'concierge' when the Concierge's pre-call reroute had already swapped it.
  recordRouteFailure(state, state.effectiveProfile, state.routeVia, 'failed', trigger, failureMessage)

  return walkFallbackChain(opts, openingAttempt)
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
export async function attemptEmptyResponseChainFallback(
  opts: WalkFallbackChainOptions
): Promise<FallbackChainResult> {
  const { state, chatId, context } = opts

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
