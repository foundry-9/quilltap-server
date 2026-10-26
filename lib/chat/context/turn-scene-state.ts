/**
 * Turn phase: the `## Current State` section of the Commonplace Book whisper.
 *
 * Reads the chat's stored scene, corrects each character's clothing line
 * against the live wardrobe where it has drifted, and collapses any character
 * the recipient was already shown unchanged. The time line appears only when
 * the Host is announcing time this turn.
 *
 * The emission cache (`chats.commonplaceSceneCache`) keys per recipient — the
 * responding participant in a multi-character chat, `__public__` otherwise
 * (those whispers are untargeted). When a recipient sees the same character
 * with the same action and clothing twice running, the character's block
 * collapses to `### Name — _unchanged_`, so the whisper does not re-establish
 * hundreds of tokens of unchanged wardrobe prose every turn. The cache is
 * written only once the whisper carrying the section has been posted
 * (`commit`): a section nobody was shown must not mark itself seen.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/error-utils'
import { parseStoredSceneState, type SceneState } from '@/lib/schemas/chat.types'
import { hashEquippedSlots, hasEquippedItems } from '@/lib/wardrobe/outfit-hash'
import { describeEquippedOutfitTitleOnly } from '@/lib/wardrobe/resolve-equipped'
import { formatCurrentSceneState, type SceneStateEmissionEntry } from './scene-state'
import type { ChatMetadataBase, Provider } from '@/lib/schemas/types'

/** The cache key of an untargeted (single-character) recipient. */
const PUBLIC_RECIPIENT_KEY = '__public__'

type SceneCache = Record<string, Record<string, SceneStateEmissionEntry>>

export interface TurnSceneStateInput {
  chat: ChatMetadataBase
  provider: Provider
  /** The whisper scope: the responding participant, or null when untargeted. */
  targetParticipantId: string | null
  /** The Host's announced time, when time is announced this turn. */
  sceneTime: string | null
  /** The turn's project stores, for resolving wardrobe titles. */
  projectMountPointIds: () => Promise<string[]>
  warnings: string[]
}

export interface TurnSceneState {
  content: string
  tokens: number
  /** Record what this section showed its recipient. Never throws. */
  commit: () => Promise<void>
}

export async function buildTurnSceneState(input: TurnSceneStateInput): Promise<TurnSceneState> {
  const { chat } = input
  const cacheKey = input.targetParticipantId ?? PUBLIC_RECIPIENT_KEY
  const priorCache = (chat.commonplaceSceneCache ?? null) as SceneCache | null
  const empty: TurnSceneState = { content: '', tokens: 0, commit: async () => {} }

  try {
    const scene = parseStoredSceneState(chat.sceneState)
    const liveClothing = await liveClothingOverrides(chat.id, scene, input.projectMountPointIds)
    const formatted = formatCurrentSceneState(
      scene,
      input.sceneTime,
      input.provider,
      liveClothing,
      new Map(Object.entries(priorCache?.[cacheKey] ?? {})),
    )
    const emitted = formatted.emittedByCharacter
    return {
      content: formatted.content,
      tokens: formatted.tokenCount,
      commit: async () => {
        if (emitted.size === 0) return
        try {
          const nextCache: SceneCache = { ...(priorCache ?? {}), [cacheKey]: Object.fromEntries(emitted) }
          await getRepositories().chats.update(chat.id, { commonplaceSceneCache: nextCache })
        } catch (error) {
          // Benign: the next whisper re-emits in full and resets the cache.
          logger.warn('[CommonplaceWhisper] Failed to persist scene-state cache', {
            chatId: chat.id,
            targetKey: cacheKey,
            error: getErrorMessage(error),
          })
        }
      },
    }
  } catch (error) {
    input.warnings.push(`Failed to format current scene state: ${getErrorMessage(error)}`)
    return empty
  }
}

/**
 * Clothing lines that must override the scene's cached ones.
 *
 * The scene-state tracker keeps a concise clothing summary per character
 * (`c.clothing`), keyed by the equipped-outfit hash it was derived from
 * (`c.clothingHash`). It runs only at turn boundaries, so the summary can lag
 * a mid-turn wardrobe edit or `wardrobe_*` call. Where the live hash differs,
 * the override is a concise title-only description — never the verbose
 * per-item prose; where it matches, or nothing is equipped, the cached summary
 * stands.
 */
async function liveClothingOverrides(
  chatId: string,
  scene: SceneState | null,
  projectMountPointIds: () => Promise<string[]>,
): Promise<Map<string, string>> {
  const overrides = new Map<string, string>()
  if (!scene || scene.characters.length === 0) return overrides

  const repos = getRepositories()
  await Promise.all(scene.characters.map(async c => {
    if (!c.characterId) return
    try {
      const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, c.characterId)
      if (!equippedSlots || !hasEquippedItems(equippedSlots)) return
      if (hashEquippedSlots(equippedSlots) === (c.clothingHash ?? null)) return
      // Group stores follow each character's own memberships, so only the
      // project tier can come from the turn's pool.
      const description = await describeEquippedOutfitTitleOnly(
        repos,
        c.characterId,
        equippedSlots,
        await projectMountPointIds(),
      )
      if (description) overrides.set(c.characterId, description)
    } catch (error) {
      logger.warn('Failed to read live wardrobe for scene-state clothing override', {
        chatId,
        characterId: c.characterId,
        error: getErrorMessage(error),
      })
    }
  }))
  return overrides
}
