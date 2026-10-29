/**
 * Absent characters named in a chat, for the Salon's name chips.
 *
 * The Host used to post a card into the conversation the first time an absent
 * workspace character was named. The model now gets that card from the
 * referent ledger's trailing section instead, and the operator gets it from a
 * chip on the name, at its first mention in the chat, with the card in a hover
 * popup. This module answers the chip's two questions — which message first
 * names each absent character, and what their card says — from the same
 * matcher (`name-mentions.ts`) and the same card fields (`offSceneCardFields`)
 * the model's side uses, so what the operator reads is what the model was told.
 *
 * "Absent" is {@link presenceOf}: seated (not removed) characters are in the
 * room, and so is an unseated persona wherever the operator speaks without a
 * seat (in an autonomous room nobody speaks as them, so they are absent, bug
 * 172). The context builder's ledger asks the same function.
 */

import { logger } from '@/lib/logger'
import { buildNameMatcher, firstNameMatch } from '@/lib/chat/name-mentions'
import { stripToolArtifacts } from '@/lib/memory/cheap-llm-tasks'
import { offSceneCardFields, type OffSceneCardFields } from '@/lib/services/host-notifications/writer'
import { operatorSpeaksWithoutSeat } from '@/lib/schemas/chat.types'
import type { Character } from '@/lib/schemas/character.types'
import type { ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/chat.types'

const CONTEXT = 'chat.absent-mentions'

/** One chip: where an absent character is first named, and their card. */
export interface AbsentMention {
  messageId: string
  characterId: string
  /** The name or alias exactly as it first appears in that message. */
  text: string
  card: OffSceneCardFields
}

/** The characters a mention scan may name. */
export type MentionCandidate = Pick<
  Character,
  'id' | 'name' | 'aliases' | 'pronouns' | 'identity' | 'description'
>

/**
 * Who is in the room. Seated (not removed) characters always; an unseated
 * persona, matched by name, only where the operator speaks without a seat.
 */
export function presenceOf(input: {
  participants: ReadonlyArray<ChatParticipantBase> | null | undefined
  chatType: ChatMetadataBase['chatType']
  personaName?: string | null
}): (c: Pick<Character, 'id' | 'name'>) => boolean {
  const seated = new Set(
    (input.participants ?? [])
      .filter(p => p.status !== 'removed' && p.characterId)
      .map(p => p.characterId as string),
  )
  const persona = operatorSpeaksWithoutSeat(input.chatType)
    ? input.personaName?.trim().toLowerCase()
    : undefined
  return c => seated.has(c.id) || (!!persona && c.name.trim().toLowerCase() === persona)
}

/** A line someone actually said: no Staff message, no tool chatter. */
export function spokenText(m: {
  type?: string
  role?: string
  content?: string
  systemSender?: string | null
}): string | null {
  if (m.type !== undefined && m.type !== 'message') return null
  if (m.systemSender || !m.content) return null
  const role = (m.role || '').toUpperCase()
  if (role === 'USER') return m.content
  if (role === 'ASSISTANT') return stripToolArtifacts(m.content) || null
  return null
}

/**
 * The first mention of each absent candidate, in message order. Pure: the
 * caller supplies the messages (oldest first), the candidates and presence.
 */
export function findAbsentMentions(input: {
  messages: ReadonlyArray<{ id?: string; type?: string; role?: string; content?: string; systemSender?: string | null }>
  candidates: ReadonlyArray<MentionCandidate>
  isInRoom: (c: MentionCandidate) => boolean
  userCharacterName?: string | null
}): AbsentMention[] {
  const pending = input.candidates
    .filter(c => !input.isInRoom(c))
    .map(c => ({ character: c, matcher: buildNameMatcher([c.name, ...(c.aliases ?? [])]) }))
    .filter((entry): entry is { character: MentionCandidate; matcher: RegExp } => !!entry.matcher)

  const found: AbsentMention[] = []
  for (const m of input.messages) {
    if (pending.length === 0) break
    if (!m.id) continue
    const text = spokenText(m)
    if (!text) continue
    for (let i = pending.length - 1; i >= 0; i--) {
      const hit = firstNameMatch(text, pending[i].matcher)
      if (!hit) continue
      const c = pending[i].character
      found.push({
        messageId: m.id,
        characterId: c.id,
        text: hit.text,
        card: offSceneCardFields(
          {
            id: c.id,
            name: c.name,
            aliases: c.aliases ?? undefined,
            pronouns: c.pronouns ?? undefined,
            identity: c.identity ?? undefined,
            description: c.description ?? undefined,
          },
          input.userCharacterName,
        ),
      })
      pending.splice(i, 1)
    }
  }

  logger.debug('[AbsentMentions] Scanned chat for absent characters', {
    context: CONTEXT,
    messages: input.messages.length,
    candidates: input.candidates.length,
    found: found.length,
  })
  return found
}
