/**
 * Turn Outcome — how a Salon turn closes once the model has answered.
 *
 * After the primary stream, the tool loops and any empty-response recovery,
 * exactly one of six things happens to a turn:
 *
 * | kind         | when                                                       | persisted                    |
 * |--------------|------------------------------------------------------------|------------------------------|
 * | `bare-yield` | asked to yield to a raised hand, yielded, said nothing     | the Host's yield note        |
 * | `pass`       | offered "nothing to add", passed, ran no tools             | the Host's pass note         |
 * | `reply`      | words to keep (a yield or pass line stripped from them)    | the reply, via the finalizer |
 * | `tools-only` | no words, but tools ran                                    | the tool rows                |
 * | `stopped`    | the operator hard-stopped it before a word or a tool       | nothing                      |
 * | `empty`      | the provider returned nothing                              | nothing (the Salon is told why) |
 *
 * `resolveTurnOutcome` decides which (pure, from the response text and what
 * ran); `settleTurn` carries it out. A reply or tools-only turn that yielded
 * also gets the Host's yield note and stops the chain.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  computeCycleOrderAfterSkip,
  computeSpokenThisCycleAfterSkip,
  detectSkipSentinel,
  detectYieldSentinel,
} from '@/lib/chat/turn-manager'
import { isCurrentTurnStopped } from '@/lib/chat/turn-control'
import { markMailAlertsDelivered, type MailAlertsOwed } from '@/lib/post-office/mailbox'
import { postHostTurnPassAnnouncement, postHostTurnYieldAnnouncement } from '@/lib/services/host-notifications/writer'
import { flushPendingWardrobeAnnouncements } from '@/lib/wardrobe/outfit-change-effects'
import { flushPendingInventoryAnnouncements } from '@/lib/inventory/equip-effects'
import { extractFinishReason } from '@/lib/llm/extract-finish-reason'
import { isModerationFinishReason } from '@/lib/llm/moderation-finish-reason'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase } from '@/lib/schemas/types'
import type { ResolvedConciergePolicy } from '@/lib/services/dangerous-content/resolver.service'
import { getEmptyResponseReason, type EmptyResponseRecoveryFlags } from './provider-failover.service'
import { encodeHandAnsweredEvent, encodeHostAnnouncementEvent, encodeTurnDoneEvent, safeEnqueue } from './streaming.service'
import { saveToolMessages } from './tool-execution.service'
import type { GeneratedImage, ProcessMessageResult, StreamingState, ToolMessage } from './types'

const logger = createServiceLogger('TurnOutcome')

/** "Nothing to add" eligibility, decided before the context was built. */
export interface TurnSkipOffer {
  offerSkip: boolean
  recentlyAddressed: boolean
  characterName: string
}

export type TurnOutcomeKind = 'bare-yield' | 'pass' | 'reply' | 'tools-only' | 'stopped' | 'empty'

export interface TurnOutcome {
  kind: TurnOutcomeKind
  /** The response to keep, sentinels stripped ('' when there is nothing to keep). */
  response: string
  /** The character gave the floor to the raised hand; the chain stops after this turn. */
  yielded: boolean
  /** Set when the character was asked to yield: its answer, for the Salon's hand. */
  /** `inferred`: a gesture-only reply read as a yield, with no sentinel. */
  handAnswered?: { yielded: boolean; inferred?: boolean }
  /** A pass sentinel was emitted after tools had run; the tools win, the pass is ignored. */
  passOverriddenByTools?: boolean
}

/**
 * Decide how a turn closes (pure).
 *
 * A stopped turn keeps exactly what streamed and reads no sentinel from a
 * cut-off line — a half-written "[NOTHING TO" is just words. A yield is read
 * before a pass: a character asked to yield has already been offered the floor
 * back, and anything said around the sentinel is kept as its reply.
 */
