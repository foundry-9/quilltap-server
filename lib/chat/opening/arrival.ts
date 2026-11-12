/**
 * One arrival — how a seat comes into a chat.
 *
 * Every door a character walks through — a chat's opening (`'chat-start'`), a
 * seat added or brought back mid-chat (`'participant-added'`), a merge
 * (`'merge'`) — runs the same sequence in the same order:
 *
 *   outfit → inventory → identity stack → Host add announcement → Aurora's
 *   opening-outfit whisper → avatar refresh
 *
 * and decides the outfit mode for a seat the caller sent none for by one rule,
 * {@link defaultOutfitMode}. This module is the only caller of
 * `applyOutfitSelections` and `applyInventoryDefaults` outside their own
 * modules (a grep-test holds it).
 *
 * Several seats arriving together (a chat's whole cast) go through
 * {@link seatArrivals}, which keeps the outfit applier's two-phase shape —
 * every seat's outfit resolved concurrently, committed serially, because the
 * slot write is a read-modify-write of one JSON column — and then walks the
 * remaining steps one step at a time across the cast, so the staff rows of a
 * new chat land in the order they always have (every Host welcome, then every
 * Aurora whisper).
 *
 * The narrator is optional and silent when absent: a join narrates when the
 * operator is watching and says nothing for a script. Every step fails soft —
 * nothing here may keep a character out of a chat.
 *
 * Server-only.
 *
 * Design of record: docs/developer/features/complete/refactor-green-room-and-opening.md (D4)
 *
 * @module chat/opening/arrival
 */

import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { Character, ChatMetadataBase, ChatParticipantBase } from '@/lib/schemas/types'
import {
  allEquippedItemIds,
  type OutfitSelection,
  type OutfitSelectionMode,
} from '@/lib/schemas/wardrobe.types'
import { applyOutfitSelections } from '@/lib/wardrobe/apply-outfit-selections'
import { applyInventoryDefaults } from '@/lib/inventory/apply-defaults'
import { buildCheapLLMConfig } from '@/lib/llm/cheap-llm'
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool'
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler'
import { postHostAddAnnouncement } from '@/lib/services/host-notifications/writer'
import { postOpeningOutfitWhisper } from '@/lib/services/aurora-notifications/writer'
import { refreshAvatarForOutfit } from '@/lib/wardrobe/outfit-change-effects'
import { loadWearablePool } from '@/lib/wardrobe/pool'
import { buildOutfitSlotValues } from '@/lib/wardrobe/outfit-description'
import type { GreenRoomNarrator } from './narrator'

/** Which door a seat came through — also the wear ledger's `source`. */
export type ArrivalSource = 'chat-start' | 'participant-added' | 'merge'

/** The facts the default outfit rule reads about a seat. */
export interface OutfitModeSeat {
  /** The character lets the Green Room dress them (`Character.canChooseOutfit`). */
  canChooseOutfit?: boolean | null
  /** The seat is the operator's own (a user-controlled character). */
  userControlled: boolean
  /** The source chat (a continuation's or a merge's) has an outfit on file for this character. */
  sourceHasOutfit: boolean
}

/**
 * The outfit mode a seat arrives in when nobody said otherwise — the one rule,
 * for every door and every client:
 *
 *   - `previous_chat` when a source chat has an outfit for the character (a
 *     continuation, a merge);
 *   - else `llm_choose` when the character is LLM-controlled and may choose
 *     their own outfit (`canChooseOutfit`);
 *   - else `default`.
 *
 * Pure; the New Chat dialog shows it through `?action=casting-defaults`.
 */
export function defaultOutfitMode(seat: OutfitModeSeat): OutfitSelectionMode {
  if (seat.sourceHasOutfit) return 'previous_chat'
  if (!seat.userControlled && seat.canChooseOutfit) return 'llm_choose'
  return 'default'
}

/** Whether `chat` has an outfit entry on file for `characterId`. */
export function chatHasOutfitFor(chat: Pick<ChatMetadataBase, 'equippedOutfit'> | null | undefined, characterId: string): boolean {
  const outfit = chat?.equippedOutfit as Record<string, unknown> | null | undefined
  return !!outfit && typeof outfit === 'object' && characterId in outfit && outfit[characterId] != null
}

