/**
 * Chat Message Orchestrator Service
 *
 * The Salon turn pipeline's entry points — a send (`handleSendMessage`), a
 * storyteller round (`handleStorytellerRun`) and a storyteller bid
 * (`runStorytellerBid`) — and `processMessage`, which builds and runs one
 * character's turn. Each phase of a turn lives in its own module; this file
 * calls them in the order a turn happens:
 *
 *   1. hold      — is the post answered at all?          (`turn-holds.service`)
 *   2. prepare   — responder, settings, routing, cast     (`turn-preparation.service`, …)
 *   3. record    — the operator's post                    (`operator-post.service`)
 *   4. tools     — the turn's tool slate                  (`turn-tools.service`)
 *   5. context   — recall, compression, the prompt        (`pre-compute`, `context-builder`)
 *   6. generate  — stream, tool loops, recovery           (`primary-stream`, `native-tool-loop`, `text-tool-loop`, `provider-failover`)
 *   7. settle    — reply, pass, yield, stop or empty      (`turn-outcome.service`)
 *
 * The stream itself (turn control, keep-alives, the error frame) is
 * `turn-stream.ts`; the chain after the first turn is `turn-orchestrator.service`.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { takeRaisedHand, waitForEarlierTurns } from '@/lib/chat/turn-control'
import { collectAttachmentMimeTypes } from '@/lib/chat/message-attachment-adapter'
import { postHostNudgeAnnouncement } from '@/lib/services/host-notifications/writer'
import { z } from 'zod'

import { getRepositories } from '@/lib/repositories/factory'
import type { MessageEvent } from '@/lib/schemas/types'

import type { SendMessageOptions, ToolMessage, GeneratedImage, ProcessMessageResult, StreamingState } from './types'

import { isOperatorWhisperSend } from './whisper-send'
import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import {
  loadAndProcessFiles,
  buildMessageContext,
} from './context-builder.service'
import { collectTurnExtras, extractToolNames, spliceTurnExtras } from './turn-extras'
import {
  createTurnStatusEmitter,
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeTurnStartEvent,
  encodeCarinaAnswerEvent,
  encodeHostAnnouncementEvent,
  encodePascalResultEvent,
  encodeChainCompleteEvent,
  encodeTurnCompleteEvent,
  encodeStorytellerRoundEvent,
  encodeStorytellerBidEvent,
  encodeRoundOpenEvent,
  safeEnqueue,
  type TurnStatusEmitter,
} from './streaming.service'
import { buildBidOffer, callForBid } from '@/lib/storyteller/bid-call'
import { buildBidSection, buildPlanSection } from '@/lib/storyteller/prompts'
import type { StorytellerBidCallOutcome, StorytellerBidOffer, StorytellerTurnContext } from '@/lib/storyteller/types'
import type { StorytellerOrder } from '@/lib/schemas/storyteller.types'
import { runDry } from '@/lib/repositories/dry-scope'
import { sinkController, taggingController } from '@/lib/storyteller/sse-tag'
import { finalizeMessageResponse, runStorytellerRoundHousekeeping } from './message-finalizer.service'
import { dispatchCourierTransport } from './courier-transport.service'
import { getConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { triggerAfterTurnsHousekeeping } from './memory-trigger.service'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { profileParams } from '@/lib/llm/cheap-llm'
import { runPreContextPreCompute } from './pre-compute.service'
import { findPreviousResponseId, makePreservePartialOnError, runPrimaryStream } from './primary-stream.service'
import { runNativeToolLoop } from './native-tool-loop.service'
import { resolveAgentModeSetting } from './agent-mode-resolver.service'
import { resolveUserIdentity } from './user-identity-resolver.service'
import { executeTurnChain } from './turn-orchestrator.service'
import { resolveMessageDangerState } from './danger-orchestrator.service'
import { attemptEmptyResponseRecovery } from './provider-failover.service'
import { openTurnStream, newSubmissionLedger, type SubmissionLedger } from './turn-stream'
import { recordOperatorPost } from './operator-post.service'
import {
  finishHeldPost,
  maybePauseForUserSeatTurn,
  qualifiesForFairRotationCheck,
  resolveTurnHold,
} from './turn-holds.service'
import {
  reinjectProsperoContext,
  resolveContextCompressionSettings,
  resolveTurnApiKey,
  resolveTurnSkipOffer,
  selectTurnCheapLLM,
  spendFullContextRequest,
} from './turn-preparation.service'
import { buildTurnToolContext, resolveTurnToolSlate, runTurnTextToolPasses, type TurnToolSlate } from './turn-tools.service'
import { settleTurn } from './turn-outcome.service'

const logger = createServiceLogger('ChatMessageOrchestrator')

/**
 * Schema for pending tool results (user-initiated tool calls shown in composer)
 */
const pendingToolResultSchema = z.object({
  tool: z.string(),
  success: z.boolean(),
  result: z.string(),
  prompt: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})

/**
 * Validation schema for send message
 * Content can be empty if there are pending tool results or file attachments
 */