export function resolveTurnOutcome(input: {
  response: string
  toolCount: number
  stopped: boolean
  offerYield: boolean
  turnSkip?: TurnSkipOffer
  character: { name: string; aliases?: string[] | null }
}): TurnOutcome {
  const { toolCount, stopped, offerYield, turnSkip, character } = input
  const aliases = character.aliases ?? undefined
  let response = input.response
  let yielded = false
  let handAnswered: TurnOutcome['handAnswered']
  let passOverriddenByTools = false

  if (offerYield && !stopped) {
    const detection = detectYieldSentinel(response, character.name, aliases)
    handAnswered = detection.yielded && detection.inferred
      ? { yielded: true, inferred: true }
      : { yielded: detection.yielded }
    if (detection.yielded) {
      yielded = true
      response = detection.cleaned
      if (response.trim().length === 0 && toolCount === 0) {
        return { kind: 'bare-yield', response: '', yielded, handAnswered }
      }
    }
  }

  if (turnSkip && !stopped && !yielded) {
    const detection = detectSkipSentinel(response, character.name, aliases)
    if (detection.skip) {
      if (toolCount > 0) {
        // Tools ran: the turn had real effects, so the tool save wins.
        passOverriddenByTools = true
        response = ''
      } else if (turnSkip.offerSkip) {
        return { kind: 'pass', response: '', yielded, handAnswered }
      } else {
        // A pass that was never offered is an empty answer.
        response = ''
      }
    } else if (detection.cleaned !== undefined) {
      // Sentinel line + trailing prose: strip the line, keep the prose.
      response = detection.cleaned
    }
  }

  const kind: TurnOutcomeKind = response.trim().length > 0
    ? 'reply'
    : toolCount > 0
      ? 'tools-only'
      : stopped ? 'stopped' : 'empty'
  return {
    kind,
    response,
    yielded,
    ...(handAnswered ? { handAnswered } : {}),
    ...(passOverriddenByTools ? { passOverriddenByTools } : {}),
  }
}

export interface SettleTurnParams {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: Pick<ChatMetadataBase, 'isPaused' | 'allowCrossCharacterVaultReads'>
  character: { id: string; name: string; aliases?: string[] | null }
  characterParticipant: { id: string }
  isMultiCharacter: boolean
  userParticipantId: string | null
  /** The name the Host's yield note gives the operator. */
  operatorName: string
  offerYield: boolean
  turnSkip?: TurnSkipOffer
  /** Mutated: the kept response is written back to `fullResponse`. */
  streaming: StreamingState
  toolMessages: ToolMessage[]
  generatedImagePaths: GeneratedImage[]
  toolContext: ToolExecutionContext
  /** This turn's announced letters, spent by any turn that answered them. */
  mailAlertsOwed: MailAlertsOwed | null
  recovery: EmptyResponseRecoveryFlags
  contentWasFlaggedDangerous: boolean
  conciergePolicy: ResolvedConciergePolicy
  /** Persist and announce a reply (the finalizer, with its own parameters bound). */
  finalizeReply: () => Promise<ProcessMessageResult>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}

/**
 * Close the turn. The turn's wardrobe edits collapse into one Aurora
 * announcement per character before anything is saved; its Inventory changes
 * — one Pascal line per character — post after, whichever way the turn closes,
 * so the line follows the reply it sums up.
 */
export async function settleTurn(params: SettleTurnParams): Promise<ProcessMessageResult> {
  const { chatId, character, characterParticipant, streaming, toolMessages, controller, encoder } = params

  await flushPendingWardrobeAnnouncements(params.toolContext)

  try {
    const stopped = isCurrentTurnStopped()
    if (stopped) {
      // What reached the screen is the reply; the thinking never was, so it goes.
      streaming.reasoningContent = undefined
      streaming.reasoningSegments = []
      logger.info('[TurnStop] Turn stopped by the operator; keeping what streamed', {
        chatId,
        characterId: character.id,
        participantId: characterParticipant.id,
        partialLength: streaming.fullResponse.length,
        toolCount: toolMessages.length,
      })
    }

    const outcome = resolveTurnOutcome({
      response: streaming.fullResponse,
      toolCount: toolMessages.length,
      stopped,
      offerYield: params.offerYield,
      turnSkip: params.turnSkip,
      character,
    })
    streaming.fullResponse = outcome.response
    logOutcome(params, outcome)

    if (outcome.handAnswered) {
      safeEnqueue(controller, encodeHandAnsweredEvent(encoder, {
        participantId: characterParticipant.id,
        characterName: character.name,
        yielded: outcome.handAnswered.yielded,
      }))
    }

    switch (outcome.kind) {
      case 'bare-yield':
        return closeBareYield(params)
      case 'pass':
        return closePass(params)
      case 'reply':
        return withYield(params, outcome, await params.finalizeReply())
      case 'tools-only':
        return withYield(params, outcome, await closeToolsOnly(params))
      case 'stopped':
        return closeStopped(params)
      case 'empty':
        return closeEmpty(params)
    }
  } finally {
    await flushPendingInventoryAnnouncements(params.toolContext)
  }
}

