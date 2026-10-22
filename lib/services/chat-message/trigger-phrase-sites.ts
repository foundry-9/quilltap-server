/**
 * The two places Pascal listens for trigger phrases.
 *
 * Only words someone said are scanned, and only at the two sites that already
 * run the auto-RNG scan: the operator's message (orchestrator, after it is
 * persisted) and a character's reply (finalizer, after it is persisted). Each
 * helper derives that site's speaker and room, then hands off to
 * `runTriggeredCustomTools` (`lib/pascal/trigger-runner.ts`), which owns the
 * gate, the roster and the deal. Neither helper throws.
 *
 * A swipe or regeneration never reaches either site (it runs through
 * `regenerate-swipe.service.ts`), so a swipe fires nothing, matching the dice.
 */

import type { ToolEffect } from '@/lib/tools/effect-types'
import { runTriggeredCustomTools } from '@/lib/pascal/trigger-runner'
import type { ChatSettings } from '@/lib/schemas/settings.types'
import type { MessageEvent } from '@/lib/schemas/chat.types'

type TriggerSettings = Pick<ChatSettings, 'customTools' | 'customToolTriggers'> | null | undefined

interface RoomShape {
  projectId?: string | null
}

export interface UserMessageTriggerParams {
  userId: string
  chatId: string
  chat: RoomShape
  /** The message as persisted; '' when nothing was said. */
  content: string
  isContinueMode: boolean
  /** The seat the message is attributed to (`resolveRespondingParticipant`'s). */
  userParticipant: { type: string; characterId?: string | null } | null | undefined
  userParticipantId: string | null | undefined
  chatSettings: TriggerSettings
  /** This turn's in-memory context; Pascal's posts are spliced onto it. */
  existingMessages: { push: (...messages: MessageEvent[]) => unknown }
  onPosted: (message: MessageEvent) => void
}

/**
 * The operator's message. The seat speaks for itself: a user-driven or
 * impersonated character's words are that character's, and its roster is
 * theirs; the bare operator rolls as nobody. Continue mode said nothing.
 */
export async function runUserMessageTriggers(params: UserMessageTriggerParams): Promise<MessageEvent[]> {
  if (params.isContinueMode || !params.content) return []

  const seat = params.userParticipant
  const triggered = await runTriggeredCustomTools({
    userId: params.userId,
    chatId: params.chatId,
    content: params.content,
    speaker: {
      participantId: params.userParticipantId ?? null,
      characterId: seat?.type === 'CHARACTER' && seat.characterId ? seat.characterId : null,
    },
    projectId: params.chat.projectId ?? null,
    chatSettings: params.chatSettings,
    onPosted: params.onPosted,
  })

  // The responding model must see what Pascal just said — the same in-memory
  // splice the RNG TOOL rows and Carina's public answer rely on.
  params.existingMessages.push(...triggered)
  return triggered
}

export interface ReplyTriggerParams {
  userId: string
  chatId: string
  chat: RoomShape
  /** The reply as persisted. */
  content: string
  characterParticipantId: string
  characterId: string
  chatSettings: TriggerSettings
  onPosted: (message: MessageEvent) => void
  /** A storyteller turn's effect ceiling: a matched tool above it is skipped. */
  effectCeiling?: ToolEffect
}

/**
 * A character's reply, from that character's own perspective. No in-memory
 * splice: a chained next speaker re-reads the transcript.
 */
export async function runReplyTriggers(params: ReplyTriggerParams): Promise<MessageEvent[]> {
  if (!params.content) return []

  return runTriggeredCustomTools({
    userId: params.userId,
    chatId: params.chatId,
    content: params.content,
    speaker: { participantId: params.characterParticipantId, characterId: params.characterId },
    projectId: params.chat.projectId ?? null,
    chatSettings: params.chatSettings,
    onPosted: params.onPosted,
    effectCeiling: params.effectCeiling,
  })
}