export const sendMessageSchema = z.object({
  content: z.string().default(''),
  fileIds: z.array(z.string()).optional(),
  /** Pending tool results to be saved as TOOL messages before the user message */
  pendingToolResults: z.array(pendingToolResultSchema).optional(),
  /** Target participant IDs for whisper messages */
  targetParticipantIds: z.array(z.string()).nullable().optional(),
  /** The user-controlled participant the human is "Speaking As" for this message */
  speakingAsParticipantId: z.uuid().nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.content.trim().length === 0 &&
      (!data.fileIds || data.fileIds.length === 0) &&
      (!data.pendingToolResults || data.pendingToolResults.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Message must have content, attached files, or tool results',
    })
  }
})

/**
 * Validation schema for continue mode (nudge action)
 */
export const continueMessageSchema = z.object({
  continueMode: z.literal(true),
  respondingParticipantId: z.uuid().optional(),
  /** The user-controlled participant the human is "Speaking As" (for context/identity) */
  speakingAsParticipantId: z.uuid().nullable().optional(),
  /**
   * Nudge: the human explicitly summoned this character (Nudge button). When
   * true, the "nothing to add" skip option is withheld for this turn.
   */
  nudge: z.boolean().optional(),
})

/**
 * Handle sending a message and streaming the response
 */
export async function handleSendMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: SendMessageOptions
): Promise<ReadableStream<Uint8Array>> {
  // The whole stream — first turn, chain, post-chain triggers — runs under one
  // turn-control handle (openTurnStream), so the operator's Stop and raised
  // hand reach every turn it carries.
  return openTurnStream(chatId, async (controller, encoder, ledger) => {
    const isWhisper = isOperatorWhisperSend(options)
    if (isWhisper) {
      const waitedOn = await waitForEarlierTurns(chatId)
      logger.debug('[Orchestrator] Whisper send: single reply, no chain', { chatId, waitedOn })
    }

    const result = await processMessage(repos, chatId, userId, options, controller, encoder, ledger)

    // Storyteller: the post is recorded; open a round of bids instead of a
    // reply. The stream carries the bids as they land and ends with
    // `roundOpen`; the operator's choice comes back on its own request.
    if (result.storytellerHold) {
      await openRoundOnSend({ chatId, userId, hold: result.storytellerHold, controller, encoder })
      return
    }

    // Storyteller mode never chains: a nudge (or Continue) runs one turn, with
    // no ceiling, and the floor returns to the operator.
    const storytellerSingleTurn = options.continueMode === true
      && options.neverPauseForUser !== true
      && (await repos.chats.findById(chatId))?.turnMode === 'storyteller'

    await executeTurnChain({
      repos,
      chatId,
      userId,
      initialResult: result,
      initialContinueMode: options.continueMode === true,
      controller,
      encoder,
      processChainedMessage: (chainOptions) => processMessage(
        repos,
        chatId,
        userId,
        // Autonomous-room chain turns inherit the same flags as the initial call.
        {
          ...chainOptions,
          neverPauseForUser: options.neverPauseForUser,
          suppressAutomaticImages: options.suppressAutomaticImages,
          singleTurn: options.singleTurn,
          autonomousContextCap: options.autonomousContextCap,
        },
        controller,
        encoder,
        ledger
      ),
      neverPauseForUser: options.neverPauseForUser === true,
      // A whisper's target answers once; the floor then goes back to the
      // operator (bug 258).
      singleTurn: options.singleTurn === true || isWhisper || storytellerSingleTurn,
    })

    // Once after the first turn and any chain: scene tracking and the
    // Scriptorium render, when a character actually spoke.
    if (result.hasContent) {
      await triggerAfterTurnsHousekeeping(repos, {
        chatId,
        userId,
        sceneTracking: result.sceneTrackingContext,
      })
    }
  })
}

/**
 * Storyteller: open a round for a recorded operator post, streaming the board
 * as it fills. An `@Name:` post opens none — it was answered already.
 */
async function openRoundOnSend(params: {
  chatId: string
  userId: string
  hold: NonNullable<ProcessMessageResult['storytellerHold']>
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}): Promise<void> {
  const { chatId, userId, hold, controller, encoder } = params
  if (hold.carina) {
    logger.debug('[Storyteller] Carina query — no round opens', { chatId })
    safeEnqueue(controller, encodeChainCompleteEvent(encoder, { reason: 'user_turn', nextSpeakerId: null, chainDepth: 0 }))
    return
  }
  const { openStorytellerRound } = await import('@/lib/storyteller/round.service')
  let roundId: string | null = null
  const round = await openStorytellerRound({
    chatId,
    userId,
    triggerMessageId: hold.triggerMessageId,
    onRound: (opened) => {
      roundId = opened.id
      safeEnqueue(controller, encodeStorytellerRoundEvent(encoder, opened))
    },
    // Late bids (after the board timeout) find the stream closed; safeEnqueue
    // drops them and the board hears of them through realtime instead.
    onBid: (bid) => {
      if (roundId) safeEnqueue(controller, encodeStorytellerBidEvent(encoder, { roundId, bid }))
    },
  })
  safeEnqueue(controller, encodeRoundOpenEvent(encoder, { roundId: round.id }))
  safeEnqueue(controller, encodeChainCompleteEvent(encoder, { reason: 'round_open', nextSpeakerId: null, chainDepth: 0 }))
}