function logOutcome(params: SettleTurnParams, outcome: TurnOutcome): void {
  const ids = {
    chatId: params.chatId,
    characterId: params.character.id,
    participantId: params.characterParticipant.id,
  }
  if (outcome.handAnswered) {
    if (outcome.yielded) {
      logger.info('[TurnYield] Character yielded the floor to the raised hand', {
        ...ids,
        withReply: outcome.response.length > 0,
        inferredFromGesture: outcome.handAnswered.inferred === true,
        toolCount: params.toolMessages.length,
      })
    } else {
      logger.info('[TurnYield] Character carried on past the raised hand', ids)
    }
  }
  if (outcome.passOverriddenByTools) {
    logger.warn('[TurnSkip] Sentinel emitted but tools ran; keeping tool results, ignoring the pass', {
      ...ids,
      toolCount: params.toolMessages.length,
    })
  }
  logger.debug('[TurnOutcome] Turn settled', { ...ids, kind: outcome.kind, yielded: outcome.yielded })
}

function silentResult(params: SettleTurnParams, extra: Partial<ProcessMessageResult> = {}): ProcessMessageResult {
  return {
    isMultiCharacter: params.isMultiCharacter,
    hasContent: false,
    messageId: null,
    userParticipantId: params.userParticipantId,
    isPaused: params.chat.isPaused,
    ...extra,
  }
}

/** A yield that came with words or tools: the turn is saved, then the Host notes the yield. */
async function withYield(
  params: SettleTurnParams,
  outcome: TurnOutcome,
  result: ProcessMessageResult
): Promise<ProcessMessageResult> {
  if (!outcome.yielded) return result
  await announceTurnYield(params)
  return { ...result, yielded: true }
}

async function announceTurnYield(params: SettleTurnParams): Promise<void> {
  const hostMessage = await postHostTurnYieldAnnouncement({
    chatId: params.chatId,
    characterName: params.character.name,
    participantId: params.characterParticipant.id,
    operatorName: params.operatorName,
  })
  if (hostMessage) {
    safeEnqueue(params.controller, encodeHostAnnouncementEvent(params.encoder, hostMessage))
  }
}

/**
 * Raised hand: the asked character yielded and said nothing else.
 *
 * Like a pass, no reply is persisted and the done event is flagged `skipped`
 * so the client drops its streaming buffer without a phantom bubble (the Host's
 * yield note is the visible record). Unlike a pass, the rotation is not
 * advanced — the character gave the floor away rather than spending its turn —
 * and the result is `yielded`, which stops the chain so the operator speaks
 * next. Informs stay pending for the character's next real turn.
 */
async function closeBareYield(params: SettleTurnParams): Promise<ProcessMessageResult> {
  const { chatId, characterParticipant } = params
  await markMailAlertsDelivered(params.mailAlertsOwed, { chatId, via: 'turn-yield' })
  await announceTurnYield(params)
  safeEnqueue(params.controller, encodeTurnDoneEvent(params.encoder, params.streaming, {
    messageId: null,
    participantId: characterParticipant.id,
    toolsExecuted: false,
    skipped: true,
    skippedParticipantId: characterParticipant.id,
    yielded: true,
  }))
  logger.debug('[TurnYield] Bare yield closed without a reply', {
    chatId,
    characterId: params.character.id,
    participantId: characterParticipant.id,
  })
  return silentResult(params, { yielded: true })
}

/**
 * "Nothing to add": the Host notes the pass, the passing seat is recorded in
 * the persisted cycle (so the rotation advances past it), and the done event
 * is flagged `skipped` so the client resets its buffer without a phantom
 * bubble. No character reply is persisted.
 */
