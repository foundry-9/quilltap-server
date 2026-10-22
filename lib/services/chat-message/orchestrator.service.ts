/**
 * Chat Message Orchestrator Service
 *
 * Coordinates all services for handling chat message sending.
 * This is the main entry point for the message API route.
 */

import { markMailAlertsDelivered, type MailAlertsOwed } from '@/lib/post-office/mailbox'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider } from '@/lib/llm'
import { acceptsApiKey, requiresApiKey } from '@/lib/plugins/provider-validation'
import {
  isMultiCharacterChat,
  computeSkipEligibility,
  detectSkipSentinel,
  computeSpokenThisCycleAfterSkip,
  computeCycleOrderAfterSkip,
  qualifiesForTurnSkipping,
  findActiveUserParticipant,
  isUserDrivenSeat,
  selectNextSpeakerAfterUserMessage,
  getPresentCharacterSeats,
  loadRoomCharacters,
  detectYieldSentinel,
} from '@/lib/chat/turn-manager'
import { runWithTurnControl, takeRaisedHand, isCurrentTurnStopped, waitForEarlierTurns } from '@/lib/chat/turn-control'
import { isOperatorWhisperSend } from './whisper-send'
import { collectAttachmentMimeTypes } from '@/lib/chat/message-attachment-adapter'
import { postHostTurnPassAnnouncement, postHostNudgeAnnouncement, postHostTurnYieldAnnouncement } from '@/lib/services/host-notifications/writer'
import { z } from 'zod'

import { getRepositories } from '@/lib/repositories/factory'
import type { MessageEvent, ConnectionProfile, Character, ChatMetadataBase } from '@/lib/schemas/types'

import type { SendMessageOptions, ToolMessage, GeneratedImage, ProcessMessageResult, StreamingState } from './types'

import { runUserMessageTriggers } from './trigger-phrase-sites'
import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import {
  loadAndProcessFiles,
  buildMessageContext,
} from './context-builder.service'
import { collectTurnExtras, extractToolNames } from './turn-extras'
import {
  loadProsperoProjectContext,
  loadProsperoGeneralContext,
  postProsperoContextAnnouncement,
  postProsperoGroupContextWhisper,
} from '@/lib/services/prospero-notifications/writer'
import { postLibrarianUploadAnnouncement } from '@/lib/services/librarian-notifications/writer'
import {
  saveToolMessages,
  createToolContext,
  type ToolWhisperContext,
} from './tool-execution.service'
import {
  buildTools,
  applyEffectCeilingToTools,
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeDoneEvent,
  encodeErrorEvent,
  encodeStatusEvent,
  encodeTurnStartEvent,
  encodeCarinaAnswerEvent,
  encodeHostAnnouncementEvent,
  encodeHandAnsweredEvent,
  encodePascalResultEvent,
  encodeChainCompleteEvent,
  encodeTurnCompleteEvent,
  encodeStorytellerRoundEvent,
  encodeStorytellerBidEvent,
  encodeRoundOpenEvent,
  safeEnqueue,
  safeClose,
} from './streaming.service'
import { lowerToolEffect, type ToolEffect } from '@/lib/tools/effects'
import { parseCarinaQuery } from '@/lib/chat/carina-parser'
import { buildBidOffer, callForBid } from '@/lib/storyteller/bid-call'
import { buildBidSection, buildPlanSection } from '@/lib/storyteller/prompts'
import type { StorytellerBidCallOutcome, StorytellerBidOffer } from '@/lib/storyteller/types'
import type { StorytellerOrder } from '@/lib/schemas/storyteller.types'
import { runDry } from '@/lib/repositories/dry-scope'
import { sinkController, taggingController } from '@/lib/storyteller/sse-tag'
import { runStorytellerRoundHousekeeping } from './message-finalizer.service'
import { dispatchCourierTransport } from './courier-transport.service'
import { getConciergeState } from '@/lib/services/dangerous-content/chat-override'
import {
  buildNativeToolSystemInstructions,
  determineEnabledToolOptions,
  checkShouldUseTextBlockTools,
  checkResolvedToolMode,
  buildTextBlockSystemInstructions,
  buildSimpleJsonSystemInstructions,
  parseTextBlocksFromResponse,
  stripTextBlockMarkersFromResponse,
  parseSimpleJsonFromResponse,
  stripSimpleJsonFromResponse,
  hasSimpleJsonInResponse,
  determineTextBlockToolOptions,
  logTextBlockToolUsage,
  logSimpleJsonToolUsage,
  formatSimpleJsonToolResult,
  SIMPLE_JSON_STOP,
} from './pseudo-tool.service'
import {
  hasTextBlockMarkers,
} from '@/lib/tools'
import { getProvider } from '@/lib/plugins/provider-registry'
import {
  triggerSceneStateTracking,
  triggerConversationRender,
} from './memory-trigger.service'
import { flushPendingWardrobeAnnouncements } from '@/lib/wardrobe/outfit-change-effects'
import { flushPendingInventoryAnnouncements } from '@/lib/inventory/equip-effects'
import { countMessagesTokens } from '@/lib/tokens/token-counter'
import { getCheapLLMProvider, profileParams, DEFAULT_CHEAP_LLM_CONFIG } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import type { RosterContext as CustomToolRosterContext } from '@/lib/pascal/custom-tools'
import { runPreContextPreCompute } from './pre-compute.service'
import { runTextToolPass } from './text-tool-loop.service'
import { findPreviousResponseId, makePreservePartialOnError, runPrimaryStream } from './primary-stream.service'
import { runNativeToolLoop } from './native-tool-loop.service'
import {
  detectAndConvertRngPatterns,
  type RngToolCall,
} from './rng-pattern-detector.service'
import { executeRngTool, formatRngResults } from '@/lib/tools/handlers/rng-handler'
import { runCarinaMarkupQuery } from '@/lib/services/carina/markup-runner'
import { shouldHoldUserTurnForPause } from './paused-hold'
import {
  finalizeMessageResponse,
} from './message-finalizer.service'
import {
  resolveAgentModeSetting,
  type ResolvedAgentMode,
} from './agent-mode-resolver.service'
import { resolveUserIdentity } from './user-identity-resolver.service'
import {
  executeTurnChain,
} from './turn-orchestrator.service'
import { resolveMessageDangerState } from './danger-orchestrator.service'
import {
  attemptEmptyResponseRecovery,
  getEmptyResponseReason,
} from './provider-failover.service'
import { extractFinishReason } from '@/lib/llm/extract-finish-reason'
import { isModerationFinishReason } from '@/lib/llm/moderation-finish-reason'
import type { DangerFlag } from '@/lib/schemas/chat.types'

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
 * What of the operator's submission has reached the database during one send
 * request. Flipped by `processMessage` right after each write succeeds and read
 * by `handleStreamError`, so the error frame can tell the Salon whether the
 * typed text has a row to fall back on or exists only in the client (bug 241).
 * Chained turns run in continue mode and never flip it.
 */
interface SubmissionLedger {
  userMessagePersisted: boolean
  pendingToolResultsPersisted: boolean
}

/**
 * Handle sending a message and streaming the response
 */
