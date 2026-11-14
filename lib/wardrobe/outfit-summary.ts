/**
 * A chat's equipped outfits as titles — per character, per slot, composites
 * expanded and each leaf routed into every slot its own `types` cover (the
 * canonical rule, `resolveEquippedOutfitForCharacter`). Each character's slots
 * resolve against their own wearable pool; the project and General tiers are
 * read once for the cast.
 *
 * Read by `GET /api/v1/chats/[id]?action=outfit-summary` and by the casting
 * defaults, which show a continuation's previous outfits.
 *
 * Server-only.
 *
 * @module wardrobe/outfit-summary
 */

import { logger } from '@/lib/logger'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import { bySlot, type WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { loadCastPools } from '@/lib/wardrobe/pool'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'

export type OutfitSummaryEntry = { itemId: string; title: string }
export type OutfitSummary = Record<string, Record<WardrobeItemType, OutfitSummaryEntry[]>>

/** The summary for one chat, or null when the chat does not exist. */
export async function buildOutfitSummary(
  repos: RepositoryContainer,
  chatId: string,
): Promise<OutfitSummary | null> {
  const chat = await repos.chats.findById(chatId)
  if (!chat) return null

  const equippedOutfit = (await repos.chats.getEquippedOutfit(chatId)) ?? {}
  const characterIds = Object.keys(equippedOutfit)
  const pools = await loadCastPools(repos, chat.projectId, characterIds)

  const summary: OutfitSummary = {}
  for (const [characterId, slots] of Object.entries(equippedOutfit)) {
    const pool = pools.get(characterId)
    if (!slots || !pool) {
      summary[characterId] = bySlot<OutfitSummaryEntry[]>(() => [])
      continue
    }
    const { leafItemsBySlot } = resolveEquippedOutfitForCharacter(pool, slots)
    summary[characterId] = bySlot((slot) =>
      leafItemsBySlot[slot].map((leaf) => ({ itemId: leaf.id, title: leaf.title })),
    )
  }

  logger.debug('[OutfitSummary] Built outfit summary', {
    chatId,
    characterCount: characterIds.length,
    context: 'wardrobe',
  })
  return summary
}