async function closePass(params: SettleTurnParams): Promise<ProcessMessageResult> {
  const { repos, chatId, character, characterParticipant } = params

  logger.info('[TurnSkip] Character passed the turn', {
    chatId,
    characterId: character.id,
    participantId: characterParticipant.id,
  })

  // A pass is an answer: the character read its mail and chose to say nothing.
  await markMailAlertsDelivered(params.mailAlertsOwed, { chatId, via: 'turn-skip' })

  const hostMessage = await postHostTurnPassAnnouncement({
    chatId,
    characterName: character.name,
    participantId: characterParticipant.id,
    source: 'llm',
  })

  // Re-read for fresh participants and cycle state.
  let isPaused = false
  try {
    const freshChat = await repos.chats.findById(chatId)
    if (freshChat) {
      isPaused = freshChat.isPaused === true
      const cycleUpdate = computeSpokenThisCycleAfterSkip(
        characterParticipant.id,
        freshChat.participants,
        freshChat.spokenThisCycleParticipantIds,
      )
      const orderUpdate = computeCycleOrderAfterSkip(
        characterParticipant.id,
        freshChat.cycleOrderParticipantIds,
      )
      await repos.chats.update(chatId, {
        updatedAt: new Date().toISOString(),
        ...(cycleUpdate !== null ? { spokenThisCycleParticipantIds: cycleUpdate } : {}),
        // A pass spends the turn: the character leaves this cycle's rotation
        // exactly as a spoken line would have taken them out of it.
        ...(orderUpdate !== null ? { cycleOrderParticipantIds: orderUpdate } : {}),
      })
    }
  } catch (error) {
    logger.warn('[TurnSkip] Failed to persist cycle update after pass', {
      chatId,
      participantId: characterParticipant.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (hostMessage) {
    safeEnqueue(params.controller, encodeHostAnnouncementEvent(params.encoder, hostMessage))
  }
  safeEnqueue(params.controller, encodeTurnDoneEvent(params.encoder, params.streaming, {
    messageId: null,
    participantId: characterParticipant.id,
    toolsExecuted: false,
    skipped: true,
    skippedParticipantId: characterParticipant.id,
  }))

  return silentResult(params, {
    skipped: true,
    skippedParticipantId: characterParticipant.id,
    isPaused,
  })
}

/** No words, but tools ran: the tool rows are the turn. */
async function closeToolsOnly(params: SettleTurnParams): Promise<ProcessMessageResult> {
  const { repos, chatId, characterParticipant } = params
  const toolSaveResult = await saveToolMessages(
    repos,
    chatId,
    params.userId,
    params.toolMessages,
    params.generatedImagePaths,
    params.character.id,
    characterParticipant.id,
    {
      userParticipantId: params.userParticipantId,
      allowCrossCharacterVaultReads: params.chat.allowCrossCharacterVaultReads === true,
    }
  )

  // The model read this turn's mail and acted (tools ran); the turn is kept.
  await markMailAlertsDelivered(params.mailAlertsOwed, { chatId, via: 'tool-only' })
  await repos.chats.update(chatId, { updatedAt: new Date().toISOString() })

  safeEnqueue(params.controller, encodeTurnDoneEvent(params.encoder, params.streaming, {
    messageId: toolSaveResult.firstToolMessageId,
    participantId: characterParticipant.id,
    toolsExecuted: true,
  }))

  return silentResult(params, {
    hasContent: true,
    messageId: toolSaveResult.firstToolMessageId || null,
  })
}

/** Stopped before a word streamed or a tool ran: nothing to keep, nothing to apologise for. */
function closeStopped(params: SettleTurnParams): ProcessMessageResult {
  safeEnqueue(params.controller, encodeTurnDoneEvent(params.encoder, params.streaming, {
    messageId: null,
    participantId: params.characterParticipant.id,
    toolsExecuted: false,
    stopped: true,
  }))
  return silentResult(params)
}

/**
 * The provider returned nothing. It may have said why: Z.AI reports
 * `finish_reason: sensitive` on a moderation refusal, OpenAI `content_filter`,
 * Google `SAFETY` — all of which make "try resending" actively wrong advice
 * (bug 93).
 */
function closeEmpty(params: SettleTurnParams): ProcessMessageResult {
  const { streaming, recovery, conciergePolicy } = params
  const finishReason = extractFinishReason(streaming.rawResponse)
  const emptyReason = getEmptyResponseReason({
    uncensoredRetryAttempted: recovery.uncensoredRetryAttempted,
    sameProviderRetryAttempted: recovery.sameProviderRetryAttempted,
    contentWasFlaggedDangerous: params.contentWasFlaggedDangerous,
    chainAttempts: recovery.chainAttempts,
    finishReason,
    provider: streaming.effectiveProfile.provider,
    modelName: streaming.effectiveProfile.modelName,
  })
  logger.warn(`Empty response for chat ${params.chatId}`, {
    uncensoredRetryAttempted: recovery.uncensoredRetryAttempted,
    sameProviderRetryAttempted: recovery.sameProviderRetryAttempted,
    contentWasFlaggedDangerous: params.contentWasFlaggedDangerous,
    chainAttempts: recovery.chainAttempts.map((a) => ({
      profileName: a.profileName,
      provider: a.provider,
      trigger: a.trigger,
    })),
    finishReason,
    moderationRefusal: isModerationFinishReason(finishReason),
    conciergeSource: conciergePolicy.source,
    conciergeState: conciergePolicy.state,
    provider: streaming.effectiveProfile.provider,
    model: streaming.effectiveProfile.modelName,
  })
  safeEnqueue(params.controller, encodeTurnDoneEvent(params.encoder, streaming, {
    messageId: null,
    participantId: params.characterParticipant.id,
    toolsExecuted: false,
    emptyResponse: true,
    emptyResponseReason: emptyReason,
  }))
  return silentResult(params)
}
