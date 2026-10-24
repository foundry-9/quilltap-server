/**
 * Context-Aware Character Appearance Resolution
 *
 * Orchestrates the resolution of character appearances for image generation
 * by analyzing chat context to determine what each character currently looks
 * like and is wearing. Integrates with the Concierge for safety sanitization.
 *
 * @module image-gen/appearance-resolution
 */

import type { PhysicalDescription } from '@/lib/schemas/types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ResolvedConciergePolicy } from '@/lib/services/dangerous-content/resolver.service'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { describeOutfit, buildOutfitSlotValues } from '@/lib/wardrobe/outfit-description'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import { loadWearablePool } from '@/lib/wardrobe/pool'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import {
  resolveAppearance,
  sanitizeAppearance,
  type ChatMessage,
  type CharacterAppearanceInput,
  type AppearanceResolutionItem,
  type AppearanceSanitizeMode,
} from '@/lib/memory/cheap-llm-tasks'
import {
  classifyContent,
} from '@/lib/services/dangerous-content/gatekeeper.service'
import { logger } from '@/lib/logger'
import {
  isHumanoid,
  NON_HUMANOID_IMAGE_DIRECTION,
  pickPhysicalDescription,
} from '@/lib/characters/physical-description'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of the appearance resolution pipeline, indicating whether the LLM
 * successfully resolved appearances or fell back to defaults
 */
export interface AppearanceResolutionResult {
  appearances: ResolvedCharacterAppearance[]
  /** Whether the LLM successfully resolved appearances (false = used defaults due to failure/content refusal) */
  llmResolved: boolean
}

/**
 * A fully resolved character appearance ready for image generation
 */
export interface ResolvedCharacterAppearance {
  characterId: string
  characterName: string
  /** Selected physical description text */
  physicalDescription: string
  /** The selected physical description's name (for logging) */
  physicalDescriptionName: string
  /**
   * False when the character has no humanoid body (`isHumanoid` on its
   * physical description). {@link sceneDescriptionParts} then drops the
   * gender prefix and adds the non-humanoid direction. Absent means true.
   */
  humanoid?: boolean
  /** What the character is currently wearing */
  clothingDescription: string
  /** How clothing was determined */
  clothingSource: 'narrative' | 'stored' | 'default'
  /**
   * What the character carries in the chat (the Inventory's equipped objects'
   * `imageDescription`s, e.g. "carrying a longsword with a jewelled pommel"),
   * or '' — set by {@link resolveCharacterAppearances} whatever path resolved
   * the rest, and rendered beside the outfit.
   */
  carryingDescription?: string
  /** Whether the Concierge sanitized this appearance */
  wasSanitized: boolean
  /**
   * Set by a `conceal`-mode sanitization when the character is undressed in
   * the scene: the prompt crafter must drape them, never dress them.
   */
  needsConcealment?: boolean
}

/**
 * Input for the appearance resolution pipeline
 */
export interface AppearanceResolutionInput {
  characterId: string
  characterName: string
  physicalDescription: PhysicalDescription | null
  /** Equipped wardrobe items (from the wardrobe system) */
  equippedWardrobeItems?: Array<{
    slot: string
    title: string
    description?: string | null
    /** Plain-text image cue; preferred over `title` in image prompts. */
    imagePrompt?: string | null
  }>
}

/** Repository surface for {@link equippedWardrobeItemsForAppearance}. */
type EquippedWardrobeRepos = Pick<RepositoryContainer, 'wardrobe' | 'projects' | 'chats'>

/**
 * Load a character's equipped outfit for a chat and flatten it into the
 * `equippedWardrobeItems` shape of {@link AppearanceResolutionInput}.
 *
 * Equipped slots are arrays-per-slot and may contain composite items;
 * `resolveEquippedOutfitForCharacter` expands composites and returns per-slot
 * leaf items. Returns `undefined` when the character has nothing equipped.
 * Errors propagate — callers own their catch-and-log.
 */