/**
 * Storyteller: build one seat's BID — the same context a turn would see, the
 * bid section trailing, one call with tools offered and none callable — inside
 * a dry scope, so nothing the build touches is written: no staff whisper, no
 * recall stamp, no consumed inform or raised hand. Only the LLM log row lands.
 */
export async function runStorytellerBid(params: {
  chatId: string
  userId: string
  participantId: string
  roundId: string
}): Promise<StorytellerBidCallOutcome> {
  const { chatId, userId, participantId, roundId } = params
  return runDry(`storyteller-bid:${participantId}`, async () => {
    try {
      const result = await processMessage(
        getRepositories(),
        chatId,
        userId,
        { continueMode: true, respondingParticipantId: participantId, storytellerBid: { roundId } },
        sinkController(),
        new TextEncoder(),
        newSubmissionLedger()
      )
      return result.bid ?? { ok: false, reason: 'The bid could not be built' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn('[Storyteller] Bid build failed', { chatId, participantId, roundId, error: reason })
      return { ok: false, reason }
    }
  })
}

/**
 * Storyteller: run the operator's selection for an open round, as an SSE
 * stream in the Salon's chain dialect — a `turnStart` (depth ≥ 1) before each
 * speaker, a `turnComplete` after, one `chainComplete` at the end. "All at
 * once" Simple / Lookup turns share the stream concurrently, each frame tagged
 * with its participant (`concurrent: true`). Validation happens before the
 * stream exists, so a bad selection is an ordinary 4xx.
 */
export async function handleStorytellerRun(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  request: { roundId: string; participantIds: string[]; order: StorytellerOrder; keepOrder?: boolean }
): Promise<ReadableStream<Uint8Array>> {
  const { planStorytellerRun, runStorytellerRound } = await import('@/lib/storyteller/round.service')
  const { round, turns } = await planStorytellerRun({ chatId, ...request })

  return openTurnStream(chatId, async (controller, encoder, ledger) => {
    const outcome = await runStorytellerRound({
      chatId,
      round,
      turns,
      order: request.order,
      runTurn: async (turn, storyteller) => {
        const turnController = turn.concurrent ? taggingController(controller, turn.participantId) : controller
        const result = await processMessage(
          repos,
          chatId,
          userId,
          { continueMode: true, respondingParticipantId: turn.participantId, storyteller },
          turnController,
          encoder,
          ledger
        )
        return {
          spoke: result.hasContent && !result.skipped,
          yielded: result.yielded === true,
          messageId: result.messageId,
          sceneTrackingContext: result.sceneTrackingContext,
        }
      },
      onTurnStart: (turn, depth) => {
        if (turn.concurrent) return
        safeEnqueue(controller, encodeTurnStartEvent(encoder, {
          participantId: turn.participantId,
          characterName: turn.characterName,
          chainDepth: depth,
        }))
      },
      onTurnEnd: (turn, depth, result) => {
        if (turn.concurrent) return
        safeEnqueue(controller, encodeTurnCompleteEvent(encoder, {
          participantId: turn.participantId,
          messageId: result.messageId ?? '',
          chainDepth: depth,
          skipped: !result.spoke || undefined,
        }))
      },
    })

    // Once for the whole round: memory extraction, the summary fold (and its
    // title check), danger classification, scene tracking and the Scriptorium
    // render. Every trigger enqueues and none throws.
    const tracking = outcome.lastOutcome?.sceneTrackingContext
    if (tracking) {
      await runStorytellerRoundHousekeeping(repos, {
        chatId,
        userId,
        connectionProfile: tracking.connectionProfile,
        memoryChatSettings: tracking.memoryChatSettings,
      })
      await triggerAfterTurnsHousekeeping(repos, { chatId, userId, sceneTracking: tracking })
    }

    safeEnqueue(controller, encodeChainCompleteEvent(encoder, outcome.ended === 'stopped'
      ? { reason: 'stopped', nextSpeakerId: null, chainDepth: turns.length, paused: true }
      : outcome.ended === 'yielded'
        ? { reason: 'yielded', nextSpeakerId: null, chainDepth: turns.length }
        : { reason: 'user_turn', nextSpeakerId: null, chainDepth: turns.length }))
  })
}

/**
 * Build and run one character's turn — or, when the post is held, record it
 * and stop before any character is asked.
 */
async function processMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: SendMessageOptions,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  ledger: SubmissionLedger
): Promise<ProcessMessageResult> {
  const isContinueMode = options.continueMode === true
  // A storyteller bid: a dry, plan-only build for one seat (see runStorytellerBid).
  const isBid = !!options.storytellerBid
  const storytellerTurn = options.storyteller

  // Initial status — user sees this immediately after sending
  createTurnStatusEmitter(controller, encoder)('initializing', 'Loading chat...')

  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    throw new Error('Chat not found')
  }

  // ==========================================================================
  // 1. Hold — is this post answered at all?
  // ==========================================================================
  const hold = resolveTurnHold(chat, options)
  if (hold) {
    logger.info('[Orchestrator] Recording the operator post without a reply', {
      chatId,
      userId,
      hold,
      hasContent: !!options.content,
      attachmentCount: options.fileIds?.length ?? 0,
    })
  }

  // The human's "Speaking As" selection: an explicit per-turn override from the
  // composer takes precedence over the persisted chat field (avoids a read-back
  // race where the set-active-speaker write hasn't landed yet).
  const speakingAsParticipantId = options.speakingAsParticipantId ?? chat.activeTypingParticipantId ?? null

  if (qualifiesForFairRotationCheck(chat, options, hold)) {
    const pauseResult = await maybePauseForUserSeatTurn({
      repos, chatId, chat, userId, options, speakingAsParticipantId, ledger, controller, encoder,
    })
    if (pauseResult) return pauseResult
  }

  // ==========================================================================
  // 2. Prepare — who answers, on what, with which settings
  // ==========================================================================
  // A whisper's target answers it (not the default first character).
  const respondingId = options.respondingParticipantId
    || (options.targetParticipantIds?.length ? options.targetParticipantIds[0] : undefined)

  const {
    characterParticipant,
    character,
    connectionProfile,
    apiKey: rawApiKey,
    imageProfileId,
    userParticipant,
    userParticipantId,
    isMultiCharacter,
  } = await resolveRespondingParticipant(
    repos,
    chat,
    userId,
    respondingId,
    isContinueMode,
    speakingAsParticipantId
  )
  const status = createTurnStatusEmitter(controller, encoder, character)

  // Tell the client which participant is actually responding before any
  // content arrives, so the streaming bubble's avatar/name is the server's
  // choice rather than the client's guess. Chained turns 2+ get the same event
  // from the turn orchestrator.
  safeEnqueue(controller, encodeTurnStartEvent(encoder, {
    participantId: characterParticipant.id,
    characterName: character.name,
    chainDepth: 0,
  }))
  status('resolving', `Setting up ${character.name}...`)

  // Nudge (the human summoned this voice): the Host announces the invitation
  // so it persists in the transcript. The `nudge` flag rides only on the
  // summoned request, never on the chained turns that follow.
  if (isContinueMode && options.nudge === true) {
    const nudgeMessage = await postHostNudgeAnnouncement({
      chatId,
      characterName: character.name,
      participantId: characterParticipant.id,
    })
    if (nudgeMessage) {
      safeEnqueue(controller, encodeHostAnnouncementEvent(encoder, nudgeMessage))
    }
  }

  const apiKey = resolveTurnApiKey(connectionProfile, rawApiKey)

  // User identity: user-controlled character in chat → sole user-controlled
  // character → user profile → "User".
  const resolvedIdentity = await resolveUserIdentity(repos, userId, chat, speakingAsParticipantId)
  const userCharacter = { name: resolvedIdentity.name, description: resolvedIdentity.description }

  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const project = chat.projectId ? await repos.projects.findById(chat.projectId) : null

  const agentMode = resolveAgentModeSetting(chat, project, character, chatSettings)
  // A new user message starts the agent's turn count over.
  if (!isContinueMode && agentMode.enabled) {
    await repos.chats.update(chatId, { agentTurnCount: 0 })
  }

  const bypassCompression = await spendFullContextRequest(repos, chat, hold !== null)
  const contextCompressionSettings = resolveContextCompressionSettings(chatSettings)
  const { cheapLLMSelection, allProfiles } = await selectTurnCheapLLM({ repos, userId, chatSettings, connectionProfile })
  const compressionEnabled = !!(contextCompressionSettings.enabled && cheapLLMSelection && !bypassCompression)

  const dangerState = await resolveMessageDangerState({
    repos,
    chatId,
    userId,
    chat,
    chatSettings,
    character,
    isContinueMode,
    content: options.content,
    cheapLLMSelection,
    connectionProfile,
    apiKey,
    controller,
    encoder,
  })
  const { dangerFlags, conciergePolicy } = dangerState
  // Flagged by the pre-screen, or headed straight for the uncensored desk on an
  // Unmoderated chat (which writes no per-message flags): either way the
  // failover service reads an empty body as a refusal and clears stand-ins for
  // the content.
  const contentTreatedAsDangerous = (dangerFlags?.length ?? 0) > 0 || dangerState.routedDirect

  // Mutable streaming state — threaded through failover and finalization by reference
  const streamingState: StreamingState = {
    fullResponse: '',
    effectiveProfile: dangerState.effectiveProfile,
    effectiveApiKey: dangerState.effectiveApiKey,
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    rawResponse: null,
    thoughtSignature: undefined,
    reasoningContent: undefined,
    hasStartedStreaming: false,
    // The route trail starts empty and is written only by route-trail.ts.
    routeFailures: [],
    // The Concierge's *pre-call* reroute swapped the profile before anything
    // was tried, so the original gets no row — but the profile now holding the
    // turn was sent by the Concierge, and the trail should say so if it in turn
    // fails and an understudy answers.
    routeVia: dangerState.effectiveProfile.id !== connectionProfile.id ? 'concierge' : 'primary',
  }

  const roleplayTemplate = await getRoleplayTemplate(repos, chat, chatSettings ? { defaultRoleplayTemplateId: chatSettings.defaultRoleplayTemplateId ?? undefined } : null)
  const imageProfile = imageProfileId ? await repos.imageProfiles.findById(imageProfileId) : null
  const participantCharacters = isMultiCharacter
    ? (await loadAllParticipantData(repos, chat, character)).participantCharacters
    : new Map()

  const existingMessages = await repos.chats.getMessages(chatId)

  const turnSkip = resolveTurnSkipOffer({
    chat,
    existingMessages,
    character,
    characterParticipant,
    isStorytellerTurn: !!storytellerTurn,
    isBid,
    summoned: options.nudge === true || options.chainSelectionReason === 'queue',
  })

  // Raised hand: the first LLM-voiced turn built after the operator raised a
  // hand is asked whether to yield. Taking the hand consumes it, so a decline
  // lowers it and nobody after is asked. A held post builds no reply to ask
  // in, and a bid is not a turn: neither takes the hand.
  const offerYield = characterParticipant.controlledBy !== 'user'
    && !hold
    && !isBid
    && takeRaisedHand()
  if (offerYield) {
    logger.info('[TurnYield] Asking the next speaker whether to yield to the raised hand', {
      chatId,
      characterId: character.id,
      participantId: characterParticipant.id,
    })
  }

  if (!hold && !isBid) {
    await reinjectProsperoContext({
      chatId,
      project,
      existingMessages,
      reinjectInterval: contextCompressionSettings.projectContextReinjectInterval ?? 5,
      // Concurrent storyteller turns share one message count: the group's
      // first posts the public briefing, and the rest only their own whispers.
      concurrentFollower: !!storytellerTurn?.concurrentFollower,
      character,
      characterParticipant,
    })
  }

  if (options.fileIds && options.fileIds.length > 0) {
    status('processing_files', 'Processing attachments...')
  }
  const fileProcessing = await loadAndProcessFiles(repos, chatId, userId, connectionProfile, options.fileIds)

  // ==========================================================================
  // 3. Record — the operator's post (nothing to record in continue mode)
  // ==========================================================================
  const content = isContinueMode ? '' : (options.content ?? '')
  const { userMessageId } = isContinueMode
    ? { userMessageId: null }
    : await recordOperatorPost({
        repos,
        chatId,
        userId,
        chat,
        chatSettings,
        content,
        fileIds: options.fileIds,
        attachedFiles: fileProcessing.attachedFiles,
        pendingToolResults: options.pendingToolResults,
        targetParticipantIds: options.targetParticipantIds,
        poster: { participant: userParticipant, participantId: userParticipantId },
        dangerFlags,
        context: existingMessages,
        ledger,
        controller,
        encoder,
        status,
      })

  // Everything above belongs to the message the operator just wrote;
  // everything below to a character's turn, which a held post grants none.
  // Stop here, before a single token is spent on tools, context or the model.
  if (hold) {
    return finishHeldPost({
      repos,
      chatId,
      hold,
      isMultiCharacter,
      userMessageId,
      userParticipantId,
      content,
      controller,
      encoder,
    })
  }

  // ==========================================================================
  // 4. Tools — the slate this character holds this turn
  // ==========================================================================
  // Tools are always sent with every LLM prompt to ensure consistent availability.
  status('loading_tools', `Loading tools for ${character.name}...`)
  const slate = await resolveTurnToolSlate({
    repos,
    chat,
    userId,
    chatSettings,
    character,
    profile: streamingState.effectiveProfile,
    imageProfileId,
    imageProfile,
    compressionEnabled,
    agentModeEnabled: agentMode.enabled,
    isMultiCharacter,
    storytellerCeiling: storytellerTurn?.effectCeiling,
  })
  const isEffectiveCourier = streamingState.effectiveProfile.transport === 'courier'

  // ==========================================================================
  // 5. Context — recall, compression, the prompt
  // ==========================================================================
  const modelParams = profileParams(streamingState.effectiveProfile) ?? {}

  // Characters present this turn: the responder plus every other character
  // participant (participantCharacters is empty in single-character chats).
  // Memories ABOUT a present character get the participant-aware boost.
  const presentAboutCharacterIds = Array.from(
    new Set(
      [character.id, ...participantCharacters.keys()].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  )
  const presentParticipantNames = [character.name, ...[...participantCharacters.values()].map(c => c.name)]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  const { cachedCompressionResponse, preRecall, stopKeepAlive } = await runPreContextPreCompute({
    chatId,
    userId,
    chat,
    character,
    characterParticipant,
    isMultiCharacter,
    presentAboutCharacterIds,
    presentParticipantNames,
    isContinueMode,
    content,
    existingMessages,
    compressionEnabled,
    bypassCompression,
    cheapLLMSelection,
    conciergePolicy,
    allProfiles,
    controller,
    encoder,
  })

  // Everything this turn adds to the payload *after* the context is built —
  // the tool schemas and the agent-mode / tool-change system messages —
  // measured now, so the builder holds room for them. The same strings are
  // spliced in below.
  const turnExtras = collectTurnExtras({
    tools: slate.actualTools,
    agentMode,
    toolSettingsChanged: slate.toolSettingsChanged,
    provider: streamingState.effectiveProfile.provider,
  })

  const { bidOffer, storytellerSection } = buildStorytellerSection({
    chatId,
    isBid,
    storytellerTurn,
    slate,
    character,
    characterParticipant,
  })

  status('gathering', 'Gathering memories and context...')
  const { builtContext, formattedMessages } = await buildMessageContext(
    {
      repos,
      userId,
      chat,
      character,
      characterParticipant,
      connectionProfile: streamingState.effectiveProfile,
      userCharacter,
      isMultiCharacter,
      participantCharacters,
      roleplayTemplate,
      chatSettings: chatSettings ? {
        cheapLLMSettings: chatSettings.cheapLLMSettings ? {} : undefined,
        defaultTimestampConfig: chatSettings.defaultTimestampConfig,
      } : null,
      toolInstructions: slate.toolInstructions,
      newUserMessage: isContinueMode ? undefined : fileProcessing.messageContentPrefix + content,
      activeUserParticipantId: speakingAsParticipantId,
      isContinueMode,
      contextCompressionSettings: compressionEnabled ? contextCompressionSettings : null,
      cheapLLMSelection,
      bypassCompression,
      // Autonomous-room per-turn context cap (tokens). Clamps the model-derived
      // budget so a token-budgeted room paces its run across multiple turns.
      autonomousContextCap: options.autonomousContextCap,
      reservedOutgoingTokens: turnExtras.reservedTokens,
      // A storyteller turn's plan section carries its own pass instruction.
      turnSkip: storytellerTurn ? undefined : turnSkip,
      offerYield,
      // A bid builds dry and delivers no recall; the bid or plan section
      // trails everything else.
      purpose: isBid ? 'bid' : 'turn',
      storytellerSection,
      cachedCompressionResult: cachedCompressionResponse?.result,
      cachedCompressionMessageCount: cachedCompressionResponse?.cachedMessageCount,
      preRecall,
      // Memory recap: uncensored fallback for Unmoderated chats. The policy
      // routes direct only when the Concierge is on duty and the chat is
      // Unmoderated, so off-duty and exempt chats never engage it.
      uncensoredFallbackOptions: (conciergePolicy?.routeDirect && cheapLLMSelection)
        ? { conciergePolicy, availableProfiles: allProfiles, isDangerousChat: true }
        : undefined,
      onStatusChange: status,
    },
    existingMessages,
    fileProcessing.attachmentsToSend
  )
  stopKeepAlive()

  // Prevents "Calculating context budget..." from lingering through pre-send setup.
  status('preparing', `Preparing request for ${character.name}...`)

  // The Courier (manual / clipboard transport) short-circuits before the tool
  // and streaming machinery: it renders the request, parks a placeholder,
  // pauses the chat, and the paste resolver resumes it.
  if (isEffectiveCourier) {
    if (isBid) {
      // The Courier is a person with a clipboard; there is nobody to ask for a bid.
      return {
        isMultiCharacter,
        hasContent: false,
        messageId: null,
        userParticipantId,
        isPaused: chat.isPaused,
        bid: { ok: false, reason: 'This character answers through the Courier, which cannot bid.' },
      }
    }
    return dispatchCourierTransport({
      repos,
      chatId,
      chat,
      character,
      characterParticipant,
      userParticipantId,
      isMultiCharacter,
      participantCharacters,
      resolvedIdentity,
      formattedMessages,
      streaming: streamingState,
      controller,
      encoder,
    })
  }

  const toolContext = buildTurnToolContext({
    chat,
    userId,
    character,
    characterParticipant,
    imageProfileId,
    browserUserAgent: options.browserUserAgent,
    builtContext,
    slate,
    emitCarinaAnswer: (msg) => safeEnqueue(controller, encodeCarinaAnswerEvent(encoder, msg)),
    emitPascalResult: (msg) => safeEnqueue(controller, encodePascalResultEvent(encoder, msg)),
  })

  spliceTurnExtras(formattedMessages, turnExtras)
  if (turnExtras.toolChangeNotice) {
    const toolNames = extractToolNames(slate.actualTools)
    logger.info('Injected tool change notification', { chatId, toolCount: toolNames.length, tools: toolNames })
  }
  if (turnExtras.agentModeInstructions) {
    logger.info('Injected agent mode instructions', {
      chatId,
      maxTurns: agentMode.maxTurns,
      enabledSource: agentMode.enabledSource,
    })
  }

  // A storyteller bid: one call, nothing saved or streamed.
  if (isBid && bidOffer) {
    const bid = await callForBid({
      messages: formattedMessages,
      connectionProfile: streamingState.effectiveProfile,
      apiKey: streamingState.effectiveApiKey,
      modelParams,
      tools: slate.actualTools,
      useNativeWebSearch: false,
      userId,
      chatId,
      characterId: character.id,
    }, bidOffer)
    return {
      isMultiCharacter,
      hasContent: false,
      messageId: null,
      userParticipantId,
      isPaused: chat.isPaused,
      bid,
    }
  }

  safeEnqueue(controller, encodeDebugInfo(encoder, {
    builtContext,
    connectionProfile: streamingState.effectiveProfile,
    modelParams,
    messages: formattedMessages.map(m => ({
      role: m.role,
      contentLength: m.content.length,
      hasAttachments: !!m.attachments?.length,
    })),
    tools: slate.actualTools,
    enabledToolOptions: slate.enabledToolOptions as unknown as Record<string, boolean>,
  }))
  if (fileProcessing.fallbackResults.length > 0) {
    safeEnqueue(controller, encodeFallbackInfo(encoder, fileProcessing.fallbackResults))
  }

  status('validating', `Validating context for ${character.name}...`)
  warnIfOverSafeInputLimit({
    chatId,
    character,
    streaming: streamingState,
    formattedMessages,
    builtContext,
    turnExtras,
    toolCount: slate.actualTools.length,
    status,
  })

  // ==========================================================================
  // 6. Generate — the stream, the tool loops, empty-response recovery
  // ==========================================================================
  // Minted before the call so log rows can reference the reply.
  const preGeneratedAssistantMessageId = crypto.randomUUID()

  // Idempotent partial-response preserver shared across every streamMessage
  // call this turn: the first call that finds streamed content writes it with
  // an OOC marker, later calls no-op so the original error still propagates.
  const preservePartialOnError = makePreservePartialOnError({
    repos,
    chatId,
    character,
    characterParticipant,
    streaming: streamingState,
    preGeneratedAssistantMessageId,
    // A preserved partial is a persisted turn, so it spends this turn's
    // informs exactly as a completed one does.
    informRowIds: builtContext.informRowIds,
    mailAlertsOwed: builtContext.mailAlertsOwed,
  })

  const primaryStreamResult = await runPrimaryStream({
    repos,
    chatId,
    userId,
    chat,
    character,
    characterParticipant,
    userParticipantId,
    isMultiCharacter,
    formattedMessages,
    modelParams,
    actualTools: slate.actualTools,
    useNativeWebSearch: slate.useNativeWebSearch,
    previousResponseId: findPreviousResponseId(
      streamingState.effectiveProfile.provider,
      existingMessages as MessageEvent[]
    ),
    stop: slate.stopSequences,
    preGeneratedAssistantMessageId,
    attachedFiles: fileProcessing.attachedFiles,
    originalMessage: options.content,
    connectionProfile,
    // Dangerous-routed context: the Concierge either flagged this content or
    // swapped the profile out for an uncensored one. Either way an auto-picked
    // stand-in must be cleared for it, or the fallback would hand the content
    // straight back to the moderation that refused it.
    isDangerousRouted:
      contentTreatedAsDangerous || streamingState.effectiveProfile.id !== connectionProfile.id,
    conciergePolicy,
    streaming: streamingState,
    controller,
    encoder,
    preservePartialOnError,
  })
  if (primaryStreamResult.earlyReturn) {
    return primaryStreamResult.earlyReturn
  }

  // Native function-calling loop (agent-mode submit_final_response, the
  // ghost-wrap guardrail and the max-turns force-final pass live there too),
  // then the text-format passes.
  const toolMessages: ToolMessage[] = []
  const generatedImagePaths: GeneratedImage[] = []
  const toolLoopShared = {
    chatId,
    userId,
    character,
    preGeneratedAssistantMessageId,
    formattedMessages,
    modelParams,
    toolContext,
    streaming: streamingState,
    toolMessages,
    generatedImagePaths,
    controller,
    encoder,
    preservePartialOnError,
  }
  await runNativeToolLoop({
    ...toolLoopShared,
    repos,
    characterParticipant,
    agentMode,
    actualTools: slate.actualTools,
    useNativeWebSearch: slate.useNativeWebSearch,
  })
  await runTurnTextToolPasses({
    ...toolLoopShared,
    resolvedToolMode: slate.resolvedToolMode,
    useTextBlockTools: slate.useTextBlockTools,
    actualTools: slate.actualTools,
    useNativeWebSearch: slate.useNativeWebSearch,
  })

  const recovery = await attemptEmptyResponseRecovery({
    state: streamingState,
    toolMessagesLength: toolMessages.length,
    contentWasFlaggedDangerous: contentTreatedAsDangerous,
    conciergePolicy,
    conciergeState: getConciergeState(chat),
    connectionProfile,
    formattedMessages,
    modelParams,
    actualTools: slate.actualTools,
    useNativeWebSearch: slate.useNativeWebSearch,
    userId,
    chatId,
    character,
    controller,
    encoder,
    preGeneratedAssistantMessageId,
    repos,
    stop: slate.stopSequences,
    fallbackContext: {
      dangerous: contentTreatedAsDangerous,
      // Read from the array, not from what the user uploaded: an image the
      // primary could not take was already replaced by its description
      // upstream, and a chain that still called the turn vision-bearing
      // would skip understudies that are perfectly able to answer it.
      needsVision: collectAttachmentMimeTypes(formattedMessages).some((m) => m.startsWith('image/')),
      needsTools: slate.actualTools.length > 0,
    },
  })

  // ==========================================================================
  // 7. Settle — reply, pass, yield, stop or empty
  // ==========================================================================
  return settleTurn({
    repos,
    chatId,
    userId,
    chat,
    character,
    characterParticipant,
    isMultiCharacter,
    userParticipantId,
    operatorName: resolvedIdentity.name,
    offerYield,
    turnSkip,
    streaming: streamingState,
    toolMessages,
    generatedImagePaths,
    toolContext,
    mailAlertsOwed: builtContext.mailAlertsOwed,
    recovery,
    contentWasFlaggedDangerous: contentTreatedAsDangerous,
    conciergePolicy,
    controller,
    encoder,
    finalizeReply: () => finalizeMessageResponse({
      repos,
      chatId,
      userId,
      chat,
      character,
      characterParticipant,
      userParticipantId,
      isMultiCharacter,
      isContinueMode,
      generatedImagePaths,
      toolMessages,
      preGeneratedAssistantMessageId,
      connectionProfile,
      controller,
      encoder,
      streaming: streamingState,
      compression: {
        existingMessages: existingMessages as MessageEvent[],
        content,
        builtContext,
        compressionEnabled,
        cheapLLMSelection,
        contextCompressionSettings,
        allProfiles,
      },
      storyteller: storytellerTurn,
      triggers: {
        conciergePolicy,
        chatSettings,
        participantCharacters,
        resolvedIdentity,
        userCharacterId: resolvedIdentity.characterId || undefined,
      },
    }),
  })
}

