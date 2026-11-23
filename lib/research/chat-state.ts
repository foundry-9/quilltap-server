/**
 * The research kit's `lookup_chat_state`: a conversation's live state, read
 * from the records the turn itself reads — never from the transcript.
 *
 * Per seat: who it is and whether they are present, what they carry
 * (`loadEquippedSet`, the same read as the "Carried and equipped" section),
 * what they wear (`describeEquippedOutfitTitleOnly`, the same read as the
 * scene tracker's baseline), and the scene tracker's Action, labelled as told.
 * Then the location and the Concierge's posture.
 *
 * This exists because "what is she carrying right now" was answered from the
 * object's own file (`equippedByDefault`, an arrival default) instead of the
 * chat's equipped set, and said "nothing" while the character still held it.
 * An object file never says whether it is carried in a given chat.
 *
 * Operator surface only (`OPERATOR_SURFACE_ONLY_TOOLS`). With no
 * `conversation`, the chat the call was made from — the Salon a `@Brahma`
 * question was asked in.
 *
 * @module lib/research/chat-state
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata } from '@/lib/schemas/types'
import { isParticipantPresent, parseStoredSceneState } from '@/lib/schemas/chat.types'
import { resolveSpeakerNames } from '@/lib/chat/speaker-names'
import { resolveProjectMountPointIds } from '@/lib/mount-index/reach'
import { loadEquippedSet } from '@/lib/inventory/equipped-set'
import { inventoryDisplayName } from '@/lib/inventory/resolve'
import { describeEquippedOutfitTitleOnly } from '@/lib/wardrobe/resolve-equipped'
import { getConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { CONVERSATION_CHAT_TYPES, resolveConversationRef } from './conversations'
import type { ResearchOutcome } from './documents'
import { clipLine, joinUnderCeiling } from './text'

const logger = createServiceLogger('ResearchChatState')

export interface LookupChatStateQuery {
  conversation?: string
}

export interface LookupChatStateContext {
  userId: string
  /** The chat the call was made from; the default conversation. */
  chatId?: string
}

/** Which conversation: the named one, else the one the call came from. */
async function targetConversation(
  q: LookupChatStateQuery,
  ctx: LookupChatStateContext,
): Promise<ChatMetadata | { error: string }> {
  const ref = q.conversation?.trim()
  if (ref) {
    const found = await resolveConversationRef(ref)
    if (!found) return { error: `No conversation matches "${ref}". Find it with lookup_conversations.` }
    if ('ambiguous' in found) {
      return { error: `"${ref}" matches more than one conversation: ${found.ambiguous.map((c) => `"${c.title}" (${c.id})`).join(', ')}. Pass the id.` }
    }
    return found
  }
  const here = ctx.chatId ? await getRepositories().chats.findById(ctx.chatId).catch(() => null) : null
  if (here && CONVERSATION_CHAT_TYPES.has(here.chatType ?? 'salon')) return here
  return { error: 'This was not asked from inside a conversation; pass `conversation` (an id or exact title — lookup_conversations finds one).' }
}

/** One seat's block. Each read fails alone: a broken wardrobe never costs the carried list. */
async function seatBlock(
  chat: ChatMetadata,
  participant: ChatMetadata['participants'][number],
  name: string,
  projectMountPointIds: string[],
  sceneAction: string | undefined,
): Promise<string> {
  const repos = getRepositories()
  const present = isParticipantPresent(participant.status)
  const role = participant.controlledBy === 'user' ? 'played by the operator' : 'played by a model'
  const lines = [`- ${name} (${participant.type.toLowerCase()}, ${role}; ${present ? participant.status : `not present: ${participant.status}`})`]

  try {
    const carried = await loadEquippedSet(repos, chat, participant.characterId)
    lines.push(
      carried.length === 0
        ? '  Carrying (equipped in this chat): nothing'
        : `  Carrying (equipped in this chat): ${carried.map((item) => `${item.emoji ? `${item.emoji} ` : ''}${inventoryDisplayName(item)} [${item.id}]`).join('; ')}`,
    )
  } catch (error) {
    lines.push(`  Carrying: could not be read (${error instanceof Error ? error.message : String(error)})`)
  }

  try {
    const slots = await repos.chats.getEquippedOutfitForCharacter(chat.id, participant.characterId)
    const worn = slots ? (await describeEquippedOutfitTitleOnly(repos, participant.characterId, slots, projectMountPointIds)).trim() : ''
    lines.push(`  Wearing (equipped in this chat): ${worn || 'nothing recorded'}`)
  } catch (error) {
    lines.push(`  Wearing: could not be read (${error instanceof Error ? error.message : String(error)})`)
  }

  if (sceneAction?.trim()) {
    lines.push(`  Action, as the story tells it (the scene tracker's note, not a record): ${clipLine(sceneAction.replace(/\s+/g, ' ').trim(), 400)}`)
  }
  return lines.join('\n')
}

export async function lookupChatState(
  q: LookupChatStateQuery,
  ctx: LookupChatStateContext,
): Promise<ResearchOutcome<{ seats: number }>> {
  const chat = await targetConversation(q, ctx)
  if ('error' in chat) return { ok: false, error: chat.error }

  const names = await resolveSpeakerNames(chat)
  const projectMountPointIds = await resolveProjectMountPointIds(chat.projectId ?? null)
  const scene = parseStoredSceneState(chat.sceneState)
  const actionByCharacter = new Map((scene?.characters ?? []).map((c) => [c.characterId, c.action ?? '']))

  // Present seats first, then the rest, each in display order.
  const seats = chat.participants
    .filter((p) => !!p.characterId)
    .sort((a, b) =>
      Number(isParticipantPresent(b.status)) - Number(isParticipantPresent(a.status)) || (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
    )
  const blocks: string[] = []
  for (const p of seats) {
    blocks.push(await seatBlock(chat, p, names.get(p.id) ?? 'Unnamed character', projectMountPointIds, actionByCharacter.get(p.characterId)))
  }

  const head = [
    `Live state of "${chat.title || 'Untitled'}" (${chat.id}), read from the chat's records now.`,
    `Location (scene tracker): ${scene?.location?.trim() || '(not tracked yet)'}`,
    `Concierge: ${getConciergeState(chat)}`,
    `What a person carries or wears is the chat's equipped record; an object's own file (equippedByDefault) only says what they take up on arrival.`,
    '',
    `${seats.length} seat${seats.length === 1 ? '' : 's'}:`,
  ].join('\n')

  logger.debug('lookup_chat_state: read', {
    chatId: chat.id,
    fromCall: !q.conversation,
    seats: seats.length,
    sceneTracked: !!scene,
  })
  return {
    ok: true,
    text: joinUnderCeiling(head, blocks, {
      separator: '\n',
      omittedHint: (n) => `[${n} more seats left out for length.]`,
    }),
    data: { seats: seats.length },
  }
}