export async function equippedWardrobeItemsForAppearance(
  repos: EquippedWardrobeRepos,
  chatId: string,
  characterId: string,
  projectMountPointIds: string[] | undefined,
): Promise<AppearanceResolutionInput['equippedWardrobeItems']> {
  const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId)
  if (!equippedSlots) return undefined
  const resolved = resolveEquippedOutfitForCharacter(
    await loadWearablePool(repos, characterId, projectMountPointIds),
    equippedSlots,
  )
  const flat: Array<{ slot: string; title: string; description?: string | null; imagePrompt?: string | null }> = []
  for (const slot of WARDROBE_SLOT_TYPES) {
    for (const item of resolved.leafItemsBySlot[slot]) {
      flat.push({ slot, title: item.title, description: item.description, imagePrompt: item.imagePrompt })
    }
  }
  return flat.length > 0 ? flat : undefined
}

// ============================================================================
// APPEARANCE RESOLUTION
// ============================================================================

/**
 * Check whether we can skip the LLM call and use defaults directly.
 *
 * Skip when ALL characters have exactly 1 physical description, 0-1 clothing
 * records, AND there is no chat context to analyze.
 */
function canSkipResolution(
  characters: AppearanceResolutionInput[],
  recentMessages: ChatMessage[]
): boolean {
  if (recentMessages.length > 0) return false

  return characters.every(
    c => (!c.equippedWardrobeItems || c.equippedWardrobeItems.length <= 1)
  )
}

/**
 * Convert an array of equipped wardrobe items into OutfitSlotValues for use
 * with the canonical describeOutfit utility. The input is expected to already
 * be flattened to leaves (callers expand composites before passing in).
 *
 * Multiple entries with the same `slot` represent layering and produce
 * multiple values in that slot's array, in the order they appear.
 *
 * Titles only — image-gen prompts must not carry the prose `description`
 * field, which is written for human eyes and otherwise bloats the prompt.
 */
function wardrobeItemsToSlotValues(
  items: Array<{ slot: string; title: string; description?: string | null; imagePrompt?: string | null }>
): import('@/lib/wardrobe/outfit-description').OutfitSlotValues {
  return buildOutfitSlotValues((slot) =>
    items
      .filter(i => i.slot === slot)
      .map(i => (i.imagePrompt?.trim() ? i.imagePrompt.trim() : i.title)),
  )
}

/**
 * Build default resolved appearances without an LLM call
 */
function buildDefaultAppearances(
  characters: AppearanceResolutionInput[]
): ResolvedCharacterAppearance[] {
  return characters.map(char => {
    const primary = char.physicalDescription

    const physDesc = pickPhysicalDescription(primary, 'full-length') || char.characterName

    const hasWardrobe = char.equippedWardrobeItems && char.equippedWardrobeItems.length > 0

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      physicalDescription: physDesc,
      physicalDescriptionName: primary?.name || 'default',
      ...(isHumanoid(primary) ? {} : { humanoid: false }),
      clothingDescription: hasWardrobe
        ? describeOutfit(wardrobeItemsToSlotValues(char.equippedWardrobeItems!))
        : '',
      clothingSource: hasWardrobe
        ? 'stored' as const
        : 'default' as const,
      wasSanitized: false,
    }
  })
}

/**
 * Convert an LLM resolution result back into full ResolvedCharacterAppearance
 * objects by matching IDs against the original character data.
 */
function mapResolutionResults(
  characters: AppearanceResolutionInput[],
  items: AppearanceResolutionItem[]
): ResolvedCharacterAppearance[] {
  return characters.map(char => {
    const resolved = items.find(i => i.characterId === char.characterId)

    // Only one physical description per character now; the resolver's
    // selectedDescriptionId is informational only.
    const selectedDesc: PhysicalDescription | null = char.physicalDescription

    const physDesc = pickPhysicalDescription(selectedDesc, 'full-length') || char.characterName

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      physicalDescription: physDesc,
      physicalDescriptionName: selectedDesc?.name || 'default',
      ...(isHumanoid(selectedDesc) ? {} : { humanoid: false }),
      clothingDescription: resolved?.clothingDescription || '',
      clothingSource: resolved?.clothingSource || 'default',
      wasSanitized: false,
    }
  })
}

/**
 * Resolve character appearances based on chat context.
 *
 * Analyzes recent chat messages and the image prompt to determine the best
 * physical description and current clothing for each character. Falls back
 * to defaults if the LLM call fails or is unnecessary.
 *
 * @param characters - Characters with available descriptions and clothing
 * @param recentMessages - Recent chat messages for narrative context
 * @param imagePrompt - The image prompt being generated
 * @param cheapLLMSelection - The cheap LLM provider to use
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for logging
 * @param sceneState - Optional scene state with appearance data (avoids redundant LLM call)
 * @returns Resolution result with appearances and whether the LLM succeeded
 */
