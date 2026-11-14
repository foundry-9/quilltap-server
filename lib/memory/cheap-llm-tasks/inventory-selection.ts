/**
 * Inventory Selection via the Green Room's model
 *
 * The inventory half of "Let Character Choose": given what a character can
 * reach in the Inventory and the scene they are walking into, ask the model
 * which objects they should be carrying when it opens. The wardrobe's
 * `chooseLLMOutfit` is the other half; both run on the Green Room's model
 * (`selectGreenRoomLLM`).
 *
 * The parser keeps only ids that were offered and reports an answer it cannot
 * read as a failure, so the caller falls back to the character's
 * equipped-by-default objects. An empty `carry` list is a legitimate answer —
 * walking in empty-handed — and is kept.
 */

import type { LLMMessage } from '@/lib/llm/base'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import type { SubpromptForPrompt } from '@/lib/subprompts/subprompts'
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve'
import { stripCodeFences } from '@/lib/llm/llm-json'
import { executeCheapLLMTask } from './core-execution'
import type { CheapLLMTaskResult } from './types'
import { logger } from '@/lib/logger'

/** Sampling temperature: a little variety, but objects are mostly a matter of fit. */
export const INVENTORY_SELECTION_TEMPERATURE = 0.5

const INVENTORY_SELECTION_PROMPT = `You are a property master for a roleplay character. Your job is to decide which objects a character is carrying when a scene opens, based on:
- The objects the character can reach (their own, and any shared with them)
- The scenario/setting description
- The character's personality and nature
- Any additional instructions in play for this scene, when provided — standing directions the character is following in this particular conversation; honour anything in them that bears on what they carry

Choose what this person would plausibly have on them, or with them, as the scene begins. A detective walking into a crime scene brings a notebook; nobody brings a sword to a dinner party unless the setting calls for it; a character at home in the bath carries very little.

Objects marked [usually carried] are what the character normally has on them. Keep them unless the scene makes carrying one absurd or impossible — then leave it behind.

An object marked [kit] is a set of objects carried together; choosing it brings every object it names. Choose a kit only when the whole set suits the scene; otherwise choose its pieces by their own IDs, when they are listed.

Carrying nothing is a legitimate choice. Do not pad the list: choose only what fits the scene.

You MUST respond with ONLY a JSON object of this shape, listing the IDs of the chosen objects:
{"carry": ["uuid-notebook", "uuid-pocket-watch"]}

Use {"carry": []} to carry nothing. Do not include any other text, explanation, or markdown formatting. Just the JSON object.`

/** What the model decided: the ids to carry, every one of them offered. */
export interface LLMInventoryChoice {
  ids: string[]
}

export interface ChooseLLMInventoryParams {
  characterName: string
  characterDescription: string | null
  characterPersonality: string | null
  characterManifesto: string | null
  /** Carriable objects and kits the character may choose from. */
  items: readonly ResolvedInventoryItem[]
  scenarioText: string | null
  selection: CheapLLMSelection
  userId: string
  chatId?: string
  characterId?: string
  /** The seat's subprompts in play (second person). */
  subprompts?: readonly SubpromptForPrompt[] | null
  /** What the character is wearing, by title, when the outfit is already settled. */
  wearing?: readonly string[]
  /** Source of randomness for the list shuffle. Tests inject one. */
  random?: () => number
}

/** One object's line in the listing. */
function describeItem(item: ResolvedInventoryItem, labelById: ReadonlyMap<string, string>): string {
  const markers: string[] = []
  if (item.kind === 'kit') {
    const named = item.itemIds.map((id) => labelById.get(id)).filter((t): t is string => !!t)
    const unnamed = item.itemIds.length - named.length
    const parts = named.map((t) => `"${t}"`)
    if (unnamed > 0) parts.push(`${unnamed} other object${unnamed === 1 ? '' : 's'}`)
    markers.push(`[kit — ${parts.join(', ') || 'empty'}]`)
  }
  if (item.equippedByDefault) markers.push('[usually carried]')
  const desc = item.description ? ` — ${item.description.trim()}` : ''
  return `  - ID: ${item.id} | "${inventoryDisplayName(item)}"${markers.length ? ` ${markers.join(' ')}` : ''}${desc}`
}

/**
 * Ask the Green Room's model which objects a character should carry into a
 * scene. Returns success with an empty choice, without calling the model,
 * when there is nothing to choose from.
 */
export async function chooseLLMInventory(
  params: ChooseLLMInventoryParams,
): Promise<CheapLLMTaskResult<LLMInventoryChoice>> {
  const { characterName, items, chatId, characterId } = params
  if (items.length === 0) {
    return { success: true, result: { ids: [] } }
  }

  const labelById = new Map(items.map((item) => [item.id, inventoryLabel(item)]))
  const listing = shuffled(items, params.random ?? Math.random)
    .map((item) => describeItem(item, labelById))
    .join('\n')

  const note = (label: string, text: string | null | undefined) =>
    text && text.trim().length > 0 ? `\n${label}:\n${text.trim()}` : ''

  const scenarioNote = params.scenarioText
    ? `\nScenario: ${params.scenarioText}`
    : '\nScenario: (general conversation, no specific setting)'

  const wearingNote = params.wearing && params.wearing.length > 0
    ? `\nWearing: ${params.wearing.join(', ')}`
    : ''

  const subprompts = params.subprompts ?? []
  const subpromptsNote = subprompts.length > 0
    ? `\nAdditional Instructions in play for this scene (addressed to ${characterName} in the second person — "you" is ${characterName}):\n` +
      subprompts.map((s) => `### ${s.title}\n${s.content.trim()}`).join('\n\n')
    : ''

  const messages: LLMMessage[] = [
    { role: 'system', content: INVENTORY_SELECTION_PROMPT },
    {
      role: 'user',
      content: `Character: ${characterName}` +
        note('Character Manifesto (foundational tenets)', params.characterManifesto) +
        note('Character Description (behaviour and mannerisms)', params.characterDescription) +
        note('Character Personality (internal drivers)', params.characterPersonality) +
        scenarioNote +
        wearingNote +
        subpromptsNote +
        `\n\nObjects ${characterName} can reach:\n${listing}\n\nChoose what ${characterName} is carrying as this scene opens:`,
    },
  ]

  const offered = new Set(items.map((item) => item.id))

  return executeCheapLLMTask(
    params.selection,
    messages,
    params.userId,
    (content: string): LLMInventoryChoice => {
      const parsed = JSON.parse(stripCodeFences(content))
      const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.carry : undefined
      if (!Array.isArray(raw)) {
        // Unreadable is a failure, not "carry nothing": the caller falls back
        // to the character's usual objects.
        throw new Error('Inventory selection response has no "carry" array')
      }
      const ids: string[] = []
      let dropped = 0
      for (const candidate of raw) {
        if (typeof candidate === 'string' && offered.has(candidate)) {
          if (!ids.includes(candidate)) ids.push(candidate)
        } else {
          dropped += 1
        }
      }
      if (dropped > 0) {
        logger.debug('[InventorySelection] Dropped ids that were not offered', { chatId, characterId, dropped })
      }
      return { ids }
    },
    'inventory-selection',
    chatId,
    undefined,
    undefined,
    undefined,
    characterId,
    { temperature: INVENTORY_SELECTION_TEMPERATURE },
  )
}

/** A Fisher–Yates shuffle into a new array; the input is left alone. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
