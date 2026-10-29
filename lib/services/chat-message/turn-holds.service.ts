/**
 * Turn Holds — when an operator's post is recorded but no character answers it.
 *
 * Three rules can hold a post:
 *
 * - **Paused chat.** A paused conversation never moves on its own. The post is
 *   recorded in full and draws no reply until the operator nudges a character
 *   or presses Resume (`shouldHoldUserTurnForPause`, bug 137).
 * - **Storyteller.** In a storyteller chat a public post opens a round of bids
 *   instead of drawing a reply; `handleSendMessage` opens it.
 * - **Fair rotation.** In a room where the human drives two or more seats, if
 *   the rotation's next speaker after this post is *another* of those seats,
 *   the floor is theirs: the post is recorded and the Salon shows that seat's
 *   turn banner instead of forcing an LLM to speak out of turn (bug 50).
 *
 * The first two are decided before the turn is built (`resolveTurnHold`) and
 * finished after the post is recorded; the third decides and records in one
 * step because it needs no responder. All three record the post through
 * `recordOperatorPost`, so a held post is the same post an answered one is.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  findActiveUserParticipant,
  getPresentCharacterSeats,
  isMultiCharacterChat,
  isUserDrivenSeat,
  loadRoomCharacters,
  selectNextSpeakerAfterUserMessage,
} from '@/lib/chat/turn-manager'
import { parseCarinaQuery } from '@/lib/chat/carina-parser'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase } from '@/lib/schemas/types'
import { findAttachedFiles } from './context-builder.service'
import { recordOperatorPost } from './operator-post.service'
import { shouldHoldUserTurnForPause } from './paused-hold'
import { isOperatorWhisperSend } from './whisper-send'
import { createTurnStatusEmitter, encodeChainCompleteEvent, safeEnqueue } from './streaming.service'
import type { SubmissionLedger } from './turn-stream'
import type { ProcessMessageResult, SendMessageOptions } from './types'

const logger = createServiceLogger('TurnHolds')

/** Why a recorded post draws no reply, or null when a character answers it. */
export type TurnHold = 'paused' | 'storyteller' | null

type HoldOptions = Pick<SendMessageOptions,
  'continueMode' | 'neverPauseForUser' | 'targetParticipantIds' | 'respondingParticipantId' | 'nudge' | 'content'>

/**
 * Decide whether this send's post is held (pure).
 *
 * Continue-mode turns are the explicit summons themselves — Nudge, Skip, the
 * all-LLM modal's Continue, an autonomous-room turn — so they are never held;
 * the chain that would follow one is what `executeTurnChain` stops while
 * `isPaused` stands. In a storyteller chat a whisper still draws its one reply
 * (bug 258), and an autonomous room never runs in that mode.
 */
export function resolveTurnHold(
  chat: Pick<ChatMetadataBase, 'isPaused' | 'turnMode'>,
  options: HoldOptions
): TurnHold {
  const isContinueMode = options.continueMode === true
  if (shouldHoldUserTurnForPause({
    isContinueMode,
    chatIsPaused: chat.isPaused === true,
    neverPauseForUser: options.neverPauseForUser,
  })) {
    return 'paused'
  }
  if (!isContinueMode
    && chat.turnMode === 'storyteller'
    && !isOperatorWhisperSend(options)
    && options.neverPauseForUser !== true) {
    return 'storyteller'
  }
  return null
}

/**
 * Whether a send is one the fair-rotation guard should look at (pure). A
 * whisper, a nudge, an explicit responding participant or a continue-mode turn
 * name their own speaker; a held post is already held (and a storyteller round
 * asks every LLM seat at once); a single-character chat has no rotation.
 */
export function qualifiesForFairRotationCheck(
  chat: Pick<ChatMetadataBase, 'participants'>,
  options: HoldOptions,
  hold: TurnHold
): boolean {
  return options.continueMode !== true
    && hold === null
    && !options.respondingParticipantId
    && !isOperatorWhisperSend(options)
    && !options.nudge
    && !!options.content
    && isMultiCharacterChat(chat.participants)
}