/** One arriving seat. */
export interface ArrivingSeat {
  characterId: string
  /** What the operator chose; absent → {@link defaultOutfitMode}. */
  outfitSelection?: OutfitSelection
  /**
   * Re-dress the seat even when it already has an outfit on file. False for a
   * returning seat the caller sent nothing for (it keeps what it had on), and
   * for an opening being resumed (a seat dressed before the break stays dressed).
   */
  redress?: boolean
}

export interface SeatArrivalOptions {
  source: ArrivalSource
  userId: string
  /** A continuation's or a merge's source chat. */
  sourceChatId?: string | null
  /** The Green Room's narrator; silent when absent. */
  narrator?: GreenRoomNarrator
  /**
   * Post the Host's welcome. Defaults to: always for a join or a merge; at a
   * chat's opening, only when the room holds more than one LLM seat (the
   * others need to learn about each other; a lone character needs no
   * introduction to itself).
   */
  announceHostAdd?: boolean
}

/** One seat in through the door. */
export async function seatArrival(
  repos: RepositoryContainer,
  chatId: string,
  seat: ArrivingSeat,
  options: SeatArrivalOptions,
): Promise<void> {
  await seatArrivals(repos, chatId, [seat], options)
}

/** Several seats in through the same door, together. */
export async function seatArrivals(
  repos: RepositoryContainer,
  chatId: string,
  seats: readonly ArrivingSeat[],
  options: SeatArrivalOptions,
): Promise<void> {
  if (seats.length === 0) return
  const chat = await repos.chats.findById(chatId)
  if (!chat) {
    logger.warn('[SeatArrival] No such chat; nobody arrives', { chatId, source: options.source })
    return
  }
  const { narrator } = options
  const sourceChat = options.sourceChatId ? await repos.chats.findById(options.sourceChatId) : null
  const chatSettings = await repos.chatSettings.findByUserId(options.userId)
  const cheapLLMConfig = buildCheapLLMConfig(chatSettings)
  const projectMountPointIds = await resolveProjectMountPointIds(chat.projectId ?? null)

  const arrivals = await Promise.all(seats.map(async (seat) => {
    const participant = presentSeatFor(chat, seat.characterId)
    const character = await repos.characters.findById(seat.characterId).catch(() => null)
    return { seat, participant, character }
  }))

  // 1. Outfit. A seat already dressed keeps its outfit unless the caller asked
  // for a change — a returning seat, or an opening resumed after a break.
  const selections: OutfitSelection[] = []
  for (const { seat, participant, character } of arrivals) {
    if (!seat.redress && chatHasOutfitFor(chat, seat.characterId)) {
      logger.debug('[SeatArrival] Seat already dressed; outfit left as it is', {
        chatId, characterId: seat.characterId, source: options.source,
      })
      continue
    }
    const selection = seat.outfitSelection ?? {
      characterId: seat.characterId,
      mode: defaultOutfitMode({
        canChooseOutfit: character?.canChooseOutfit,
        userControlled: participant?.controlledBy === 'user',
        sourceHasOutfit: chatHasOutfitFor(sourceChat, seat.characterId),
      }),
    }
    selections.push(selection)
  }
  logger.debug('[SeatArrival] Dressing the arriving seats', {
    chatId,
    source: options.source,
    modes: selections.map((s) => ({ characterId: s.characterId, mode: s.mode, chosen: seats.some((x) => x.characterId === s.characterId && !!x.outfitSelection) })),
  })
  if (selections.length > 0) {
    narrator?.status('Consulting the wardrobe…')
    try {
      await applyOutfitSelections(chatId, selections, repos, {
        userId: options.userId,
        projectMountPointIds,
        scenarioText: chat.scenarioText ?? null,
        cheapLLMConfig,
        sourceChatId: options.sourceChatId ?? null,
        narrator,
        source: options.source,
      })
    } catch (error) {
      logger.error('[SeatArrival] Failed to apply outfits', { chatId, source: options.source, error: getErrorMessage(error) })
    }
  }

  // 2. Inventory. A character left to choose their outfit chooses what they
  // carry too; a seat with an entry already is never revisited.
  await applyInventoryDefaults(repos, chatId, arrivals.map((a) => a.seat.characterId), {
    source: options.source,
    userId: options.userId,
    sourceChatId: options.sourceChatId ?? null,
    choose: {
      characterIds: selections.filter((s) => s.mode === 'llm_choose').map((s) => s.characterId),
      scenarioText: chat.scenarioText ?? null,
      cheapLLMConfig,
      narrator,
    },
  })

  // 3. Identity stacks — one seat at a time, each against a fresh read, since
  // the compiler merges into the chat's stored map.
  for (const { participant } of arrivals) {
    if (!participant) continue
    try {
      const fresh = await repos.chats.findById(chatId)
      if (fresh) await compileIdentityStackForParticipant(fresh, participant.id)
    } catch (error) {
      logger.warn('[SeatArrival] Failed to compile identity stack', { chatId, participantId: participant.id, error: getErrorMessage(error) })
    }
  }

  // 4. The Host's welcome.
  const llmSeats = chat.participants.filter(
    (p) => p.type === 'CHARACTER' && p.status !== 'removed' && p.controlledBy !== 'user' && p.characterId,
  )
  const announce = options.announceHostAdd ?? (options.source !== 'chat-start' || llmSeats.length > 1)
  if (announce) {
    for (const { participant, character } of arrivals) {
      if (!participant || !character) continue
      // At a chat's opening the Host introduces the LLM cast to one another;
      // the operator's own character has its own introduction.
      if (options.source === 'chat-start' && participant.controlledBy === 'user') continue
      await postHostAddAnnouncement({
        chatId,
        character,
        participantId: participant.id,
        initialStatus: participant.status,
      })
    }
  }

  // 5. Aurora says what everyone arrived in, and 6. the avatar catches up with
  // it (gated by `refreshAvatarForOutfit` on the chat's avatar setting; skipped
  // for autonomous rooms).
  for (const { seat, character } of arrivals) {
    if (!character) continue
    await announceOpeningOutfit(repos, chat, character, projectMountPointIds)
    try {
      await refreshAvatarForOutfit(repos, { userId: options.userId, chatId, characterId: seat.characterId }, `[SeatArrival] ${options.source}`)
    } catch (error) {
      logger.warn('[SeatArrival] Failed to request avatar refresh', { chatId, characterId: seat.characterId, error: getErrorMessage(error) })
    }
  }
}