export async function resolveCharacterAppearances(
  characters: AppearanceResolutionInput[],
  recentMessages: ChatMessage[],
  imagePrompt: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  sceneState?: { characters: Array<{ characterId: string; characterName: string; appearance: string | null; clothing: string | null }> } | null
): Promise<AppearanceResolutionResult> {
  const result = await resolveAppearancesWithoutInventory(
    characters, recentMessages, imagePrompt, cheapLLMSelection, userId, chatId, sceneState,
  )
  if (!chatId || result.appearances.length === 0) return result
  return { ...result, appearances: await withCarrying(result.appearances, chatId) }
}

/**
 * Add what each character carries in the chat (the Inventory) to its
 * resolved appearance. The one place the image pipelines learn of it; fails
 * soft to the appearances as they were.
 */
async function withCarrying(
  appearances: ResolvedCharacterAppearance[],
  chatId: string,
): Promise<ResolvedCharacterAppearance[]> {
  try {
    const { getRepositories } = await import('@/lib/repositories/factory')
    const { loadCarryingPhrase } = await import('@/lib/inventory/image-description')
    const repos = getRepositories()
    const chat = await repos.chats.findById(chatId)
    if (!chat) return appearances
    return await Promise.all(appearances.map(async (appearance) => {
      const carrying = await loadCarryingPhrase(repos, chat, appearance.characterId)
      return carrying ? { ...appearance, carryingDescription: carrying } : appearance
    }))
  } catch (error) {
    logger.warn('[AppearanceResolution] Could not add carried objects to appearances', {
      context: 'image-gen.appearance-resolution',
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return appearances
  }
}

async function resolveAppearancesWithoutInventory(
  characters: AppearanceResolutionInput[],
  recentMessages: ChatMessage[],
  imagePrompt: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  sceneState?: { characters: Array<{ characterId: string; characterName: string; appearance: string | null; clothing: string | null }> } | null
): Promise<AppearanceResolutionResult> {
  if (characters.length === 0) {
    return { appearances: [], llmResolved: true }
  }

  // Shortcut: use scene state appearances if provided (avoids redundant LLM call)
  if (sceneState?.characters && sceneState.characters.length > 0) {
    const sceneAppearances: ResolvedCharacterAppearance[] = characters.map(char => {
      const sceneChar = sceneState.characters.find(sc => sc.characterId === char.characterId)
      const primary = char.physicalDescription
      const physDesc = sceneChar?.appearance
        || pickPhysicalDescription(primary, 'full-length')
        || char.characterName

      return {
        characterId: char.characterId,
        characterName: char.characterName,
        physicalDescription: physDesc,
        physicalDescriptionName: primary?.name || 'scene-state',
        ...(isHumanoid(primary) ? {} : { humanoid: false }),
        // If scene state has clothing info, use it. If clothing is explicitly null/empty
        // (e.g. character undressed), do NOT fall back — that would incorrectly redress.
        // If the character wasn't found in scene state at all, leave clothing empty.
        clothingDescription: sceneChar
          ? (sceneChar.clothing || '')
          : '',
        clothingSource: sceneChar ? 'narrative' as const : 'default' as const,
        wasSanitized: false,
      }
    })

    logger.info('[AppearanceResolution] Using scene state for character appearances', {
      context: 'image-gen.appearance-resolution',
      chatId,
      characterCount: sceneAppearances.length,
    })

    return { appearances: sceneAppearances, llmResolved: true }
  }

  // Skip optimization: no LLM call needed when context is trivial
  if (canSkipResolution(characters, recentMessages)) {
    return { appearances: buildDefaultAppearances(characters), llmResolved: true }
  }

  // Build the LLM input
  const llmInput: CharacterAppearanceInput[] = characters.map(char => ({
    characterId: char.characterId,
    characterName: char.characterName,
    physicalDescriptions: char.physicalDescription
      ? [{
          id: char.physicalDescription.id,
          name: char.physicalDescription.name,
          usageContext: char.physicalDescription.usageContext,
          shortPrompt: char.physicalDescription.shortPrompt,
          mediumPrompt: char.physicalDescription.mediumPrompt,
        }]
      : [],
    ...(char.equippedWardrobeItems && char.equippedWardrobeItems.length > 0
      ? { equippedWardrobeItems: char.equippedWardrobeItems }
      : {}),
  }))

  const result = await resolveAppearance(
    llmInput,
    recentMessages,
    imagePrompt,
    cheapLLMSelection,
    userId,
    chatId
  )

  if (!result.success || !result.result || result.result.length === 0) {
    logger.warn('[AppearanceResolution] LLM resolution failed or returned empty, falling back to defaults', {
      context: 'image-gen.appearance-resolution',
      error: result.error,
      emptyResult: result.success && (!result.result || result.result.length === 0),
      chatId,
    })
    return { appearances: buildDefaultAppearances(characters), llmResolved: false }
  }

  const resolved = mapResolutionResults(characters, result.result)

  return { appearances: resolved, llmResolved: true }
}

// ============================================================================
// CONCIERGE APPEARANCE SANITIZATION
// ============================================================================

/**
 * Sanitize resolved appearances through the Concierge if needed.
 *
 * Cleaning exists for one case only: a Moderated chat whose image is bound for
 * a moderated provider. Everywhere else the text goes through as written.
 *
 * Logic:
 * 1. The image is bound for an uncensored profile → return unchanged, whatever
 *    the chat's state. That provider accepts it, so accuracy beats a draped
 *    sheet, and no classifier call is spent finding that out.
 * 2. Unless the policy pre-screens (Moderated, on duty, pre-screen opted in) →
 *    return unchanged. An Unmoderated chat bound for a moderated provider is
 *    sent as written: a refusal is answered by the post-hoc failover, if an
 *    understudy exists, not by rewriting the scene. Off duty and Locked keep
 *    the Concierge's hands off as before.
 * 3. Classify concatenated appearance text; if safe → return unchanged
 * 4. Otherwise → sanitize via cheap LLM
 *
 * The third parameter is "the profile that will actually paint this is
 * uncensored" (`isUncensoredImageProfile` on the effective profile), never "an
 * uncensored profile is configured somewhere" (bug 133). Whether one exists in
 * settings and whether *this* image will be generated by it are different
 * questions:
 *
 * - The image-generation tool classifies each prompt and reroutes on the spot
 *   when failover is allowed, so it passes the profile it ended up on.
 * - Story backgrounds route up front only for an Unmoderated chat; otherwise
 *   they paint on the chat's own image profile, uncensored or not.
 *
 * @param appearances - Resolved character appearances
 * @param conciergePolicy - the chat's resolved Concierge policy
 * @param imageTargetUncensored - Whether the profile that will generate this
 *   image is uncensored (`isUncensoredImageProfile`)
 * @param cheapLLMSelection - Cheap LLM provider for classification/sanitization
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for logging
 * @param mode - `redress` (default) swaps explicit states for neutral clothing;
 *   `conceal` keeps the state and sets `needsConcealment`. Only a caller whose
 *   crafter carries the concealment guidance (story backgrounds) may pass
 *   `conceal` — anywhere else the flag would reach a moderated provider
 *   with nothing downstream to act on it.
 * @returns Possibly-sanitized appearances (same array reference if unchanged)
 */
export async function sanitizeAppearancesIfNeeded(
  appearances: ResolvedCharacterAppearance[],
  conciergePolicy: ResolvedConciergePolicy,
  imageTargetUncensored: boolean,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string,
  mode: AppearanceSanitizeMode = 'redress'
): Promise<ResolvedCharacterAppearance[]> {
  // 1. Bound for an uncensored painter → nothing to clean, in any chat state.
  if (imageTargetUncensored) {
    logger.debug('[AppearanceResolution] Image bound for an uncensored profile; appearances left as written', {
      context: 'image-gen.appearance-resolution',
      chatId,
      conciergeState: conciergePolicy.state,
    })
    return appearances
  }

  // 2. Only a Moderated chat with the pre-screen on is cleaned. Unmoderated
  // goes out as written to whatever painter it has; off duty or Locked → the
  // Concierge keeps his hands off.
  if (!conciergePolicy.preScreen.enabled) {
    logger.debug('[AppearanceResolution] Appearance sanitization not applicable under this Concierge policy', {
      context: 'image-gen.appearance-resolution',
      chatId,
      conciergeSource: conciergePolicy.source,
    })
    return appearances
  }

  // 3. Classify concatenated appearance text — what each character carries
  // included, since it reaches the same moderated provider.
  const combinedText = appearances
    .map(a => [a.physicalDescription, a.clothingDescription, a.carryingDescription].filter(Boolean).join(' '))
    .join(' | ')

  let classification
  try {
    classification = await classifyContent(
      combinedText,
      cheapLLMSelection,
      userId,
      conciergePolicy,
      chatId
    )
  } catch (error) {
    // Fail safe — never block
    logger.error('[AppearanceResolution] Appearance classification failed, passing through', {
      context: 'image-gen.appearance-resolution',
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
    return appearances
  }

  // Not dangerous → pass through
  if (!classification.isDangerous) {
    return appearances
  }

  logger.info('[AppearanceResolution] Appearance text classified as dangerous', {
    context: 'image-gen.appearance-resolution',
    chatId,
    score: classification.score,
    categories: classification.categories.map(c => c.category),
  })

  // 4. Dangerous and bound for a moderated provider → sanitize
  logger.info('[AppearanceResolution] Sanitizing dangerous appearance descriptions', {
    context: 'image-gen.appearance-resolution',
    chatId,
    characterCount: appearances.length,
    mode,
  })

  const toSanitize = appearances.map(a => ({
    characterId: a.characterId,
    appearanceText: sanitizableAppearanceText(a),
  }))

  const sanitizeResult = await sanitizeAppearance(
    toSanitize,
    cheapLLMSelection,
    userId,
    chatId,
    mode
  )

  if (!sanitizeResult.success || !sanitizeResult.result) {
    logger.warn('[AppearanceResolution] Sanitization failed, passing through original', {
      context: 'image-gen.appearance-resolution',
      chatId,
      error: sanitizeResult.error,
    })
    return appearances
  }

  // Merge sanitized text back into appearances
  return appearances.map(appearance => {
    const sanitized = sanitizeResult.result!.find(
      s => s.characterId === appearance.characterId
    )
    if (!sanitized) return appearance
    const textChanged = sanitized.appearanceText !== sanitizableAppearanceText(appearance)
    if (!textChanged && !sanitized.undressed) return appearance
    return {
      ...appearance,
      ...(textChanged
        ? {
            // Use sanitized text as physical + clothing + carrying combined;
            // the carrying phrase is inside it now, so it is not appended again.
            physicalDescription: sanitized.appearanceText,
            clothingDescription: '',
            carryingDescription: undefined,
            wasSanitized: true,
          }
        : {}),
      ...(sanitized.undressed ? { needsConcealment: true } : {}),
    }
  })
}

/**
 * One character's appearance as the sanitizer sees it: physical, clothing and
 * (when anything carried is described) the carrying phrase, as sentences.
 */
function sanitizableAppearanceText(
  a: Pick<ResolvedCharacterAppearance, 'physicalDescription' | 'clothingDescription' | 'carryingDescription'>,
): string {
  const base = `${a.physicalDescription}. ${a.clothingDescription}`.trim()
  const carrying = a.carryingDescription?.trim()
  return carrying ? `${base}. ${carrying}`.trim() : base
}

/**
 * The Lantern's description of one resolved character: the (gender-prefixed)
 * physical description, what they wear, and what they carry — each a
 * sentence-fragment the caller joins with `. `. A non-humanoid character
 * takes no gender prefix (pronouns don't give it a body) and gets the
 * non-humanoid direction right after its description. Pure.
 */
export function sceneDescriptionParts(
  resolved: Pick<ResolvedCharacterAppearance, 'physicalDescription' | 'clothingDescription' | 'carryingDescription' | 'humanoid'>,
  genderPrefix = '',
): string[] {
  const humanoid = resolved.humanoid !== false
  const parts = [(humanoid ? genderPrefix : '') + resolved.physicalDescription]
  if (!humanoid) parts.push(NON_HUMANOID_IMAGE_DIRECTION)
  if (resolved.clothingDescription) parts.push(`Wearing: ${resolved.clothingDescription}`)
  const carrying = resolved.carryingDescription?.trim()
  if (carrying) parts.push(carrying.charAt(0).toUpperCase() + carrying.slice(1))
  return parts
}
