/**
 * Context-Aware Character Appearance Resolution
 *
 * Orchestrates the resolution of character appearances for image generation
 * by analyzing chat context to determine what each character currently looks
 * like and is wearing. Integrates with Dangermouse for safety sanitization.
 *
 * @module image-gen/appearance-resolution
 */

import type { PhysicalDescription, ClothingRecord } from '@/lib/schemas/types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import {
  resolveAppearance,
  sanitizeAppearance,
  type ChatMessage,
  type CharacterAppearanceInput,
  type AppearanceResolutionItem,
} from '@/lib/memory/cheap-llm-tasks'
import {
  classifyContent,
} from '@/lib/services/dangerous-content/gatekeeper.service'
import { logger } from '@/lib/logger'

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
  /** What the character is currently wearing */
  clothingDescription: string
  /** How clothing was determined */
  clothingSource: 'narrative' | 'stored' | 'default'
  /** Whether Dangermouse sanitized this appearance */
  wasSanitized: boolean
}

/**
 * Input for the appearance resolution pipeline
 */
export interface AppearanceResolutionInput {
  characterId: string
  characterName: string
  physicalDescriptions: PhysicalDescription[]
  clothingRecords: ClothingRecord[]
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
    c => c.physicalDescriptions.length <= 1 && c.clothingRecords.length <= 1
  )
}

/**
 * Build default resolved appearances without an LLM call
 */