export async function handleSendMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: SendMessageOptions
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()
  const ledger: SubmissionLedger = { userMessagePersisted: false, pendingToolResultsPersisted: false }

  return new ReadableStream({
    async start(controller) {
      // The whole stream — first turn, chain, post-chain triggers — runs under
      // one turn-control handle, so the operator's Stop and raised hand reach
      // every turn it carries (lib/chat/turn-control.ts).
      await runWithTurnControl(chatId, async () => {
        try {
          const isWhisper = isOperatorWhisperSend(options)
          if (isWhisper) {
            const waitedOn = await waitForEarlierTurns(chatId)
            logger.debug('[Orchestrator] Whisper send: single reply, no chain', { chatId, waitedOn })
          }

          const result = await processMessage(repos, chatId, userId, options, controller, encoder, ledger)

          // Storyteller: the post is recorded; open a round of bids instead of
          // a reply. The stream carries the bids as they land and ends with
          // `roundOpen`; the operator's choice comes back on its own request.
          if (result.storytellerHold) {
            await openRoundOnSend({ chatId, userId, hold: result.storytellerHold, controller, encoder })
            safeClose(controller)
            return
          }

          // Storyteller mode never chains: a nudge (or Continue) runs one turn,
          // with no ceiling, and the floor returns to the operator.
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

          // Trigger scene state tracking once after processing (and after any turn chain)
          if (result.hasContent && result.sceneTrackingContext) {
            try {
              await triggerSceneStateTracking(repos, {
                chatId,
                userId,
                connectionProfile: result.sceneTrackingContext.connectionProfile,
                chatSettings: result.sceneTrackingContext.memoryChatSettings,
                characterIds: result.sceneTrackingContext.characterIds,
              })
            } catch (error) {
              logger.warn('Failed to trigger scene state tracking', {
                chatId,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          // Trigger conversation render (Scriptorium) - runs on every turn with content
          if (result.hasContent) {
            try {
              await triggerConversationRender(repos, { chatId, userId })
            } catch (error) {
              logger.warn('Failed to trigger conversation render', {
                chatId,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          safeClose(controller)
        } catch (error) {
          handleStreamError(error, controller, encoder, { chatId, ledger })
        }
      })
    },
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
        { userMessagePersisted: false, pendingToolResultsPersisted: false }
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
  request: { roundId: string; participantIds: string[]; order: StorytellerOrder }
): Promise<ReadableStream<Uint8Array>> {
  const { planStorytellerRun, runStorytellerRound } = await import('@/lib/storyteller/round.service')
  const { round, turns } = await planStorytellerRun({ chatId, ...request })
  const encoder = new TextEncoder()
  const ledger: SubmissionLedger = { userMessagePersisted: false, pendingToolResultsPersisted: false }

  return new ReadableStream({
    async start(controller) {
      await runWithTurnControl(chatId, async () => {
        try {
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

          // Once for the whole round: memory extraction, the summary fold
          // (and its title check), danger classification, scene tracking and
          // the Scriptorium render.
          const tracking = outcome.lastOutcome?.sceneTrackingContext
          if (tracking) {
            try {
              await runStorytellerRoundHousekeeping(repos, {
                chatId,
                userId,
                connectionProfile: tracking.connectionProfile,
                memoryChatSettings: tracking.memoryChatSettings,
              })
              await triggerSceneStateTracking(repos, {
                chatId,
                userId,
                connectionProfile: tracking.connectionProfile,
                chatSettings: tracking.memoryChatSettings,
                characterIds: tracking.characterIds,
              })
              await triggerConversationRender(repos, { chatId, userId })
            } catch (error) {
              logger.warn('[Storyteller] Round housekeeping failed', {
                chatId,
                roundId: round.id,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          safeEnqueue(controller, encodeChainCompleteEvent(encoder, outcome.ended === 'stopped'
            ? { reason: 'stopped', nextSpeakerId: null, chainDepth: turns.length, paused: true }
            : outcome.ended === 'yielded'
              ? { reason: 'yielded', nextSpeakerId: null, chainDepth: turns.length }
              : { reason: 'user_turn', nextSpeakerId: null, chainDepth: turns.length }))
          safeClose(controller)
        } catch (error) {
          handleStreamError(error, controller, encoder, { chatId, ledger })
        }
      })
    },
  })
}

/**
 * Main message processing logic
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

  // Initial status — user sees this immediately after sending
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'initializing',
    message: 'Loading chat...',
  }))

  // Get chat metadata
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    throw new Error('Chat not found')
  }

  // ============================================================================
  // Paused chat — hold the user's turn
  // ============================================================================
  // A paused conversation never moves on its own. A typed message is still
  // recorded in full (attachments, staged tool results, auto-detected rolls,
  // inline Carina queries) — it simply draws no reply: the floor stays where the
  // user left it until they nudge a specific character (one turn, still paused)
  // or press Resume. Continue-mode turns are the explicit summons themselves —
  // Nudge, Skip, the all-LLM modal's Continue, an autonomous-room turn — so they
  // are never held; the chain that would follow one is what `executeTurnChain`
  // stops while `isPaused` stands.
  const holdForPausedChat = shouldHoldUserTurnForPause({
    isContinueMode,
    chatIsPaused: chat.isPaused === true,
    neverPauseForUser: options.neverPauseForUser,
  })
  if (holdForPausedChat) {
    logger.info('[Orchestrator] Chat paused — recording the user message without a reply', {
      chatId,
      userId,
      hasContent: !!options.content,
      attachmentCount: options.fileIds?.length ?? 0,
    })
  }

  // ============================================================================
  // Storyteller — the operator's post opens a round instead of drawing a reply
  // ============================================================================
  // In a storyteller chat (not paused) a public operator post is recorded in
  // full exactly as a paused chat records it, and then, instead of a reply,
  // `handleSendMessage` opens a round of bids. A whisper still draws its one
  // reply (bug 258); an autonomous room never runs in this mode.
  const holdForStoryteller = !holdForPausedChat
    && !isContinueMode
    && chat.turnMode === 'storyteller'
    && !(options.targetParticipantIds && options.targetParticipantIds.length > 0)
    && options.neverPauseForUser !== true
  if (holdForStoryteller) {
    logger.info('[Orchestrator] Storyteller chat — recording the operator post; a round will open', {
      chatId,
      hasContent: !!options.content,
    })
  }
  // Both holds record the post and stop before a character's turn is built.
  const holdUserTurn = holdForPausedChat || holdForStoryteller

  // A storyteller bid: a dry, plan-only build for one seat (see runStorytellerBid).
  const isBid = !!options.storytellerBid
  const storytellerTurn = options.storyteller

  // Resolve responding participant
  // For whisper messages, the target participant should respond (not the default first character)
  const respondingId = options.respondingParticipantId
    || (options.targetParticipantIds?.length ? options.targetParticipantIds[0] : undefined)

  // The human's "Speaking As" selection: an explicit per-turn override from the
  // composer takes precedence over the persisted chat field (avoids a read-back
  // race where the set-active-speaker write hasn't landed yet).
  const speakingAsParticipantId = options.speakingAsParticipantId ?? chat.activeTypingParticipantId ?? null

  // Fair-rotation guard for rooms where the human drives two or more seats.
  // The first responder after a human post used to be picked from an LLM-ONLY
  // shortlist (participant-resolver), so a room with a single LLM had that LLM
  // answer EVERY human turn — collapsing the rotation to e.g.
  // Charlie→Kumar→Lorian→Kumar… when the human plays both Charlie and an
  // impersonated Lorian. When the rotation's next speaker after this post is
  // ANOTHER seat the human drives, the floor is theirs: persist the message and
  // pause for that seat (the client shows its turn banner) instead of forcing the
  // sole LLM to speak out of turn. A whisper, a nudge, an explicit responding
  // participant, or a continue-mode turn all bypass this (they name their own
  // speaker), as does any single-user-seat room (the common case is untouched).
  if (
    !isContinueMode &&
    // A paused chat already holds every user post below — and holds it more
    // completely (staged tool results, auto-detected rolls, danger flags). The
    // fairness guard would persist a thinner copy of the same message first.
    // A storyteller post opens a round, which asks every LLM seat at once.
    !holdUserTurn &&
    !options.respondingParticipantId &&
    !(options.targetParticipantIds && options.targetParticipantIds.length > 0) &&
    !options.nudge &&
    !!options.content &&
    isMultiCharacterChat(chat.participants)
  ) {
    const pauseResult = await maybePauseForUserSeatTurn(
      repos,
      chatId,
      chat,
      userId,
      options,
      speakingAsParticipantId,
      controller,
      encoder,
    )
    if (pauseResult) {
      // The fairness pause returns only after it has saved the user's message.
      ledger.userMessagePersisted = true
      logger.debug('[Orchestrator] User message persisted (fair-rotation pause)', { chatId })
      return pauseResult
    }
  }

  const participantResult = await resolveRespondingParticipant(
    repos,
    chat,
    userId,
    respondingId,
    isContinueMode,
    speakingAsParticipantId
  )

  const {
    characterParticipant,
    character,
    connectionProfile,
    apiKey: rawApiKey,
    imageProfileId,
    userParticipant,
    userParticipantId,
    isMultiCharacter,
  } = participantResult

  // Tell the client which participant is actually responding before any
  // content arrives. Without this, the streaming bubble's avatar/name comes
  // from the client's `getFirstCharacterParticipant()` guess, which diverges
  // from the server's choice under turn rotation. Chained turns 2+ get the
  // same event from the turn orchestrator; this is the first-turn analog.
  safeEnqueue(controller, encodeTurnStartEvent(encoder, {
    participantId: characterParticipant.id,
    characterName: character.name,
    chainDepth: 0,
  }))

  // Now that we know who's responding, update status with character name
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'resolving',
    message: `Setting up ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Nudge (the human explicitly summoned this voice via the Nudge button): the
  // Host announces the invitation so it persists in the transcript instead of a
  // client-only ephemeral note that vanishes on reload. Fires exactly once — the
  // `nudge` flag rides only on this initial summoned request, never on the
  // server-driven chained turns that follow. Best-effort by the writer contract;
  // surfaced live so the household sees it before the summoned reply streams in.
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

  // The Courier (manual / clipboard transport): no API key, no plugin call.
  // Detected here so the API-key check, tool build, and streamMessage block
  // can all short-circuit later.
  const isCourierTransport = connectionProfile.transport === 'courier'

  // Validate the API key for providers that require one — and forward it for
  // providers that merely accept one. `requiresApiKey` alone answered both
  // questions and so dropped the key an OpenAI-Compatible profile had attached
  // for a hosted endpoint, which then answered 401 (Bug 81). The key itself was
  // already decrypted upstream by the participant resolver, which asks no
  // question of the provider at all.
  let apiKey = ''
  if (!isCourierTransport) {
    if (requiresApiKey(connectionProfile.provider) && !rawApiKey) {
      throw new Error('No API key configured for this connection profile')
    }
    if (acceptsApiKey(connectionProfile.provider)) {
      apiKey = rawApiKey
    }
  }

  // Resolve user identity through fallback chain:
  // 1. User-controlled character in chat → 2. Sole user-controlled character → 3. User profile → 4. "User"
  const resolvedIdentity = await resolveUserIdentity(repos, userId, chat, speakingAsParticipantId)
  const userCharacter: { name: string; description: string } | null = {
    name: resolvedIdentity.name,
    description: resolvedIdentity.description,
  }


  // User-controlled character ID for memory aboutCharacterId
  const userCharacterId = resolvedIdentity.characterId || undefined

  // Get chat settings
  const chatSettings = await repos.chatSettings.findByUserId(userId)

  // ============================================================================
  // Agent Mode Resolution
  // ============================================================================

  // Get project for agent mode resolution (also used later for project context)
  const project = chat.projectId ? await repos.projects.findById(chat.projectId) : null

  // Resolve agent mode settings through the cascade
  const agentMode = resolveAgentModeSetting(
    chat,
    project,
    character,
    chatSettings
  )

  // Reset agent turn count on new user message (not continue mode)
  if (!isContinueMode && agentMode.enabled) {
    await repos.chats.update(chatId, { agentTurnCount: 0 })
  }

  // ============================================================================
  // Context Compression Setup
  // ============================================================================

  // Check if full context was requested (requestFullContextOnNextMessage flag)
  // Held posts build no request, so the flag must survive to be spent by the
  // turn the user eventually asks for.
  let bypassCompression = false
  if (chat.requestFullContextOnNextMessage === true && !holdUserTurn) {
    bypassCompression = true
    // Reset the flag
    await repos.chats.update(chatId, { requestFullContextOnNextMessage: false })
    logger.info('Bypassing context compression (full context requested)', { chatId })
  }

  // Get context compression settings (default to enabled)
  const contextCompressionSettings: ContextCompressionSettings = chatSettings?.contextCompressionSettings || {
    enabled: true,
    windowSize: 5,
    compressionTargetTokens: 800,
    systemPromptTargetTokens: 1500,
    projectContextReinjectInterval: 5,
  }

  // Get cheap LLM selection (used for compression, danger classification, and proactive memory recall)
  let cheapLLMSelection = null
  let allProfiles: ConnectionProfile[] = []
  try {
    // Get all connection profiles for cheap LLM selection
    allProfiles = await repos.connections.findByUserId(userId)
    const cheapLLMConfig = chatSettings?.cheapLLMSettings || DEFAULT_CHEAP_LLM_CONFIG

    // Convert null values to undefined for CheapLLMConfig compatibility
    const compatibleConfig = {
      ...cheapLLMConfig,
      userDefinedProfileId: cheapLLMConfig.userDefinedProfileId ?? undefined,
      defaultCheapProfileId: cheapLLMConfig.defaultCheapProfileId ?? undefined,
    }

    cheapLLMSelection = getCheapLLMProvider(
      connectionProfile,
      compatibleConfig,
      allProfiles,
      false // Ollama availability - could be checked but keeping simple for now
    )

  } catch (error) {
    logger.warn('Failed to get cheap LLM provider, features requiring it will be skipped', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Determine if compression is actually enabled for this request
  const compressionEnabled = !!(contextCompressionSettings.enabled && cheapLLMSelection && !bypassCompression)

  // ============================================================================
  // Dangerous Content Classification & Routing
  // ============================================================================

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

  const dangerFlags: DangerFlag[] | undefined = dangerState.dangerFlags
  // Flagged by the pre-screen, or headed straight for the uncensored desk on an
  // Unmoderated chat (which writes no per-message flags): either way the
  // failover service reads an empty body as a refusal and clears stand-ins
  // for the content.
  const contentTreatedAsDangerous = (dangerFlags?.length ?? 0) > 0 || dangerState.routedDirect
  const conciergePolicy = dangerState.conciergePolicy

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

  // Get roleplay template
  const roleplayTemplate = await getRoleplayTemplate(repos, chat, chatSettings ? { defaultRoleplayTemplateId: chatSettings.defaultRoleplayTemplateId ?? undefined } : null)

  // Get image profile if configured
  let imageProfile = null
  if (imageProfileId) {
    imageProfile = await repos.imageProfiles.findById(imageProfileId)
  }

  // Load participant data for multi-character chats
  let participantCharacters = new Map()

  if (isMultiCharacter) {
    const participantData = await loadAllParticipantData(
      repos,
      chat,
      character
    )
    participantCharacters = participantData.participantCharacters
  }

  // Get existing messages
  const existingMessages = await repos.chats.getMessages(chatId)

  // ============================================================================
  // "Nothing to add" turn-skipping — eligibility
  // ============================================================================
  // Decide once whether this character may be offered the pass option this
  // turn. Only meaningful in multi-character chats with an LLM-controlled
  // responder. `summoned` (nudge or queue-pop) withholds the option — you don't
  // offer a pass to a voice the operator explicitly called on.
  let turnSkip: { offerSkip: boolean; recentlyAddressed: boolean; characterName: string } | undefined
  if (storytellerTurn) {
    // A storyteller turn may always pass: the operator chose the speaker, but
    // the moment its plan was for may have gone by (D13). The plan section
    // carries the pass instruction, so no separate skip note is built.
    turnSkip = { offerSkip: true, recentlyAddressed: false, characterName: character.name }
  } else if (!isBid && qualifiesForTurnSkipping(chat.participants) && characterParticipant.controlledBy !== 'user') {
    const eligibility = computeSkipEligibility({
      events: existingMessages,
      participants: chat.participants,
      respondingParticipantId: characterParticipant.id,
      respondingCharacter: character,
      summoned: options.nudge === true || options.chainSelectionReason === 'queue',
      turnSkippingEnabled: chat.turnSkippingEnabled !== false,
    })
    turnSkip = {
      offerSkip: eligibility.offerSkip,
      recentlyAddressed: eligibility.recentlyAddressed,
      characterName: character.name,
    }
  }

  // ============================================================================
  // Raised hand — the operator wants to cut in
  // ============================================================================
  // The first LLM-voiced turn built after the operator raised a hand is the one
  // asked whether to yield. Taking the hand consumes it, so a decline lowers it
  // and nobody after is asked. A held (paused) turn builds no reply to ask in.
  // A bid is not a turn: it never takes the hand.
  const offerYield = characterParticipant.controlledBy !== 'user'
    && !holdUserTurn
    && !isBid
    && takeRaisedHand()
  if (offerYield) {
    logger.info('[TurnYield] Asking the next speaker whether to yield to the raised hand', {
      chatId,
      characterId: character.id,
      participantId: characterParticipant.id,
    })
  }

  // ============================================================================
  // Project + General Context Re-injection (Phase E: Prospero whisper)
  // ============================================================================
  // The chat-start whisper is posted by `createInitialMessagesScenarioAndStaff`
  // when the chat is created. Here we handle the cadence-based refresh: every
  // `projectContextReinjectInterval` messages we post a fresh Prospero
  // context whisper into the transcript so the LLM keeps the project's
  // description / instructions / linked stores in mind alongside the
  // always-on Quilltap General shelf. Project info and the shared shelf ride
  // in a single message so Prospero speaks once per cadence rather than
  // twice. The `projectContext` parameter on the system-prompt builder is
  // now unused; the system-prompt block was dropped along with this rewire.

  const reinjectInterval = contextCompressionSettings.projectContextReinjectInterval ?? 5
  const messageCount = existingMessages.filter(m => m.type === 'message').length
  // Skip messageCount === 0 — chat-start handles the initial emit. Cadence
  // re-injects at multiples of N thereafter.
  // Both whispers below brief the character about to take the floor. On a held
  // post nobody does, so the cadence waits for the turn the user asks for.
  const shouldInjectContext = reinjectInterval > 0 && messageCount > 0
    && messageCount % reinjectInterval === 0
    && !holdUserTurn
    && !isBid

  if (shouldInjectContext) {
    const projectContext = project ? await loadProsperoProjectContext(project.id) : null
    const generalContext = await loadProsperoGeneralContext()
    // Concurrent storyteller turns share one message count: the group's first
    // posts the public announcement, and the rest only their own whispers.
    if ((projectContext || generalContext) && !storytellerTurn?.concurrentFollower) {
      const posted = await postProsperoContextAnnouncement({
        chatId,
        project: projectContext,
        general: generalContext,
      })
      if (posted) {
        existingMessages.push(posted)
      }
    }

    // Group stores are gated by membership and the vault is personal, so they
    // ride as a targeted whisper to the responding character (not the public
    // announcement above). Refreshed on the same cadence for the character
    // about to take the floor. Fails soft.
    try {
      const groupWhisper = await postProsperoGroupContextWhisper({
        chatId,
        targetParticipantId: characterParticipant.id,
        characterId: character.id,
      })
      if (groupWhisper) {
        existingMessages.push(groupWhisper)
      }
    } catch (error) {
      logger.warn('[Orchestrator] Failed to post Prospero group-context whisper', {
        chatId,
        characterId: character.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Status: processing files
  if (options.fileIds && options.fileIds.length > 0) {
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'processing_files',
      message: 'Processing attachments...',
      characterName: character.name,
      characterId: character.id,
    }))
  }

  // Process file attachments
  const fileProcessing = await loadAndProcessFiles(
    repos,
    chatId,
    userId,
    connectionProfile,
    options.fileIds
  )

  // Save pending tool results as TOOL messages (before user message)
  // Also add them to existingMessages so they're included in context building
  if (!isContinueMode && options.pendingToolResults && options.pendingToolResults.length > 0) {
    for (const toolResult of options.pendingToolResults) {
      const toolMessageId = crypto.randomUUID()
      const toolMessage = {
        id: toolMessageId,
        type: 'message' as const,
        role: 'TOOL' as const,
        content: JSON.stringify({
          tool: toolResult.tool,
          initiatedBy: 'user',
          success: toolResult.success,
          result: toolResult.result,
          prompt: toolResult.prompt,
          arguments: toolResult.arguments,
        }),
        createdAt: toolResult.createdAt,
        attachments: [],
      }
      await repos.chats.addMessage(chatId, toolMessage)
      // Add to existingMessages so it's included in context building
      // (existingMessages was loaded before this save operation)
      existingMessages.push(toolMessage)
    }
    ledger.pendingToolResultsPersisted = true
    logger.debug('[Orchestrator] Pending tool results persisted', {
      chatId,
      count: options.pendingToolResults.length,
    })
  }

  // ============================================================================
  // Auto-Detect RNG Patterns
  // ============================================================================
  // When enabled, detect dice rolls, coin flips, and spin-the-bottle patterns
  // in user messages and automatically execute them as RNG tool calls
  const autoDetectRng = chatSettings?.autoDetectRng ?? true
  if (autoDetectRng && !isContinueMode && options.content) {
    const rngPatterns = detectAndConvertRngPatterns(options.content)
    if (rngPatterns.length > 0) {
      logger.info('Auto-detected RNG patterns in user message', {
        chatId,
        userId,
        patternCount: rngPatterns.length,
        patterns: rngPatterns.map(p => ({ type: p.type, rolls: p.rolls, matchText: p.matchText })),
      })

      // Execute each detected pattern and save as TOOL messages
      for (const pattern of rngPatterns) {
        const rngContext = { userId, chatId }
        const result = await executeRngTool(
          { type: pattern.type, rolls: pattern.rolls, modifier: pattern.modifier ?? 0 },
          rngContext
        )
        const formattedResult = formatRngResults(result)

        const toolMessageId = crypto.randomUUID()
        const toolMessage = {
          id: toolMessageId,
          type: 'message' as const,
          role: 'TOOL' as const,
          content: JSON.stringify({
            tool: 'rng',
            initiatedBy: 'auto-detect',
            success: result.success,
            result: formattedResult,
            prompt: pattern.matchText,
            arguments: { type: pattern.type, rolls: pattern.rolls, modifier: pattern.modifier ?? 0 },
          }),
          createdAt: new Date().toISOString(),
          attachments: [],
        }

        await repos.chats.addMessage(chatId, toolMessage)
        existingMessages.push(toolMessage)
      }
    }
  }

  // Save user message (not in continue mode)
  let userMessageId: string | null = null
  let content = ''

  if (!isContinueMode && options.content) {
    content = options.content
    userMessageId = crypto.randomUUID()
    const now = new Date().toISOString()

    const userMessage = {
      id: userMessageId,
      type: 'message' as const,
      role: 'USER' as const,
      content,
      createdAt: now,
      attachments: options.fileIds || [],
      participantId: userParticipantId,
      targetParticipantIds: options.targetParticipantIds || null,
    }

    await repos.chats.addMessage(chatId, userMessage)
    ledger.userMessagePersisted = true
    logger.debug('[Orchestrator] User message persisted', { chatId, userMessageId })

    // Link file attachments
    for (const file of fileProcessing.attachedFiles) {
      await repos.files.addLink(file.id, userMessageId)
    }

    // Surface uploaded image UUIDs in the chat transcript so the LLM has the
    // handle required to call `keep_image` / `attach_image` on them. Parallels
    // the Lantern's avatar/background announcements; the user's own message
    // already carries the image bytes, so this whisper is text-only.
    const imageUploads = fileProcessing.attachedFiles
      .filter(f => f.mimeType.toLowerCase().startsWith('image/'))
      .map(f => ({ fileId: f.id, filename: f.filename }))
    if (imageUploads.length > 0) {
      try {
        await postLibrarianUploadAnnouncement({ chatId, uploads: imageUploads })
      } catch (announceError) {
        logger.warn('Failed to post Librarian upload announcement', {
          chatId,
          uploadCount: imageUploads.length,
          error: announceError instanceof Error ? announceError.message : String(announceError),
        })
      }
    }

    // Attach dangerFlags to the saved user message
    if (dangerFlags && dangerFlags.length > 0) {
      try {
        await repos.chats.updateMessage(chatId, userMessageId, { dangerFlags })
      } catch (updateError) {
        logger.warn('[DangerousContent] Failed to attach dangerFlags to user message', {
          chatId,
          messageId: userMessageId,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        })
      }
    }
  }

  // ============================================================================
  // Pascal trigger phrases — user-message path
  // ============================================================================
  // When the chat setting is on, a custom tool whose `triggers` phrase appears
  // in what the operator just said runs with its defaults. Unlike the dice
  // above (thrown BEFORE the message is saved, so their TOOL rows precede it),
  // Pascal's announcement must FOLLOW the words that caused it, so it runs
  // here, after the persist. The seat speaks for itself: a user-driven or
  // impersonated character's words are that character's, and its roster is
  // theirs; the bare operator rolls as nobody. Posts are spliced into this
  // turn's context so the responding model hears them. Never throws.
  await runUserMessageTriggers({
    userId,
    chatId,
    chat,
    content,
    isContinueMode,
    userParticipant,
    userParticipantId,
    chatSettings,
    existingMessages,
    onPosted: (message) => safeEnqueue(controller, encodePascalResultEvent(encoder, message)),
  })

  // ============================================================================
  // Carina (inline LLM queries) — user-message path
  // ============================================================================
  // If the user addressed an answerer with @Name: / @Name?, fire the isolated
  // reference call. Like the RNG auto-detect above, this is a SIDE-EFFECT: the
  // normal responding participant still takes its turn ("both fire"). The answer
  // (or a Prospero error) is posted now and surfaced to the client by the
  // post-turn fetchChat() refresh; it carries systemSender:'carina', so it is
  // excluded from memory extraction automatically.
  if (!isContinueMode && content) {
    await runCarinaMarkupQuery({
      userId,
      chatId,
      text: content,
      askerParticipantId: userParticipantId ?? null,
      // The human operator typed this markup — they can reach any character,
      // regardless of whether their persona is itself a Carina answerer.
      operatorInitiated: true,
      logLabels: { detected: 'user message', failed: 'user-message' },
      // Emit a "Consulting …" status before the query runs.
      onConsulting: (characterName) => safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'gathering',
        message: `Consulting ${characterName}...`,
        characterName: character.name,
        characterId: character.id,
      })),
      // Surface the answer to the Salon the instant it returns — before the
      // first character even starts responding — rather than at end-of-turn.
      onPosted: (msg) => safeEnqueue(controller, encodeCarinaAnswerEvent(encoder, msg)),
      // Splice a PUBLIC answer into this turn's in-memory context so the first
      // character to respond in the same cycle hears it (parallels the
      // RNG-result push above; the DB copy already covers later turns).
      onPublicAnswer: (msg) => existingMessages.push(msg),
    })
  }

  // ============================================================================
  // Paused chat — the user's turn is recorded; nobody answers it
  // ============================================================================
  // Everything above belongs to the message the user just wrote. Everything
  // below belongs to a character's turn, and a paused room grants none. Stop
  // here, before a single token is spent on tools, context or the model.
  if (holdForStoryteller) {
    // The round opens from handleSendMessage, which holds the stream. An
    // `@Name:` query is answered as in every mode, and opens no round.
    const carina = !!(content && parseCarinaQuery(content))
    await repos.chats.update(chatId, { lastTurnParticipantId: null })
    return {
      isMultiCharacter,
      hasContent: false,
      messageId: userMessageId,
      userParticipantId,
      isPaused: false,
      storytellerHold: { triggerMessageId: userMessageId, carina },
    }
  }
  if (holdForPausedChat) {
    return finishHeldUserTurn({
      repos,
      chatId,
      isMultiCharacter,
      userMessageId,
      userParticipantId,
      controller,
      encoder,
    })
  }

  // Build final user message content
  const finalUserMessageContent = isContinueMode
    ? undefined
    : (fileProcessing.messageContentPrefix ? fileProcessing.messageContentPrefix + content : content)

  // ============================================================================
  // Tool Injection
  // ============================================================================
  // Tools are always sent with every LLM prompt to ensure consistent availability
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'loading_tools',
    message: `Loading tools for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // Check if tool settings were just changed (for notification message)
  const toolSettingsChanged = chat.forceToolsOnNextMessage === true

  // Clear forceToolsOnNextMessage flag if it was set
  if (toolSettingsChanged) {
    await repos.chats.update(chatId, { forceToolsOnNextMessage: false })
  }

  // Phase D: outfit changes now ride as Aurora whispers in the transcript
  // (see `handleWardrobeOutfitAnnouncement` and `postOutfitChangeWhisper`),
  // so the per-turn `pendingOutfitNotifications` flush is no longer needed.

  // Check tool options
  const enabledToolOptions = determineEnabledToolOptions(
    imageProfileId,
    streamingState.effectiveProfile.allowWebSearch
  )

  // Resolve help tools enabled from character (default: disabled)
  const helpToolsEnabled = character?.defaultHelpToolsEnabled === true

  // Resolve wardrobe capability flags from character (default: enabled when null)
  const canDressThemselves = character?.canDressThemselves !== false
  const canCreateOutfits = character?.canCreateOutfits !== false
  // Inventory tools (default: enabled when null)
  const canManageInventory = character?.canManageInventory !== false

  // Determine if document editing tools should be enabled (Scriptorium Phase 3.3)
  // Enabled when the project has linked document stores
  let documentEditingEnabled = false
  if (chat.projectId) {
    try {
      const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId)
      documentEditingEnabled = mountLinks.length > 0
    } catch (mountLinkError) {
    }
  }

  // System transparency override: when the character isn't opted in, force the
  // self_inventory tool out of the slate — the chat- and project-level toggles
  // for that tool can't override the character-level covenant. Cheap union with
  // whatever the chat already disables.
  const characterIsTransparent = character?.systemTransparency === true
  const effectiveDisabledTools = characterIsTransparent
    ? (chat.disabledTools ?? [])
    : Array.from(new Set([...(chat.disabledTools ?? []), 'self_inventory']))

  // The Courier transport exposes no tools (the external LLM cannot reach
  // them) and injects no tool instructions into the system prompt. Skip the
  // whole tool-build step in that case.
  const isEffectiveCourier = streamingState.effectiveProfile.transport === 'courier'

  // Carina (inline LLM queries): offer the ask_carina tool when at least one
  // answerer (a character with canBeCarina) exists, OR when the acting character
  // is `systemTransparency` — such a character can reach the Brahma Console
  // pseudocharacter as a Carina answerer, so it must be offered the tool even
  // with no other answerer present. Uses the overlay-free raw read — canBeCarina
  // is a DB column, not a vault field — to keep this per-turn check cheap.
  let askCarinaEnabled = false
  try {
    const rawCharacters = await repos.characters.findAllRaw()
    const anyCanBeCarina = rawCharacters.some(c => !c.archivedAt && c.canBeCarina === true)
    askCarinaEnabled = anyCanBeCarina || characterIsTransparent
  } catch (carinaProbeError) {
    logger.warn('Failed to probe for Carina answerers; ask_carina tool withheld', {
      chatId,
      error: carinaProbeError instanceof Error ? carinaProbeError.message : String(carinaProbeError),
    })
  }

  // Pascal's custom pseudo-tools (`run_custom`). The roster's perspective is the
  // RESPONDING character's, because a character-tier store shadows the farther
  // tiers — two characters in one room can hold different definitions of the
  // same tool name. `characterId` is REQUIRED (the group tier is keyed on the
  // responding character's own group memberships and silently resolves to []
  // without it); `characterMountPointId` is merely the fast path to their vault.
  // Withholding the context entirely is how the chat-level setting turns the
  // feature off: buildTools then never lists a single mount.
  const participantCharacterIds = chat.participants
    .filter(p => p.type === 'CHARACTER' && p.characterId)
    .map(p => p.characterId as string)
  const customToolsEnabled = chatSettings?.customTools ?? true
  const customToolContext: CustomToolRosterContext | null = customToolsEnabled
    ? {
        userId,
        chatId,
        characterId: character.id ?? null,
        characterMountPointId: character.characterDocumentMountPointId ?? null,
        projectId: chat.projectId ?? null,
        // The responding character's fact sheet, which availability gates are
        // answered against. Already hydrated by the participant resolver, so
        // this costs nothing.
        metadata: character.metadata ?? null,
      }
    : null

  let tools: unknown[] = []
  let modelSupportsNativeTools = false
  let useNativeWebSearch = false
  let customToolEffects = new Map<string, ToolEffect>()
  let pluginToolEffects = new Map<string, ToolEffect>()
  // The highest effect a tool call may have this turn; unset = no ceiling.
  // A storyteller turn starts at its bid's tier.
  let turnEffectCeiling: ToolEffect | undefined = storytellerTurn?.effectCeiling
  if (!isEffectiveCourier) {
    // Build tools (include request_full_context when compression is enabled, submit_final_response when agent mode is enabled)
    // Always pass disabledTools and disabledToolGroups for filtering
    const builtTools = await buildTools(
      streamingState.effectiveProfile,
      imageProfileId,
      imageProfile,
      userId,
      chat.projectId ?? undefined, // projectId - enables project_info tool
      compressionEnabled, // requestFullContext - enable the tool when compression is active
      effectiveDisabledTools,
      chat.disabledToolGroups ?? [],
      agentMode.enabled, // agentModeEnabled - enables submit_final_response tool
      isMultiCharacter, // isMultiCharacter - enables whisper tool
      helpToolsEnabled, // helpToolsEnabled - enables help_search and help_settings tools
      canDressThemselves, // enables wardrobe_list, wardrobe_read, wardrobe_wear, wardrobe_take_off, wardrobe_rollback, wardrobe_history
      canCreateOutfits, // enables wardrobe_create, wardrobe_update, wardrobe_archive
      canManageInventory, // enables the nine inventory_* tools
      documentEditingEnabled ? 'full' : 'off', // docToolsMode - the full doc_* family when stores are linked
      askCarinaEnabled, // askCarinaEnabled - enables ask_carina tool when an answerer exists
      undefined, // includeWorkspaceTools - Salon turns keep the always-on set
      undefined, // excludeMemorySearch - Brahma Console only
      undefined, // sqlAccess - Brahma Console only
      customToolContext // customToolContext - enables run_custom when the scene has a roster
    )
    tools = builtTools.tools
    modelSupportsNativeTools = builtTools.modelSupportsNativeTools
    useNativeWebSearch = builtTools.useNativeWebSearch

    customToolEffects = builtTools.customToolEffects
    pluginToolEffects = builtTools.pluginToolEffects

    // 4.6 Private Character Rooms — destructive-tool gate for autonomous rooms.
    // User-level destructiveToolPolicy is a CEILING: 'always_refuse' overrides
    // any permissive per-room runDestructiveToolsAllowed flag. Without
    // permission the turn's effect ceiling drops to `write`: the list loses
    // every `destroy` tool before the LLM call, and the executor refuses one
    // regardless.
    if (chat.chatType === 'autonomous') {
      const chatSettings = await repos.chatSettings.findByUserId(userId)
      const policy = chatSettings?.autonomousRoomSettings?.destructiveToolPolicy ?? 'opt_in_per_room'
      const allowedAtRoom = (chat as { runDestructiveToolsAllowed?: number }).runDestructiveToolsAllowed === 1
      const destructiveAllowed = policy !== 'always_refuse' && allowedAtRoom
      if (!destructiveAllowed) {
        turnEffectCeiling = lowerToolEffect(turnEffectCeiling, 'write')
        logger.debug('Autonomous room: destructive tools withheld by effect ceiling', {
          chatId,
          policy,
          allowedAtRoom,
        })
      }
    }

    if (turnEffectCeiling) {
      const before = tools.length
      tools = applyEffectCeilingToTools(tools, turnEffectCeiling, { customToolEffects, pluginToolEffects })
      if (before !== tools.length) {
        logger.info('Tools above the turn\'s effect ceiling filtered from per-turn list', {
          chatId,
          ceiling: turnEffectCeiling,
          removed: before - tools.length,
        })
      }
    }
  }

  const profilePseudoToolMode = (streamingState.effectiveProfile as { pseudoToolMode?: 'auto' | 'native' | 'simple-json' | 'text-block' }).pseudoToolMode
  const resolvedToolMode = isEffectiveCourier
    ? 'native' // Courier sends no tools anyway; the value is unused.
    : checkResolvedToolMode(modelSupportsNativeTools, profilePseudoToolMode)
  const useTextBlockTools = !isEffectiveCourier && resolvedToolMode !== 'native'
  const actualTools = useTextBlockTools ? [] : tools

  // Build tool instructions (simple-json, text-block, or native tool rules)
  let toolInstructions: string | undefined
  if (isEffectiveCourier) {
    toolInstructions = undefined
  } else if (resolvedToolMode === 'simple-json') {
    const enabledOptions = determineTextBlockToolOptions(
      imageProfileId,
      streamingState.effectiveProfile.allowWebSearch,
      isMultiCharacter,
      !!chat.projectId,
      helpToolsEnabled,
      canDressThemselves,
      canCreateOutfits,
      canManageInventory
    )
    toolInstructions = buildSimpleJsonSystemInstructions(enabledOptions)
    logSimpleJsonToolUsage(streamingState.effectiveProfile.provider, streamingState.effectiveProfile.modelName, enabledOptions)
  } else if (resolvedToolMode === 'text-block') {
    const textBlockOptions = determineTextBlockToolOptions(
      imageProfileId,
      streamingState.effectiveProfile.allowWebSearch,
      isMultiCharacter,
      !!chat.projectId,
      helpToolsEnabled,
      canDressThemselves,
      canCreateOutfits,
      canManageInventory
    )
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
    logTextBlockToolUsage(streamingState.effectiveProfile.provider, streamingState.effectiveProfile.modelName, textBlockOptions)
  } else if (actualTools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  // Provider stop sequences (currently only simple-json needs them). Applied
  // to both the initial primary stream and the continuation re-stream so the
  // model is hard-cut at the closing `</tool_call>` tag.
  const initialStopSequences: string[] | undefined =
    resolvedToolMode === 'simple-json' ? SIMPLE_JSON_STOP : undefined

  // Build message context
  const modelParams = profileParams(streamingState.effectiveProfile) ?? {}
  const contextChatSettings = chatSettings ? {
    cheapLLMSettings: chatSettings.cheapLLMSettings ? {} : undefined,
    defaultTimestampConfig: chatSettings.defaultTimestampConfig,
  } : null

  // ============================================================================
  // Async Pre-Compression + Proactive Memory Recall (run in parallel)
  // ============================================================================

  // Characters present in the room this turn: the responding character plus
  // every other character participant (participantCharacters is keyed by
  // characterId; it is empty in single-character chats). Threaded into the
  // proactive recall path so memories ABOUT a present character get the
  // participant-aware boost (item 4). The dynamic-head fallback computes the
  // same set itself from the participant list it already holds.
  const presentAboutCharacterIds = Array.from(
    new Set(
      [character.id, ...participantCharacters.keys()].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  )

  const presentParticipantNames = [character.name, ...[...participantCharacters.values()].map(c => c.name)]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  const {
    cachedCompressionResponse,
    preRecall,
    stopKeepAlive,
  } = await runPreContextPreCompute({
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

  // Everything this turn will add to the payload *after* the context is built —
  // the tool schemas, plus the agent-mode and tool-change system messages
  // spliced in below. Built and measured here, before the context, so the
  // builder can hold room for them instead of packing history into space they
  // are about to occupy. The strings are reused at the splice sites.
  const turnExtras = collectTurnExtras({
    tools: actualTools,
    agentMode,
    toolSettingsChanged,
    provider: streamingState.effectiveProfile.provider,
  })

  // ============================================================================
  // Storyteller — the bid section, or a speaking turn's plan
  // ============================================================================
  // Both ride as the last trailing section, never in the system prefix, so a
  // bid shares the character's cached prefix with the turn it may become.
  let bidOffer: StorytellerBidOffer | null = null
  let storytellerSection: string | undefined
  if (isBid) {
    bidOffer = buildBidOffer({
      tools,
      customToolEffects,
      pluginToolEffects,
      silent: characterParticipant.status === 'silent',
    })
    storytellerSection = buildBidSection({
      characterName: character.name,
      talkativeness: characterParticipant.talkativeness ?? character.talkativeness ?? 0.5,
      offer: bidOffer,
    })
  } else if (storytellerTurn) {
    storytellerSection = buildPlanSection({
      plan: storytellerTurn.bidRecord.plan,
      tier: storytellerTurn.bidRecord.tier,
      toolsNamed: storytellerTurn.bidRecord.toolsNamed,
      spokenSince: storytellerTurn.spokenSince,
      allowedTools: extractToolNames(tools),
    })
    logger.debug('[Storyteller] Speaking turn carries its bid', {
      chatId,
      participantId: characterParticipant.id,
      roundId: storytellerTurn.bidRecord.roundId,
      tier: storytellerTurn.bidRecord.tier,
      ceiling: turnEffectCeiling,
    })
  }

  // Send status update for context gathering
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'gathering',
    message: 'Gathering memories and context...',
    characterName: character.name,
    characterId: character.id,
  }))

  const { builtContext, formattedMessages, isInitialMessage } = await buildMessageContext(
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
      chatSettings: contextChatSettings,
      toolInstructions,
      newUserMessage: finalUserMessageContent,
      activeUserParticipantId: speakingAsParticipantId,
      isContinueMode,
      // Context compression options
      contextCompressionSettings: compressionEnabled ? contextCompressionSettings : null,
      cheapLLMSelection,
      bypassCompression,
      // Autonomous-room per-turn context cap (tokens). Clamps the model-derived
      // budget so a token-budgeted room paces its run across multiple turns.
      autonomousContextCap: options.autonomousContextCap,
      // Room held back for the tool schemas and the system messages spliced in
      // after this returns.
      reservedOutgoingTokens: turnExtras.reservedTokens,
      // "Nothing to add" turn-skipping — per-turn ephemeral instruction control.
      // A storyteller turn's plan section carries its own pass instruction.
      turnSkip: storytellerTurn ? undefined : turnSkip,
      // Raised hand — the yield Turn note.
      offerYield,
      // Storyteller: a bid builds dry and delivers no recall; the bid or plan
      // section trails everything else.
      purpose: isBid ? 'bid' : 'turn',
      storytellerSection,
      // Pass cached compression result and message count for dynamic window calculation
      cachedCompressionResult: cachedCompressionResponse?.result,
      cachedCompressionMessageCount: cachedCompressionResponse?.cachedMessageCount,
      // Proactive memory recall results
      preRecall,
      // Memory recap: uncensored fallback for Unmoderated chats. The policy
      // routes direct only when the Concierge is on duty and the chat is
      // Unmoderated, so off-duty and exempt chats never engage it.
      uncensoredFallbackOptions: (conciergePolicy?.routeDirect && cheapLLMSelection)
        ? { conciergePolicy, availableProfiles: allProfiles, isDangerousChat: true }
        : undefined,
      // Status callback for budget-driven compression phases
      onStatusChange: (stage: string, message: string) => {
        safeEnqueue(controller, encodeStatusEvent(encoder, {
          stage,
          message,
          characterName: character.name,
          characterId: character.id,
        }))
      },
    },
    existingMessages,
    fileProcessing.attachmentsToSend
  )

  // Stop keep-alive pings after context building completes
  stopKeepAlive()

  // Update status now that context building is done — prevents
  // "Calculating context budget..." from lingering through pre-send setup
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'preparing',
    message: `Preparing request for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // ============================================================================
  // The Courier (manual / clipboard transport) — short-circuit before tool /
  // streaming machinery. The dispatch service renders the assembled request
  // as Markdown, persists a placeholder assistant message, pauses the chat,
  // and emits SSE events. Turn chaining is halted by isPaused=true; the paste
  // resolver clears the pause when the user submits a reply.
  // ============================================================================
  if (isEffectiveCourier && isBid) {
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
  if (isEffectiveCourier) {
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

  // Create tool context. Memories loaded into the prompt are forwarded so
  // introspection tools (self_inventory) can report the exact slate the LLM
  // saw this turn.
  const toolContext = createToolContext(
    chatId,
    userId,
    character.id,
    characterParticipant.id,
    imageProfileId,
    undefined, // embeddingProfileId: always use default embedding profile
    chat.projectId,
    options.browserUserAgent,
    {
      semantic: builtContext.debugMemories,
      interCharacter: builtContext.debugInterCharacterMemories,
      recap: builtContext.debugMemoryRecap,
    },
  )
  // Let a character's `ask_carina` tool call surface its answer to the Salon
  // live (same `carinaAnswer` SSE event the user-markup path uses above). The
  // toolContext threads down into the native/text tool loops.
  toolContext.emitCarinaAnswer = (msg) =>
    safeEnqueue(controller, encodeCarinaAnswerEvent(encoder, msg))

  // Pascal's `run_custom`: the tiered mount pool needs the same perspective the
  // roster was built from, or the model would be offered a tool the executor
  // then cannot find. Vault fast path + the peers whose vaults form the
  // 'participant' tier.
  toolContext.characterMountPointId = character.characterDocumentMountPointId ?? null
  toolContext.characterIds = participantCharacterIds
  // Surface Pascal's outcome the instant it posts, rather than waiting for the
  // post-turn refetch — same live-SSE pattern as the Carina answer above.
  toolContext.emitPascalResult = (msg) =>
    safeEnqueue(controller, encodePascalResultEvent(encoder, msg))
  // The effect ceiling travels with the context; the executor is where it bites.
  toolContext.customToolEffects = customToolEffects
  toolContext.pluginToolEffects = pluginToolEffects
  if (turnEffectCeiling) toolContext.effectCeiling = turnEffectCeiling

  // ============================================================================
  // Tool Change Notification
  // ============================================================================
  // If tool settings were changed, inject a system message to inform the LLM
  // This only happens when the user explicitly changed settings, not on first message or interval
  if (turnExtras.toolChangeNotice) {
    const toolNames = extractToolNames(actualTools)

    const toolChangeMessage = {
      role: 'system',
      content: turnExtras.toolChangeNotice,
      attachments: [],
    }

    // Insert before the last message (which should be the user's new message)
    const lastUserMessageIndex = formattedMessages.findIndex(
      (m, i, arr) => m.role === 'user' && i === arr.length - 1
    )
    if (lastUserMessageIndex > 0) {
      formattedMessages.splice(lastUserMessageIndex, 0, toolChangeMessage)
    } else {
      // Fallback: just add it near the end
      formattedMessages.push(toolChangeMessage)
    }

    logger.info('Injected tool change notification', {
      chatId,
      toolCount: toolNames.length,
      tools: toolNames,
    })
  }

  // ============================================================================
  // Agent Mode Instructions
  // ============================================================================
  // If agent mode is enabled, inject instructions into the system prompt
  if (turnExtras.agentModeInstructions) {
    const agentModeMessage = {
      role: 'system',
      content: turnExtras.agentModeInstructions,
      attachments: [],
    }

    // Insert agent mode instructions at the beginning (after any existing system messages)
    // Find the first non-system message and insert before it
    const firstNonSystemIndex = formattedMessages.findIndex(m => m.role !== 'system')
    if (firstNonSystemIndex > 0) {
      formattedMessages.splice(firstNonSystemIndex, 0, agentModeMessage)
    } else if (firstNonSystemIndex === 0) {
      formattedMessages.unshift(agentModeMessage)
    } else {
      // All messages are system messages - add at end
      formattedMessages.push(agentModeMessage)
    }

    logger.info('Injected agent mode instructions', {
      chatId,
      maxTurns: agentMode.maxTurns,
      enabledSource: agentMode.enabledSource,
    })
  }

  // ============================================================================
  // Storyteller bid — one call, nothing saved or streamed
  // ============================================================================
  if (isBid && bidOffer) {
    const bid = await callForBid({
      messages: formattedMessages,
      connectionProfile: streamingState.effectiveProfile,
      apiKey: streamingState.effectiveApiKey,
      modelParams,
      tools: actualTools,
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

  // Send debug info
  controller.enqueue(encodeDebugInfo(encoder, {
    builtContext,
    connectionProfile: streamingState.effectiveProfile,
    modelParams,
    messages: formattedMessages.map(m => ({
      role: m.role,
      contentLength: m.content.length,
      hasAttachments: !!m.attachments?.length,
    })),
    tools: actualTools,
    enabledToolOptions: enabledToolOptions as unknown as Record<string, boolean>,
  }))

  // Send fallback processing info if any
  if (fileProcessing.fallbackResults.length > 0) {
    controller.enqueue(encodeFallbackInfo(encoder, fileProcessing.fallbackResults))
  }

  // ============================================================================
  // Pre-Send Context Validation
  // ============================================================================
  // Verify that the assembled payload fits within the model's context window
  // BEFORE sending to the API. This prevents silent failures with small models
  // that can't handle the payload even after compression.
  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'validating',
    message: `Validating context for ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))
  // Measure the whole payload, not just the message array: the tool schemas
  // ride alongside it and count against the same window. The ceiling is the
  // budget's own `safeInputLimit` — the number the builder packed to — so this
  // check can no longer fire on a context that was filled exactly as instructed.
  const messageTokens = countMessagesTokens(
    formattedMessages.map(m => ({ content: m.content, role: m.role }))
  )
  const estimatedInputTokens = messageTokens + turnExtras.toolSchemaTokens
  const modelContextLimit = builtContext.budget.totalLimit
  const responseReserve = builtContext.budget.responseReserve
  const safeInputLimit = builtContext.budget.safeInputLimit

  if (estimatedInputTokens > safeInputLimit) {
    logger.warn('Context exceeds model safe input limit, payload may be rejected', {
      chatId,
      characterName: character.name,
      provider: streamingState.effectiveProfile.provider,
      model: streamingState.effectiveProfile.modelName,
      estimatedInputTokens,
      messageTokens,
      toolSchemaTokens: turnExtras.toolSchemaTokens,
      toolCount: actualTools.length,
      safeInputLimit,
      modelContextLimit,
      responseReserve,
      safetyMargin: builtContext.budget.safetyMargin,
      reservedOutgoingTokens: turnExtras.reservedTokens,
      compressionApplied: builtContext.compressionApplied ?? false,
      overage: estimatedInputTokens - safeInputLimit,
    })

    // Send a warning status to the client so the user knows what happened
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'warning',
      message: `Context (~${Math.round(estimatedInputTokens / 1000)}k tokens) may exceed ${streamingState.effectiveProfile.modelName} limit (~${Math.round(safeInputLimit / 1000)}k tokens)`,
      characterName: character.name,
      characterId: character.id,
    }))
  }

  // Stream the response (state is accumulated in streamingState)

  // Pre-generate assistant message ID so logs can reference it
  const preGeneratedAssistantMessageId = crypto.randomUUID()

  // Idempotent partial-response preserver shared across every streamMessage
  // callsite for this turn. First call that finds streamed content writes
  // it to the DB with an OOC marker; subsequent calls no-op so the original
  // error still propagates.
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

  const previousResponseId = findPreviousResponseId(
    streamingState.effectiveProfile.provider,
    existingMessages as MessageEvent[]
  )

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
    actualTools,
    useNativeWebSearch,
    previousResponseId,
    stop: initialStopSequences,
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

  // Process tool calls (native function-calling loop, agent-mode submit_final_response,
  // ghost-wrap guardrail, max-turns force-final pass all live in the sibling service).
  const toolMessages: ToolMessage[] = []
  const generatedImagePaths: GeneratedImage[] = []
  await runNativeToolLoop({
    repos,
    chatId,
    userId,
    character,
    characterParticipant,
    preGeneratedAssistantMessageId,
    agentMode,
    formattedMessages,
    modelParams,
    actualTools,
    useNativeWebSearch,
    toolContext,
    streaming: streamingState,
    toolMessages,
    generatedImagePaths,
    controller,
    encoder,
    preservePartialOnError,
  })

  // Phase 19: provider-native text tool markers (catches spontaneous XML
  // emissions like DeepSeek's <function_calls> or Gemini's <tool_use>). Each
  // plugin knows which formats its models emit; no-op when the plugin
  // doesn't implement the detector or the response is empty.
  const providerPlugin = getProvider(streamingState.effectiveProfile.provider)
  if (providerPlugin?.hasTextToolMarkers && providerPlugin.parseTextToolCalls && providerPlugin.stripTextToolMarkers) {
    const pluginHasMarkers = providerPlugin.hasTextToolMarkers
    const pluginParse = providerPlugin.parseTextToolCalls
    const pluginStrip = providerPlugin.stripTextToolMarkers
    await runTextToolPass({
      chatId,
      userId,
      character,
      preGeneratedAssistantMessageId,
      strategy: {
        name: 'provider-text-markers',
        hasMarkers: pluginHasMarkers,
        parse: pluginParse,
        strip: pluginStrip,
        formatToolResult: (toolName, content) => `[Tool Result: ${toolName}]\n${content}`,
      },
      formattedMessages,
      modelParams,
      continuationTools: actualTools,
      continuationUseNativeWebSearch: useNativeWebSearch,
      toolContext,
      streaming: streamingState,
      toolMessages,
      generatedImagePaths,
      controller,
      encoder,
      preservePartialOnError,
    })
  }

  // Phase 20: text-format tool calls (simple-json `<tool_call>{...}</tool_call>`
  // or legacy text-block `[[TOOL ...]]content[[/TOOL]]`), runs for ALL providers.
  // When useTextBlockTools is on, the continuation suppresses native tools and
  // web search so the model can't re-emit the markers it just had stripped.
  if (resolvedToolMode === 'simple-json') {
    await runTextToolPass({
      chatId,
      userId,
      character,
      preGeneratedAssistantMessageId,
      strategy: {
        name: 'simple-json',
        hasMarkers: hasSimpleJsonInResponse,
        parse: (response) =>
          parseSimpleJsonFromResponse(response, {
            provider: streamingState.effectiveProfile.provider,
            model: streamingState.effectiveProfile.modelName,
          }),
        strip: stripSimpleJsonFromResponse,
        formatToolResult: formatSimpleJsonToolResult,
        stopSequences: SIMPLE_JSON_STOP,
      },
      formattedMessages,
      modelParams,
      continuationTools: useTextBlockTools ? [] : actualTools,
      continuationUseNativeWebSearch: useNativeWebSearch && !useTextBlockTools,
      toolContext,
      streaming: streamingState,
      toolMessages,
      generatedImagePaths,
      controller,
      encoder,
      preservePartialOnError,
    })
  } else {
    // text-block (legacy) and the native/courier paths both fall through here
    // — for native/courier the pass no-ops because no markers are emitted.
    await runTextToolPass({
      chatId,
      userId,
      character,
      preGeneratedAssistantMessageId,
      strategy: {
        name: 'text-block',
        hasMarkers: hasTextBlockMarkers,
        parse: parseTextBlocksFromResponse,
        strip: stripTextBlockMarkersFromResponse,
        formatToolResult: (toolName, content) => `[Tool Result: ${toolName}]\n${content}`,
      },
      formattedMessages,
      modelParams,
      continuationTools: useTextBlockTools ? [] : actualTools,
      continuationUseNativeWebSearch: useNativeWebSearch && !useTextBlockTools,
      toolContext,
      streaming: streamingState,
      toolMessages,
      generatedImagePaths,
      controller,
      encoder,
      preservePartialOnError,
    })
  }

  const contentWasFlaggedDangerous = contentTreatedAsDangerous
  const { uncensoredRetryAttempted, sameProviderRetryAttempted, chainAttempts } =
    await attemptEmptyResponseRecovery({
      state: streamingState,
      toolMessagesLength: toolMessages.length,
      contentWasFlaggedDangerous,
      conciergePolicy,
      conciergeState: getConciergeState(chat),
      connectionProfile,
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
      stop: initialStopSequences,
      fallbackContext: {
        dangerous: contentWasFlaggedDangerous,
        // Read from the array, not from what the user uploaded: an image the
        // primary could not take was already replaced by its description
        // upstream, and a chain that still called the turn vision-bearing
        // would skip understudies that are perfectly able to answer it.
        needsVision: collectAttachmentMimeTypes(formattedMessages).some((m) => m.startsWith('image/')),
        needsTools: actualTools.length > 0,
      },
    })

  // Save assistant message
  let assistantMessageId: string | null = null

  // End-of-turn drain: collapse any wardrobe edits this character made into a
  // single Aurora announcement per affected character, regardless of which
  // terminal branch we exit through. The handlers add to the Set instead of
  // enqueuing per-edit; here we fire one job each and clear.
  await flushPendingWardrobeAnnouncements(toolContext)

  // The turn's Inventory changes — one Pascal line per character — are
  // posted once whichever branch below has saved the turn, so the line
  // follows the tool calls and the reply it sums up rather than preceding them.
  try {
    // ============================================================================
    // Hard stop — keep exactly what streamed
    // ============================================================================
    // The operator stopped the turn. What reached the screen is the reply; the
    // thinking never was, so it goes. No sentinel is read from a cut-off line —
    // a half-written "[NOTHING TO" is just words — and tools already run are
    // saved below as on any other turn.
    const turnStopped = isCurrentTurnStopped()
    if (turnStopped) {
      streamingState.reasoningContent = undefined
      streamingState.reasoningSegments = []
      logger.info('[TurnStop] Turn stopped by the operator; keeping what streamed', {
        chatId,
        characterId: character.id,
        participantId: characterParticipant.id,
        partialLength: streamingState.fullResponse.length,
        toolCount: toolMessages.length,
      })
    }

    // ============================================================================
    // Raised hand — did the asked character yield?
    // ============================================================================
    // Any prose around the sentinel is kept as the character's reply; a bare
    // yield with no tools run persists nothing but the Host's note. Either way
    // the chain stops after this turn and the floor is the operator's.
    let yieldedFloor = false
    if (offerYield && !turnStopped) {
      const yieldDetection = detectYieldSentinel(
        streamingState.fullResponse,
        character.name,
        character.aliases ?? undefined,
      )
      safeEnqueue(controller, encodeHandAnsweredEvent(encoder, {
        participantId: characterParticipant.id,
        characterName: character.name,
        yielded: yieldDetection.yielded,
      }))
      if (yieldDetection.yielded) {
        yieldedFloor = true
        streamingState.fullResponse = yieldDetection.cleaned
        logger.info('[TurnYield] Character yielded the floor to the raised hand', {
          chatId,
          characterId: character.id,
          participantId: characterParticipant.id,
          withReply: yieldDetection.cleaned.length > 0,
          toolCount: toolMessages.length,
        })
        if (yieldDetection.cleaned.trim().length === 0 && toolMessages.length === 0) {
          return handleTurnYield({
            chatId,
            character,
            characterParticipant,
            operatorName: resolvedIdentity.name,
            isMultiCharacter,
            userParticipantId,
            isPaused: chat.isPaused,
            streaming: streamingState,
            controller,
            encoder,
            mailAlertsOwed: builtContext.mailAlertsOwed,
          })
        }
      } else {
        logger.info('[TurnYield] Character carried on past the raised hand', {
          chatId,
          characterId: character.id,
          participantId: characterParticipant.id,
        })
      }
    }

    // A yield that came with words (or tools): the reply is saved as usual, then
    // the Host notes the yield and the chain is told to stop.
    const finishYieldedTurn = async (result: ProcessMessageResult): Promise<ProcessMessageResult> => {
      if (!yieldedFloor) return result
      await announceTurnYield({
        chatId,
        character,
        characterParticipant,
        operatorName: resolvedIdentity.name,
        controller,
        encoder,
      })
      return { ...result, yielded: true }
    }

    // ============================================================================
    // "Nothing to add" turn-skipping — sentinel handling
    // ============================================================================
    // Detect the pass sentinel on the raw response before the finalizer. Only
    // when eligibility was computed for this turn (multi-character, LLM responder).
    if (turnSkip && !turnStopped && !yieldedFloor) {
      const detection = detectSkipSentinel(
        streamingState.fullResponse,
        character.name,
        character.aliases ?? undefined,
      )
      if (detection.skip) {
        if (toolMessages.length > 0) {
          // Tools ran this turn — the turn had real effects, so the tool-save
          // branch must win. Clear the bare sentinel so that branch fires.
          logger.warn('[TurnSkip] Sentinel emitted but tools ran; keeping tool results, ignoring the pass', {
            chatId,
            characterId: character.id,
            participantId: characterParticipant.id,
            toolCount: toolMessages.length,
          })
          streamingState.fullResponse = ''
        } else if (turnSkip.offerSkip) {
          return handleTurnSkip({
            repos,
            chatId,
            character,
            characterParticipant,
            isMultiCharacter,
            userParticipantId,
            streaming: streamingState,
            controller,
            encoder,
            mailAlertsOwed: builtContext.mailAlertsOwed,
          })
        } else {
          // Sentinel when the skip option wasn't offered: route to the existing
          // empty-response branch (bare pass with no effects → nothing persisted).
          streamingState.fullResponse = ''
        }
      } else if (detection.cleaned !== undefined) {
        // Sentinel line + trailing prose: strip the line, keep the prose, and
        // fall through to the normal finalizer as a real reply.
        streamingState.fullResponse = detection.cleaned
      }
    }

    if (streamingState.fullResponse && streamingState.fullResponse.trim().length > 0) {
      const finalized = await finalizeMessageResponse({
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
          userCharacterId,
        },
      })
      return finishYieldedTurn(finalized)
    } else if (toolMessages.length > 0) {
      // Save tool messages even without text response
      const toolWhisperContext: ToolWhisperContext = {
        userParticipantId,
        allowCrossCharacterVaultReads: chat.allowCrossCharacterVaultReads === true,
      }
      const toolSaveResult = await saveToolMessages(
        repos,
        chatId,
        userId,
        toolMessages,
        generatedImagePaths,
        character.id,
        characterParticipant.id,
        toolWhisperContext
      )

      // The model read this turn's mail and acted (tools ran); the turn is kept.
      await markMailAlertsDelivered(builtContext.mailAlertsOwed, { chatId, via: 'tool-only' })

      await repos.chats.update(chatId, { updatedAt: new Date().toISOString() })

      controller.enqueue(encodeDoneEvent(encoder, {
        messageId: toolSaveResult.firstToolMessageId,
        participantId: characterParticipant.id,
        usage: streamingState.usage,
        cacheUsage: streamingState.cacheUsage,
        attachmentResults: streamingState.attachmentResults,
        toolsExecuted: true,
        provider: streamingState.effectiveProfile.provider,
        modelName: streamingState.effectiveProfile.modelName,
      }))

      return finishYieldedTurn({
        isMultiCharacter,
        hasContent: true,
        messageId: toolSaveResult.firstToolMessageId || null,
        userParticipantId,
        isPaused: chat.isPaused,
      })
    } else if (turnStopped) {
      // Stopped before a word streamed and before any tool ran: nothing to
      // keep, and nothing to apologise for — it is what the operator asked.
      safeEnqueue(controller, encodeDoneEvent(encoder, {
        messageId: null,
        participantId: characterParticipant.id,
        usage: streamingState.usage,
        cacheUsage: streamingState.cacheUsage,
        attachmentResults: streamingState.attachmentResults,
        toolsExecuted: false,
        stopped: true,
        provider: streamingState.effectiveProfile.provider,
        modelName: streamingState.effectiveProfile.modelName,
      }))
      return {
        isMultiCharacter,
        hasContent: false,
        messageId: null,
        userParticipantId,
        isPaused: chat.isPaused,
      }
    } else {
      // Empty response
      // The provider may have said why it returned nothing. Z.AI reports
      // `finish_reason: sensitive` on a moderation refusal, OpenAI
      // `content_filter`, Google `SAFETY` — all of which make "try resending"
      // actively wrong advice (bug 93).
      const emptyFinishReason = extractFinishReason(streamingState.rawResponse)
      const emptyReason = getEmptyResponseReason({
        uncensoredRetryAttempted,
        sameProviderRetryAttempted,
        contentWasFlaggedDangerous,
        chainAttempts,
        finishReason: emptyFinishReason,
        provider: streamingState.effectiveProfile.provider,
        modelName: streamingState.effectiveProfile.modelName,
      })
      logger.warn(`Empty response for chat ${chatId}`, {
        uncensoredRetryAttempted,
        sameProviderRetryAttempted,
        contentWasFlaggedDangerous,
        chainAttempts: chainAttempts.map((a) => ({
          profileName: a.profileName,
          provider: a.provider,
          trigger: a.trigger,
        })),
        finishReason: emptyFinishReason,
        moderationRefusal: isModerationFinishReason(emptyFinishReason),
        conciergeSource: conciergePolicy.source,
        conciergeState: conciergePolicy.state,
        provider: streamingState.effectiveProfile.provider,
        model: streamingState.effectiveProfile.modelName,
      })
      controller.enqueue(encodeDoneEvent(encoder, {
        messageId: null,
        participantId: characterParticipant.id,
        usage: streamingState.usage,
        cacheUsage: streamingState.cacheUsage,
        attachmentResults: streamingState.attachmentResults,
        toolsExecuted: false,
        emptyResponse: true,
        emptyResponseReason: emptyReason,
        provider: streamingState.effectiveProfile.provider,
        modelName: streamingState.effectiveProfile.modelName,
      }))

      return {
        isMultiCharacter,
        hasContent: false,
        messageId: null,
        userParticipantId,
        isPaused: chat.isPaused,
      }
    }
  } finally {
    await flushPendingInventoryAnnouncements(toolContext)
  }
}

/**
 * Close out a user turn that a paused chat held.
 *
 * The message and its side effects are already persisted by the time this is
 * called; all that remains is to leave the floor empty and tell the Salon why
 * the room said nothing. The `paused` chain-complete is the same event a
 * mid-chain pause emits, so the client reconciles its pause flag through the
 * one path it already has (bug 123) — it just arrives at depth 0, before any
 * character has spoken.
 */
async function finishHeldUserTurn(params: {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  isMultiCharacter: boolean
  userMessageId: string | null
  userParticipantId: string | null
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}): Promise<ProcessMessageResult> {
  const { repos, chatId, isMultiCharacter, userMessageId, userParticipantId, controller, encoder } = params

  // Nobody is on deck: the rotation resumes from wherever the user left it, and
  // a stale pending seat would have the Salon announce a turn that isn't coming.
  await repos.chats.update(chatId, { lastTurnParticipantId: null })

  safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
    reason: 'paused',
    nextSpeakerId: null,
    chainDepth: 0,
    paused: true,
    heldUserTurn: true,
  }))

  return {
    isMultiCharacter,
    // No character took the floor, so the turn chain stops before it starts and
    // neither scene tracking nor the Scriptorium render fires for this message.
    hasContent: false,
    messageId: userMessageId,
    userParticipantId,
    isPaused: true,
  }
}

/**
 * Fair-rotation pause for rooms where the human drives two or more seats.
 *
 * Called on a fresh, non-whisper user send before any responder is resolved.
 * Returns a terminal `ProcessMessageResult` (so the caller returns immediately
 * and the turn chain does not run) when the rotation's next speaker after this
 * post is ANOTHER seat the human drives — persisting the user's message and
 * pausing for that seat. Returns `null` in every other case (single user seat,
 * or an LLM is genuinely up next), letting the normal generation path proceed
 * untouched.
 */
async function maybePauseForUserSeatTurn(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  chat: ChatMetadataBase,
  userId: string,
  options: SendMessageOptions,
  speakingAsParticipantId: string | null,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<ProcessMessageResult | null> {
  // Which seat is the human speaking as? (overlay-aware — an impersonated seat
  // counts, Bug 44.)
  const posterSeat = findActiveUserParticipant(
    chat.participants,
    speakingAsParticipantId,
    chat.impersonatingParticipantIds,
  )
  if (!posterSeat) return null

  // Only relevant when the human drives 2+ seats; otherwise the LLM answering a
  // human post is exactly right and this guard must not change anything.
  // NB: `getActiveCharacterParticipants` is a misnomer — it returns LLM seats
  // only — so filter the full roster here; a user-controlled seat (and the
  // impersonated overlay) must both count.
  const activeChars = getPresentCharacterSeats(chat.participants)
  const userDrivenSeatCount = activeChars.filter(p =>
    isUserDrivenSeat(p, chat.impersonatingParticipantIds),
  ).length
  if (userDrivenSeatCount < 2) return null

  // Talkativeness lives on the character record — build the weight map.
  const charactersMap = await loadRoomCharacters(repos, chat.participants)

  const next = selectNextSpeakerAfterUserMessage(
    chat.participants,
    charactersMap,
    posterSeat.id,
    chat.spokenThisCycleParticipantIds,
    chat.turnQueue,
    posterSeat.id,
    chat.impersonatingParticipantIds,
    chat.cycleOrderParticipantIds,
  )
  const nextSeat = next.nextSpeakerId
    ? chat.participants.find(p => p.id === next.nextSpeakerId)
    : null

  const nextIsUserDriven = !!nextSeat && isUserDrivenSeat(nextSeat, chat.impersonatingParticipantIds)
  logger.debug('[TurnFairness] Evaluated first-responder rotation after user post', {
    chatId,
    posterParticipantId: posterSeat.id,
    userDrivenSeatCount,
    nextSpeakerId: next.nextSpeakerId,
    nextReason: next.reason,
    willPause: nextIsUserDriven,
  })

  // An LLM (or nobody) is up next — let the normal path generate its reply.
  if (!nextSeat || !nextIsUserDriven) {
    return null
  }

  // The floor after this post belongs to another seat the human drives. Persist
  // the message (which advances the persisted cycle via addMessage) and pause.
  const userMessageId = crypto.randomUUID()
  const now = new Date().toISOString()
  await repos.chats.addMessage(chatId, {
    id: userMessageId,
    type: 'message' as const,
    role: 'USER' as const,
    content: options.content ?? '',
    createdAt: now,
    attachments: options.fileIds || [],
    participantId: posterSeat.id,
    targetParticipantIds: null,
  })
  for (const fileId of options.fileIds || []) {
    try {
      await repos.files.addLink(fileId, userMessageId)
    } catch (error) {
      logger.warn('[TurnFairness] Failed to link attachment on paused user turn', {
        chatId, fileId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Inline @Name / @Name? queries are a side effect and still fire, even though
  // no character takes the floor this turn (mirrors the main path).
  if (options.content) {
    await runCarinaMarkupQuery({
      userId,
      chatId,
      text: options.content,
      askerParticipantId: posterSeat.id,
      operatorInitiated: true,
      logLabels: { detected: 'user message', failed: 'user-message' },
      onConsulting: (characterName) => safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'gathering',
        message: `Consulting ${characterName}...`,
      })),
      onPosted: (msg) => safeEnqueue(controller, encodeCarinaAnswerEvent(encoder, msg)),
      onPublicAnswer: () => { /* no character responds this turn to hear it */ },
    })
  }

  // Persist the pending turn and tell the client whose floor it is. The client's
  // own recompute (from the freshly-saved history) lands on the same seat; the
  // event settles its streaming state and refreshes the banner immediately.
  await repos.chats.update(chatId, { lastTurnParticipantId: nextSeat.id })
  safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
    reason: 'user_turn',
    nextSpeakerId: nextSeat.id,
    chainDepth: 0,
  }))

  logger.info('[TurnFairness] User post pauses for another user-driven seat', {
    chatId,
    posterParticipantId: posterSeat.id,
    nextSpeakerId: nextSeat.id,
  })

  return {
    isMultiCharacter: true,
    hasContent: false,
    messageId: userMessageId,
    userParticipantId: posterSeat.id,
    isPaused: chat.isPaused === true,
  }
}

/**
 * "Nothing to add" turn-skipping — skip path.
 *
 * Posts the Host turn-pass announcement, records the passing participant in the
 * persisted cycle set (so the rotation advances past them), surfaces the Host
 * bubble live over SSE, and emits a `done` event flagged `skipped: true` so the
 * client resets its streaming buffer without appending a phantom bubble. No
 * character reply is persisted.
 */
async function handleTurnSkip(params: {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  character: { id: string; name: string }
  characterParticipant: { id: string }
  isMultiCharacter: boolean
  userParticipantId: string | null
  streaming: StreamingState
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  /** This turn's announced letters: a deliberate pass still read them. */
  mailAlertsOwed: MailAlertsOwed | null
}): Promise<ProcessMessageResult> {
  const {
    repos,
    chatId,
    character,
    characterParticipant,
    isMultiCharacter,
    userParticipantId,
    streaming,
    controller,
    encoder,
    mailAlertsOwed,
  } = params

  logger.info('[TurnSkip] Character passed the turn', {
    chatId,
    characterId: character.id,
    participantId: characterParticipant.id,
  })

  // A pass is an answer: the character read its mail and chose to say
  // nothing. Mark the letters so the next turn does not announce them again.
  await markMailAlertsDelivered(mailAlertsOwed, { chatId, via: 'turn-skip' })

  // Post the Host announcement (errors swallowed by the writer contract).
  const hostMessage = await postHostTurnPassAnnouncement({
    chatId,
    characterName: character.name,
    participantId: characterParticipant.id,
    source: 'llm',
  })

  // Record the pass in the persisted cycle so the next speaker selection
  // advances past this character. Re-read for fresh participants/cycle state.
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
      const updatePayload: Record<string, unknown> = { updatedAt: new Date().toISOString() }
      if (cycleUpdate !== null) {
        updatePayload.spokenThisCycleParticipantIds = cycleUpdate
      }
      if (orderUpdate !== null) {
        // A pass spends the turn: the character leaves this cycle's rotation
        // exactly as a spoken line would have taken them out of it.
        updatePayload.cycleOrderParticipantIds = orderUpdate
      }
      await repos.chats.update(chatId, updatePayload)
    }
  } catch (error) {
    logger.warn('[TurnSkip] Failed to persist cycle update after pass', {
      chatId,
      participantId: characterParticipant.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Surface the Host bubble live, then close the turn with the skipped flag.
  if (hostMessage) {
    safeEnqueue(controller, encodeHostAnnouncementEvent(encoder, hostMessage))
  }
  safeEnqueue(controller, encodeDoneEvent(encoder, {
    messageId: null,
    participantId: characterParticipant.id,
    usage: streaming.usage,
    cacheUsage: streaming.cacheUsage,
    attachmentResults: streaming.attachmentResults,
    toolsExecuted: false,
    skipped: true,
    skippedParticipantId: characterParticipant.id,
    provider: streaming.effectiveProfile.provider,
    modelName: streaming.effectiveProfile.modelName,
  }))

  return {
    isMultiCharacter,
    hasContent: false,
    skipped: true,
    skippedParticipantId: characterParticipant.id,
    messageId: null,
    userParticipantId,
    isPaused,
  }
}

/**
 * Post the Host's turn-yield note and surface it live. Shared by the bare
 * yield and the yield that came with a reply.
 */
async function announceTurnYield(params: {
  chatId: string
  character: { name: string }
  characterParticipant: { id: string }
  operatorName: string
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}): Promise<void> {
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
 * Like a turn-pass, no reply is persisted and the done event is flagged
 * `skipped` so the client drops its streaming buffer without a phantom bubble
 * (the Host's yield note is the visible record). Unlike a pass, the rotation is
 * not advanced — the character gave the floor away rather than spending its
 * turn — and the result is `yielded`, which stops the chain so the operator
 * speaks next. Informs stay pending for the character's next real turn.
 */
async function handleTurnYield(params: {
  chatId: string
  character: { id: string; name: string }
  characterParticipant: { id: string }
  operatorName: string
  isMultiCharacter: boolean
  userParticipantId: string | null
  isPaused: boolean
  streaming: StreamingState
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  /** This turn's announced letters: a yield still read them. */
  mailAlertsOwed: MailAlertsOwed | null
}): Promise<ProcessMessageResult> {
  const { chatId, character, characterParticipant, streaming, controller, encoder } = params

  await markMailAlertsDelivered(params.mailAlertsOwed, { chatId, via: 'turn-yield' })
  await announceTurnYield(params)

  safeEnqueue(controller, encodeDoneEvent(encoder, {
    messageId: null,
    participantId: characterParticipant.id,
    usage: streaming.usage,
    cacheUsage: streaming.cacheUsage,
    attachmentResults: streaming.attachmentResults,
    toolsExecuted: false,
    skipped: true,
    skippedParticipantId: characterParticipant.id,
    yielded: true,
    provider: streaming.effectiveProfile.provider,
    modelName: streaming.effectiveProfile.modelName,
  }))

  logger.debug('[TurnYield] Bare yield closed without a reply', {
    chatId,
    characterId: character.id,
    participantId: characterParticipant.id,
  })

  return {
    isMultiCharacter: params.isMultiCharacter,
    hasContent: false,
    messageId: null,
    userParticipantId: params.userParticipantId,
    isPaused: params.isPaused,
    yielded: true,
  }
}

/**
 * Handle stream errors
 */
function handleStreamError(
  error: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  context: { chatId: string; ledger: SubmissionLedger }
): void {
  const { chatId, ledger } = context
  logger.error('Streaming error', {
    chatId,
    userMessagePersisted: ledger.userMessagePersisted,
    pendingToolResultsPersisted: ledger.pendingToolResultsPersisted,
  }, error as Error)

  let errorMessage = 'Unknown error'
  let errorType = 'unknown'

  if (error instanceof z.ZodError) {
    const firstError = error.issues[0]
    errorMessage = firstError
      ? `Validation error: ${firstError.message} at ${firstError.path.join('.')}`
      : 'Response validation failed'
    errorType = 'validation'

  } else if (error instanceof Error) {
    errorMessage = error.message
    errorType = error.name
  }

  // Use safe methods to prevent crash if stream is already closed
  logger.debug('[Orchestrator] Emitting error frame', {
    chatId,
    errorType,
    userMessagePersisted: ledger.userMessagePersisted,
    pendingToolResultsPersisted: ledger.pendingToolResultsPersisted,
  })
  safeEnqueue(controller, encodeErrorEvent(encoder, 'Failed to generate response', errorType, errorMessage, {
    userMessagePersisted: ledger.userMessagePersisted,
    pendingToolResultsPersisted: ledger.pendingToolResultsPersisted,
  }))
  safeClose(controller)
}
