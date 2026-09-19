/**
 * Regenerate-Swipe Service
 *
 * Generates an alternative ("swipe") for an existing assistant message and
 * stores it as a properly-attributed variant of that message.
 *
 * Unlike the legacy in-route generator this replaced, it runs through the same
 * context engine a normal turn uses (`resolveRespondingParticipant` +
 * `buildMessageContext`), so the regeneration gets the responder's real system
 * prompt, multi-character attribution, and memory recall — and the new swipe is
 * attributed to the *same participant* as the message being regenerated, grouped
 * in place rather than appended as a stray new message.
 *
 * Generation itself is a single provider call with no tools — a swipe is one
 * alternative line — so it stays off the streaming/turn-chain path and the live
 * send path is untouched. It *is* read as a stream: the caller can hand in
 * `onProgress` and watch the re-roll arrive token by token (that is what puts
 * live text under the Salon's "Regenerating..." overlay). With no callback the
 * chunks are simply accumulated, so a non-streaming caller sees the same
 * finished swipe it always did. Every field the swipe persists — usage, raw
 * response, thought signature, reasoning — rides the chunks, so reading the
 * response as a stream costs the record nothing.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { createLLMProvider } from '@/lib/llm'
import { withStallWatchdog } from '@/lib/llm/stream-watchdog'
import { profileParams } from '@/lib/llm/cheap-llm'
import { resolveSamplingParams } from '@/lib/llm/sampling-params'
import { deleteMemoriesBySourceMessageWithVectors } from '@/lib/memory/memory-service'
import {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
} from './participant-resolver.service'
import { buildMessageContext } from './context-builder.service'
import { resolveUserIdentity } from './user-identity-resolver.service'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase, MessageEvent } from '@/lib/schemas/types'
import type { MemoryCascadeAction } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('RegenerateSwipeService')

/**
 * A step of a regeneration, reported live so the Salon can narrate it exactly
 * the way it narrates a first-time turn: a status line above the composer, then
 * prose arriving under the dimmed original.
 *
 * `content` is a DELTA (append it); `reasoning` is CUMULATIVE (replace it) —
 * the same contract the send path's SSE events use, so the client-side handling
 * is identical in both places.
 */
export type RegenerateSwipeProgress =
  | { kind: 'status'; stage: string; message: string; characterName?: string; characterId?: string }
  | { kind: 'delta'; content: string }
  | { kind: 'reasoning'; reasoning: string }

export interface RegenerateSwipeOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  /** The chat the message lives in (already loaded by the caller) */
  chat: ChatMetadataBase
  /** The assistant message being regenerated */
  targetMessage: MessageEvent
  /** All events in the chat (already loaded by the caller) */
  allMessages: MessageEvent[]
  /** The user-controlled participant the human is "Speaking As" (optional override) */
  activeUserParticipantId?: string | null
  /**
   * Live progress for a caller that is showing the re-roll as it happens.
   * Optional: with no callback the generation is identical, just silent.
   */
  onProgress?: (event: RegenerateSwipeProgress) => void
}

/**
 * Generate a fresh response for an existing assistant message and persist it as
 * a swipe variant. Returns the new swipe message.
 */