/**
 * Storyteller: the bid section, or a speaking turn's plan. Both ride as the
 * last trailing section, never in the system prefix, so a bid shares the
 * character's cached prefix with the turn it may become.
 */
function buildStorytellerSection(params: {
  chatId: string
  isBid: boolean
  storytellerTurn: StorytellerTurnContext | undefined
  slate: TurnToolSlate
  character: { name: string; talkativeness?: number | null }
  characterParticipant: { id: string; status?: string; talkativeness?: number | null }
}): { bidOffer: StorytellerBidOffer | null; storytellerSection: string | undefined } {
  const { isBid, storytellerTurn, slate, character, characterParticipant } = params
  if (isBid) {
    const bidOffer = buildBidOffer({
      tools: slate.tools,
      customToolEffects: slate.customToolEffects,
      pluginToolEffects: slate.pluginToolEffects,
      silent: characterParticipant.status === 'silent',
    })
    return {
      bidOffer,
      storytellerSection: buildBidSection({
        characterName: character.name,
        talkativeness: characterParticipant.talkativeness ?? character.talkativeness ?? 0.5,
        offer: bidOffer,
      }),
    }
  }
  if (!storytellerTurn) return { bidOffer: null, storytellerSection: undefined }

  logger.debug('[Storyteller] Speaking turn carries its bid', {
    chatId: params.chatId,
    participantId: characterParticipant.id,
    roundId: storytellerTurn.bidRecord.roundId,
    tier: storytellerTurn.bidRecord.tier,
    ceiling: slate.effectCeiling,
  })
  return {
    bidOffer: null,
    storytellerSection: buildPlanSection({
      plan: storytellerTurn.bidRecord.plan,
      tier: storytellerTurn.bidRecord.tier,
      toolsNamed: storytellerTurn.bidRecord.toolsNamed,
      spokenSince: storytellerTurn.spokenSince,
      allowedTools: extractToolNames(slate.tools),
    }),
  }
}