/** The character's present (or returning) seat in `chat`, if any. */
function presentSeatFor(chat: ChatMetadataBase, characterId: string): ChatParticipantBase | undefined {
  return chat.participants.find(
    (p) => p.type === 'CHARACTER' && p.characterId === characterId && p.status !== 'removed',
  )
}

/** Aurora's opening-outfit whisper for one character. Never throws. */
async function announceOpeningOutfit(
  repos: RepositoryContainer,
  chat: ChatMetadataBase,
  character: Character,
  projectMountPointIds: string[],
): Promise<void> {
  try {
    const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chat.id, character.id)
    if (!equippedSlots) return

    const equippedItemIds = allEquippedItemIds(equippedSlots).filter((id) => typeof id === 'string' && id.length > 0)
    const pool = equippedItemIds.length > 0
      ? await loadWearablePool(repos, character.id, projectMountPointIds)
      : null
    const equippedItemsMap = new Map(pool ? pool.getMany(equippedItemIds).map((item) => [item.id, item]) : [])
    const titlesFor = (slot: keyof typeof equippedSlots): string[] => {
      const ids = equippedSlots[slot]
      if (!ids || ids.length === 0) return []
      const titles: string[] = []
      for (const id of ids) {
        const title = equippedItemsMap.get(id)?.title
        if (title) titles.push(title)
      }
      return titles
    }

    await postOpeningOutfitWhisper({
      chatId: chat.id,
      characterName: character.name,
      outfit: buildOutfitSlotValues((slot) => titlesFor(slot)),
    })
  } catch (error) {
    logger.warn('[SeatArrival] Failed to post the opening-outfit whisper', {
      chatId: chat.id,
      characterId: character.id,
      error: getErrorMessage(error),
    })
  }
}