export async function regenerateMessageAsSwipe({
  repos,
  userId,
  chat,
  targetMessage,
  allMessages,
  activeUserParticipantId,
  onProgress,
}: RegenerateSwipeOptions): Promise<MessageEvent> {
  if (targetMessage.role !== 'ASSISTANT') {
    throw new Error('Only assistant messages can be regenerated')
  }
  // Staff/system-authored messages (Lantern, Host, Prospero, etc.) are not
  // character turns — they have no responder to regenerate from.
  if (targetMessage.systemSender) {
    throw new Error('Staff and system messages cannot be regenerated')
  }

  // Resolve the responder from the message's own participant so the regeneration
  // speaks as the same character. A null participant (legacy/single-character
  // message) falls back to weighted first-responder selection.
  const requestedParticipantId = targetMessage.participantId ?? undefined
  const participantResult = await resolveRespondingParticipant(
    repos,
    chat,
    userId,
    requestedParticipantId,
    !!requestedParticipantId
  )
  const {
    characterParticipant,
    character,
    connectionProfile,
    apiKey,
    isMultiCharacter,
  } = participantResult

  // User identity (honors "Speaking As") + per-character map + template + settings.
  const speakingAsId = activeUserParticipantId ?? chat.activeTypingParticipantId ?? null
  const resolvedIdentity = await resolveUserIdentity(repos, userId, chat, speakingAsId)
  const userCharacter = { name: resolvedIdentity.name, description: resolvedIdentity.description }
  const { participantCharacters } = await loadAllParticipantData(repos, chat, character)
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const roleplayTemplate = await getRoleplayTemplate(
    repos,
    chat,
    chatSettings ? { defaultRoleplayTemplateId: chatSettings.defaultRoleplayTemplateId ?? undefined } : null
  )

  // Context = everything strictly before the message being regenerated. Sibling
  // swipes share the original's timestamp, so a strict `<` also drops them.
  const targetTime = new Date(targetMessage.createdAt).getTime()
  const previousMessages = allMessages.filter(
    (m): m is MessageEvent =>
      m.type === 'message' && new Date(m.createdAt).getTime() < targetTime
  )

  // Informs re-apply on a swipe. A swipe re-rolls a line that has already been
  // spoken, so it must see exactly the passages THAT generation saw — the
  // target message and every sibling in its swipe group, since any of them may
  // have been the generation that consumed a row. Pending informs are
  // deliberately excluded: it would be surprising for a brand-new passage to
  // land in a re-roll of an old line and be spent there. Nothing here consumes
  // — `buildInformBlock` returns no row ids for a regeneration, and the swipe
  // path never calls `markConsumed`.
  const existingSwipeGroupId = targetMessage.swipeGroupId || null
  const regenerationOfMessageIds = [
    ...new Set([
      targetMessage.id,
      ...(existingSwipeGroupId
        ? allMessages
            .filter(m => m.type === 'message' && m.swipeGroupId === existingSwipeGroupId)
            .map(m => m.id)
        : []),
    ]),
  ]

  onProgress?.({
    kind: 'status',
    stage: 'gathering',
    message: `Regenerating — gathering ${character.name}'s memories and context...`,
    characterName: character.name,
    characterId: character.id,
  })

  // Build the full provider-ready context (system prompt, multi-char attribution,
  // memory recall) — continue mode, no new user message.
  const { formattedMessages } = await buildMessageContext(
    {
      repos,
      userId,
      chat,
      character,
      characterParticipant,
      connectionProfile,
      userCharacter,
      isMultiCharacter,
      participantCharacters,
      roleplayTemplate,
      chatSettings,
      newUserMessage: undefined,
      activeUserParticipantId: speakingAsId,
      isContinueMode: true,
      contextCompressionSettings: null,
      regenerationOfMessageIds,
    },
    previousMessages,
    []
  )

  // Single generation, no tools. Read as a stream so `onProgress` can hand the
  // re-roll to the Salon token by token; a caller that passes no callback just
  // gets the accumulated result. The stall watchdog is not optional on any
  // `streamMessage` consumer (bug 141): an SDK timeout stops at the response
  // headers, so a provider that answers and then goes quiet would hang this
  // call — and with it the operator's disabled composer — indefinitely.
  onProgress?.({
    kind: 'status',
    stage: 'sending',
    message: `Regenerating — sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  })

  const provider = await createLLMProvider(connectionProfile.provider, connectionProfile.baseUrl || undefined)
  const params = profileParams(connectionProfile) ?? {}

  let content = ''
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
  let rawResponse: unknown = null
  let reasoningContent: string | undefined
  let thoughtSignature: string | undefined
  let announcedStreaming = false

  for await (const chunk of withStallWatchdog(
    provider.streamMessage(
      {
        messages: formattedMessages.map(m => ({
          role: m.role.toLowerCase() as 'system' | 'user' | 'assistant' | 'tool',
          content: m.content,
          name: m.name,
          attachments: m.attachments as never,
          toolCallId: m.toolCallId,
          toolCalls: m.toolCalls,
        })),
        model: connectionProfile.modelName,
        ...resolveSamplingParams(params),
        profileParameters: params,
        cacheKey: character.id,
      },
      apiKey
    ),
    {
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      logContext: {
        context: 'regenerate-swipe.service',
        userId,
        chatId: chat.id,
        characterId: character.id,
        messageId: targetMessage.id,
      },
    }
  )) {
    if (chunk.content) {
      if (!announcedStreaming) {
        announcedStreaming = true
        onProgress?.({
          kind: 'status',
          stage: 'regenerating',
          message: `Regenerating ${character.name}'s reply...`,
          characterName: character.name,
          characterId: character.id,
        })
      }
      content += chunk.content
      onProgress?.({ kind: 'delta', content: chunk.content })
    }
    // Reasoning arrives cumulatively — keep the latest, never concatenate.
    if (chunk.reasoningContent) {
      reasoningContent = chunk.reasoningContent
      onProgress?.({ kind: 'reasoning', reasoning: chunk.reasoningContent })
    }
    if (chunk.usage) usage = chunk.usage
    if (chunk.rawResponse) rawResponse = chunk.rawResponse
    if (chunk.thoughtSignature) thoughtSignature = chunk.thoughtSignature
  }

  onProgress?.({
    kind: 'status',
    stage: 'saving',
    message: 'Regenerating — filing the new line...',
    characterName: character.name,
    characterId: character.id,
  })

  // Persist the grouping. The original anchors the group at index 0; on the first
  // regeneration its swipeGroupId must be written back (the legacy path only
  // mutated an in-memory copy, so the variant ended up orphaned and rendered as a
  // separate, mis-attributed message).
  const swipeGroupId = targetMessage.swipeGroupId || `swipe-${targetMessage.id}`
  if (!targetMessage.swipeGroupId) {
    await repos.chats.updateMessage(chat.id, targetMessage.id, { swipeGroupId, swipeIndex: 0 })
  }

  const groupMembers = allMessages.filter(
    (m): m is MessageEvent =>
      m.type === 'message' && (m.swipeGroupId === swipeGroupId || m.id === targetMessage.id)
  )
  const newSwipeIndex = groupMembers.reduce((max, m) => Math.max(max, m.swipeIndex || 0), 0) + 1

  const newSwipe: MessageEvent = {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content,
    // Attribute to the same participant that authored the original — this is the
    // fix for the regenerated-message-shows-the-wrong-character bug.
    participantId: characterParticipant.id,
    swipeGroupId,
    swipeIndex: newSwipeIndex,
    tokenCount: usage?.totalTokens ?? null,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    rawResponse: (rawResponse as Record<string, unknown>) ?? null,
    reasoningContent: reasoningContent ?? null,
    thoughtSignature: thoughtSignature ?? null,
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    attachments: [],
    // Keep the original's timestamp so the group stays in place in the transcript.
    createdAt: targetMessage.createdAt,
  } as MessageEvent

  await repos.chats.addMessage(chat.id, newSwipe)
  await repos.chats.update(chat.id, {})

  // Memory cascade: the variant being replaced may have seeded memories.
  const cascadeAction: MemoryCascadeAction =
    chatSettings?.memoryCascadePreferences?.onSwipeRegenerate || 'DELETE_MEMORIES'
  if (cascadeAction !== 'KEEP_MEMORIES') {
    try {
      const memoryCount = await repos.memories.countBySourceMessageId(targetMessage.id)
      if (memoryCount > 0) {
        await deleteMemoriesBySourceMessageWithVectors(targetMessage.id)
      }
    } catch (error) {
      logger.warn('[RegenerateSwipe] Memory cascade failed; swipe kept', {
        chatId: chat.id,
        targetMessageId: targetMessage.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('[RegenerateSwipe] Generated swipe', {
    chatId: chat.id,
    targetMessageId: targetMessage.id,
    participantId: characterParticipant.id,
    characterName: character.name,
    swipeGroupId,
    newSwipeIndex,
  })

  return newSwipe
}