/**
 * Pre-send check: does the assembled payload fit the model's window? The whole
 * payload is measured — the tool schemas ride beside the messages and count
 * against the same window — against the budget's own `safeInputLimit`, the
 * number the builder packed to, so this can't fire on a context filled exactly
 * as instructed. It warns rather than refuses: the provider decides.
 */
function warnIfOverSafeInputLimit(params: {
  chatId: string
  character: { name: string }
  streaming: StreamingState
  formattedMessages: Array<{ role: string; content: string }>
  builtContext: Awaited<ReturnType<typeof buildMessageContext>>['builtContext']
  turnExtras: ReturnType<typeof collectTurnExtras>
  toolCount: number
  status: TurnStatusEmitter
}): void {
  const { builtContext, turnExtras, streaming } = params
  const messageTokens = countMessagesTokens(
    params.formattedMessages.map(m => ({ content: m.content, role: m.role }))
  )
  const estimatedInputTokens = messageTokens + turnExtras.toolSchemaTokens
  const { safeInputLimit } = builtContext.budget
  if (estimatedInputTokens <= safeInputLimit) return

  logger.warn('Context exceeds model safe input limit, payload may be rejected', {
    chatId: params.chatId,
    characterName: params.character.name,
    provider: streaming.effectiveProfile.provider,
    model: streaming.effectiveProfile.modelName,
    estimatedInputTokens,
    messageTokens,
    toolSchemaTokens: turnExtras.toolSchemaTokens,
    toolCount: params.toolCount,
    safeInputLimit,
    modelContextLimit: builtContext.budget.totalLimit,
    responseReserve: builtContext.budget.responseReserve,
    safetyMargin: builtContext.budget.safetyMargin,
    reservedOutgoingTokens: turnExtras.reservedTokens,
    compressionApplied: builtContext.compressionApplied ?? false,
    overage: estimatedInputTokens - safeInputLimit,
  })
  params.status(
    'warning',
    `Context (~${Math.round(estimatedInputTokens / 1000)}k tokens) may exceed ${streaming.effectiveProfile.modelName} limit (~${Math.round(safeInputLimit / 1000)}k tokens)`
  )
}