/**
 * Fair-rotation pause for rooms where the human drives two or more seats.
 *
 * Returns a terminal result (the caller returns it and no turn chain runs)
 * when the rotation's next speaker after this post is another seat the human
 * drives — having recorded the post and pointed the floor at that seat.
 * Returns `null` in every other case (single user seat, or an LLM is genuinely
 * up next), and the normal generation path proceeds untouched.
 */
export async function maybePauseForUserSeatTurn(params: {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  chat: ChatMetadataBase
  userId: string
  options: SendMessageOptions
  speakingAsParticipantId: string | null
  ledger: SubmissionLedger
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}): Promise<ProcessMessageResult | null> {
  const { repos, chatId, chat, userId, options, controller, encoder } = params

  // Which seat is the human speaking as? (overlay-aware — an impersonated seat
  // counts, Bug 44.)
  const posterSeat = findActiveUserParticipant(
    chat.participants,
    params.speakingAsParticipantId,
    chat.impersonatingParticipantIds,
  )
  if (!posterSeat) return null

  // Only relevant when the human drives 2+ seats; otherwise the LLM answering a
  // human post is exactly right and this guard must not change anything. The
  // full roster is counted: a user-controlled seat and an impersonated one both
  // count (bug 131).
  const userDrivenSeatCount = getPresentCharacterSeats(chat.participants)
    .filter(p => isUserDrivenSeat(p, chat.impersonatingParticipantIds))
    .length
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
  if (!nextSeat || !nextIsUserDriven) return null

  // The floor after this post belongs to another seat the human drives. Record
  // the post in full (the persist advances the cycle via addMessage) — nobody
  // answers it this turn, so nothing is spliced into a context.
  const { userMessageId } = await recordOperatorPost({
    repos,
    chatId,
    userId,
    chat,
    chatSettings: await repos.chatSettings.findByUserId(userId),
    content: options.content ?? '',
    fileIds: options.fileIds,
    attachedFiles: await findAttachedFiles(repos, chatId, options.fileIds),
    pendingToolResults: options.pendingToolResults,
    targetParticipantIds: null,
    poster: { participant: posterSeat, participantId: posterSeat.id },
    context: [],
    ledger: params.ledger,
    controller,
    encoder,
    status: createTurnStatusEmitter(controller, encoder),
  })

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
 * Close out a post held by a paused chat or a storyteller round, once it is
 * recorded.
 *
 * Nobody is on deck either way: the rotation resumes from wherever the user
 * left it, and a stale pending seat would have the Salon announce a turn that
 * isn't coming.
 *
 * - A paused hold emits the `paused` chain-complete — the same event a
 *   mid-chain pause emits, so the client reconciles its pause flag through the
 *   one path it already has (bug 123); it just arrives at depth 0, before any
 *   character has spoken.
 * - A storyteller hold emits nothing: `handleSendMessage` opens the round,
 *   which holds the stream. An `@Name:` query is answered as in every mode and
 *   opens no round.
 */
export async function finishHeldPost(params: {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  hold: Exclude<TurnHold, null>
  isMultiCharacter: boolean
  userMessageId: string | null
  userParticipantId: string | null
  content: string
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}): Promise<ProcessMessageResult> {
  const { repos, chatId, hold, isMultiCharacter, userMessageId, userParticipantId, controller, encoder } = params

  await repos.chats.update(chatId, { lastTurnParticipantId: null })

  if (hold === 'storyteller') {
    return {
      isMultiCharacter,
      hasContent: false,
      messageId: userMessageId,
      userParticipantId,
      isPaused: false,
      storytellerHold: {
        triggerMessageId: userMessageId,
        carina: !!(params.content && parseCarinaQuery(params.content)),
      },
    }
  }

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
