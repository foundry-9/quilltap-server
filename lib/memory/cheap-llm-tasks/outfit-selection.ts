/**
 * Outfit Selection via Cheap LLM
 *
 * Asks an LLM to choose an appropriate outfit for a character based on
 * their available wardrobe items and the scenario/context. Used during
 * chat initialization when the user selects "Let Character Choose" mode.
 *
 * Follows the same pattern as resolveAppearance() in image-scene-tasks.ts.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { WardrobeItem, EquippedSlots } from '@/lib/schemas/wardrobe.types'
import { EMPTY_EQUIPPED_SLOTS, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import { executeCheapLLMTask } from './core-execution'
import type { CheapLLMTaskResult } from './types'
import { logger } from '@/lib/logger'

const OUTFIT_SELECTION_PROMPT = `You are a wardrobe assistant for a roleplay character. Your job is to choose what a character should wear at the start of a scene, based on:
- The character's available wardrobe items
- The scenario/setting description
- The character's personality

Choose items that are contextually appropriate. For example, formal wear for a business meeting, casual clothes for relaxing at home, or era-appropriate costume for a historical setting.

You MUST respond with ONLY a JSON object mapping slot names to wardrobe item IDs. Valid slots are: "top", "bottom", "footwear", "accessories". Use null for any slot you want to leave empty.

Example response:
{"top": "item-uuid-1", "bottom": "item-uuid-2", "footwear": "item-uuid-3", "accessories": null}

Do not include any other text, explanation, or markdown formatting. Just the JSON object.`

/**
 * Ask an LLM to choose an outfit for a character based on context.
 *
 * @param characterName The character's display name
 * @param characterPersonality Brief personality description (for context)
 * @param wardrobeItems Available wardrobe items the LLM can choose from
 * @param scenarioText The scenario or setting for the chat (may be null)
 * @param selection The cheap LLM provider selection to use
 * @param userId User ID for logging
 * @param chatId Chat ID for logging
 * @returns Equipped slots chosen by the LLM, or failure result
 */
export async function chooseLLMOutfit(
  characterName: string,
  characterPersonality: string | null,
  wardrobeItems: WardrobeItem[],
  scenarioText: string | null,
  selection: CheapLLMSelection,
  userId: string,
  chatId?: string,
): Promise<CheapLLMTaskResult<EquippedSlots>> {
  if (wardrobeItems.length === 0) {
    logger.debug('[OutfitSelection] No wardrobe items available, returning empty slots', {
      characterName,
      chatId,
    })
    return {
      success: true,
      result: { ...EMPTY_EQUIPPED_SLOTS },
    }
  }

  // Build wardrobe listing for the LLM
  const wardrobeSection = wardrobeItems.map(item => {
    const types = item.types.join(', ')
    const appropriateness = item.appropriateness ? ` [appropriate for: ${item.appropriateness}]` : ''
    const desc = item.description ? ` — ${item.description}` : ''
    return `  - ID: ${item.id} | "${item.title}" (covers: ${types})${appropriateness}${desc}`
  }).join('\n')

  const personalityNote = characterPersonality
    ? `\nCharacter Personality: ${characterPersonality.substring(0, 300)}`
    : ''

  const scenarioNote = scenarioText
    ? `\nScenario: ${scenarioText.substring(0, 500)}`
    : '\nScenario: (general conversation, no specific setting)'

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: OUTFIT_SELECTION_PROMPT,
    },
    {
      role: 'user',
      content: `Character: ${characterName}${personalityNote}${scenarioNote}

Available Wardrobe Items:
${wardrobeSection}

Choose what ${characterName} should wear for this scene:`,
    },
  ]

  // Build a lookup of item IDs for validation
  const validItemIds = new Set(wardrobeItems.map(item => item.id))
  // Build a lookup of which slots each item covers
  const itemSlotMap = new Map<string, string[]>()
  for (const item of wardrobeItems) {
    itemSlotMap.set(item.id, item.types)
  }

  return executeCheapLLMTask(
    selection,
    messages,
    userId,
    (content: string): EquippedSlots => {
      // Strip markdown code fences if present
      let cleanContent = content.trim()
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '')
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '')
      }

      const parsed = JSON.parse(cleanContent)

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        logger.warn('[OutfitSelection] LLM returned non-object response, using empty slots', {
          chatId,
          responsePreview: cleanContent.substring(0, 200),
        })
        return { ...EMPTY_EQUIPPED_SLOTS }
      }

      // Validate and map the response to EquippedSlots
      const result: EquippedSlots = { ...EMPTY_EQUIPPED_SLOTS }

      for (const slot of WARDROBE_SLOT_TYPES) {
        const itemId = parsed[slot]
        if (typeof itemId === 'string' && validItemIds.has(itemId)) {
          // Verify the item actually covers this slot
          const itemSlots = itemSlotMap.get(itemId)
          if (itemSlots && itemSlots.includes(slot)) {
            result[slot] = itemId
          } else {
            logger.debug('[OutfitSelection] LLM assigned item to wrong slot, skipping', {
              chatId,
              slot,
              itemId,
              itemCovers: itemSlots,
            })
          }
        } else if (itemId !== null && itemId !== undefined) {
          logger.debug('[OutfitSelection] LLM referenced unknown item ID, skipping', {
            chatId,
            slot,
            itemId,
          })
        }
      }

      return result
    },
    'outfit-selection',
    chatId,
  )
}