function buildDefaultAppearances(
  characters: AppearanceResolutionInput[]
): ResolvedCharacterAppearance[] {
  return characters.map(char => {
    const primary = char.physicalDescriptions[0]
    const primaryOutfit = char.clothingRecords[0]

    const physDesc =
      primary?.completePrompt ||
      primary?.longPrompt ||
      primary?.mediumPrompt ||
      primary?.shortPrompt ||
      char.characterName

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      physicalDescription: physDesc,
      physicalDescriptionName: primary?.name || 'default',
      clothingDescription: primaryOutfit?.description || '',
      clothingSource: primaryOutfit ? 'default' as const : 'default' as const,
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

    // Find the selected physical description
    let selectedDesc: PhysicalDescription | undefined
    if (resolved?.selectedDescriptionId) {
      selectedDesc = char.physicalDescriptions.find(
        d => d.id === resolved.selectedDescriptionId
      )
    }
    if (!selectedDesc) {
      selectedDesc = char.physicalDescriptions[0]
    }

    const physDesc = selectedDesc
      ? (selectedDesc.completePrompt ||
         selectedDesc.longPrompt ||
         selectedDesc.mediumPrompt ||
         selectedDesc.shortPrompt ||
         char.characterName)
      : char.characterName

    return {
      characterId: char.characterId,
      characterName: char.characterName,
      physicalDescription: physDesc,
      physicalDescriptionName: selectedDesc?.name || 'default',
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
 * @returns Resolution result with appearances and whether the LLM succeeded
 */
export async function resolveCharacterAppearances(
  characters: AppearanceResolutionInput[],
  recentMessages: ChatMessage[],
  imagePrompt: string,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<AppearanceResolutionResult> {
  if (characters.length === 0) {
    return { appearances: [], llmResolved: true }
  }

  // Skip optimization: no LLM call needed when context is trivial
  if (canSkipResolution(characters, recentMessages)) {
    logger.debug('[AppearanceResolution] Skipping LLM call — trivial character data with no chat context', {
      context: 'image-gen.appearance-resolution',
      characterCount: characters.length,
    })
    return { appearances: buildDefaultAppearances(characters), llmResolved: true }
  }

  // Build the LLM input
  const llmInput: CharacterAppearanceInput[] = characters.map(char => ({
    characterId: char.characterId,
    characterName: char.characterName,
    physicalDescriptions: char.physicalDescriptions.map(d => ({
      id: d.id,
      name: d.name,
      usageContext: d.usageContext,
      shortPrompt: d.shortPrompt,
      mediumPrompt: d.mediumPrompt,
    })),
    clothingRecords: char.clothingRecords.map(c => ({
      id: c.id,
      name: c.name,
      usageContext: c.usageContext,
      description: c.description,
    })),
  }))

  logger.debug('[AppearanceResolution] Resolving character appearances via cheap LLM', {
    context: 'image-gen.appearance-resolution',
    characterCount: characters.length,
    messageCount: recentMessages.length,
    chatId,
  })

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

  logger.debug('[AppearanceResolution] Resolved appearances', {
    context: 'image-gen.appearance-resolution',
    chatId,
    results: resolved.map(r => ({
      name: r.characterName,
      descriptionName: r.physicalDescriptionName,
      clothingSource: r.clothingSource,
      hasClothing: r.clothingDescription.length > 0,
    })),
  })

  return { appearances: resolved, llmResolved: true }
}

// ============================================================================
// DANGERMOUSE APPEARANCE SANITIZATION
// ============================================================================

/**
 * Sanitize resolved appearances through Dangermouse if needed.
 *
 * Logic:
 * 1. If Dangermouse mode is OFF → return unchanged
 * 2. If chat is marked dangerous AND an uncensored image provider exists → return unchanged
 * 3. Classify concatenated appearance text; if safe → return unchanged
 * 4. If dangerous AND uncensored provider available → return unchanged (will route there)
 * 5. If dangerous AND NO uncensored provider → sanitize via cheap LLM
 *
 * @param appearances - Resolved character appearances
 * @param dangerSettings - Dangermouse settings
 * @param isDangerousChat - Whether the chat is marked as dangerous
 * @param hasUncensoredImageProvider - Whether an uncensored image provider is available
 * @param cheapLLMSelection - Cheap LLM provider for classification/sanitization
 * @param userId - Current user ID
 * @param chatId - Optional chat ID for logging
 * @returns Possibly-sanitized appearances (same array reference if unchanged)
 */
export async function sanitizeAppearancesIfNeeded(
  appearances: ResolvedCharacterAppearance[],
  dangerSettings: DangerousContentSettings,
  isDangerousChat: boolean,
  hasUncensoredImageProvider: boolean,
  cheapLLMSelection: CheapLLMSelection,
  userId: string,
  chatId?: string
): Promise<ResolvedCharacterAppearance[]> {
  // 1. Dangermouse off → pass through
  if (dangerSettings.mode === 'OFF') {
    return appearances
  }

  // 2. Dangerous chat with uncensored provider → accurate appearances are fine
  if (isDangerousChat && hasUncensoredImageProvider) {
    logger.debug('[AppearanceResolution] Skipping sanitization — dangerous chat with uncensored provider', {
      context: 'image-gen.appearance-resolution',
      chatId,
    })
    return appearances
  }

  // 3. Classify concatenated appearance text
  const combinedText = appearances
    .map(a => `${a.physicalDescription} ${a.clothingDescription}`)
    .join(' | ')

  let classification
  try {
    classification = await classifyContent(
      combinedText,
      cheapLLMSelection,
      userId,
      dangerSettings,
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
    logger.debug('[AppearanceResolution] Appearance text classified as safe', {
      context: 'image-gen.appearance-resolution',
      chatId,
      score: classification.score,
    })
    return appearances
  }

  logger.info('[AppearanceResolution] Appearance text classified as dangerous', {
    context: 'image-gen.appearance-resolution',
    chatId,
    score: classification.score,
    categories: classification.categories.map(c => c.category),
    hasUncensoredImageProvider,
  })

  // 4. Dangerous but uncensored provider available → will be routed there
  if (hasUncensoredImageProvider) {
    logger.debug('[AppearanceResolution] Skipping sanitization — uncensored image provider available', {
      context: 'image-gen.appearance-resolution',
      chatId,
    })
    return appearances
  }

  // 5. Dangerous with NO uncensored provider → sanitize
  logger.info('[AppearanceResolution] Sanitizing dangerous appearance descriptions', {
    context: 'image-gen.appearance-resolution',
    chatId,
    characterCount: appearances.length,
  })

  const toSanitize = appearances.map(a => ({
    characterId: a.characterId,
    appearanceText: `${a.physicalDescription}. ${a.clothingDescription}`.trim(),
  }))

  const sanitizeResult = await sanitizeAppearance(
    toSanitize,
    cheapLLMSelection,
    userId,
    chatId
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
    if (sanitized && sanitized.appearanceText !== `${appearance.physicalDescription}. ${appearance.clothingDescription}`.trim()) {
      logger.debug('[AppearanceResolution] Sanitized appearance for character', {
        context: 'image-gen.appearance-resolution',
        chatId,
        characterName: appearance.characterName,
      })
      return {
        ...appearance,
        // Use sanitized text as both physical + clothing combined
        physicalDescription: sanitized.appearanceText,
        clothingDescription: '',
        wasSanitized: true,
      }
    }
    return appearance
  })
}
