'use client'

/**
 * Outfit Selector Component
 *
 * Allows selecting outfit modes and manual slot assignments for
 * LLM-controlled characters when creating a new chat.
 *
 * Each slot now accepts an array of items (multiple per slot for layering),
 * matching the post-rework wardrobe model. Manual mode renders a per-slot
 * checkbox group of every wardrobe item whose types include that slot;
 * checking an item adds it to the slot's array.
 *
 * @module components/wardrobe/outfit-selector
 */

import { useCallback, useEffect, useState, useMemo } from 'react'
import useSWR from 'swr'
import type {
  OutfitSelectionMode,
  WardrobeItem,
  WardrobeItemType,
  EquippedSlots,
} from '@/lib/schemas/wardrobe.types'
import { EMPTY_EQUIPPED_SLOTS, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'

// ============================================================================
// TYPES
// ============================================================================

export interface OutfitSelection {
  characterId: string
  mode: OutfitSelectionMode
  slots?: EquippedSlots
}

export interface OutfitSelectorCharacter {
  id: string
  name: string
}

/**
 * Per-character per-slot summary of what was equipped at the end of a source
 * chat. Each slot is an array of resolved items (composites already expanded
 * server-side). Surfaced in the UI when the new chat is a "change of venue"
 * continuation.
 */
export type PreviousOutfitSummary = Record<
  string,
  Partial<Record<'top' | 'bottom' | 'footwear' | 'accessories', Array<{ itemId: string; title: string }>>>
>

export interface OutfitSelectorProps {
  /** LLM-controlled characters in this chat */
  characters: OutfitSelectorCharacter[]
  /** Callback when selections change */
  onSelectionsChange: (selections: OutfitSelection[]) => void
  /** Whether the parent form is submitting */
  disabled?: boolean
  /**
   * Continuation mode: when set, exposes a "Same as last conversation" option
   * that copies each character's equipped outfit forward from the source chat.
   */
  sourceChatId?: string | null
  previousOutfitSummary?: PreviousOutfitSummary | null
}

// ============================================================================
// SLOT LABELS
// ============================================================================

const SLOT_LABELS: Record<WardrobeItemType, string> = {
  top: 'Top',
  bottom: 'Bottom',
  footwear: 'Footwear',
  accessories: 'Accessories',
}

// ============================================================================
// PER-CHARACTER SECTION
// ============================================================================

interface CharacterOutfitSectionProps {
  character: OutfitSelectorCharacter
  selection: OutfitSelection
  onChange: (selection: OutfitSelection) => void
  disabled?: boolean
  /** Whether to show the character name header (hidden for single character) */
  showHeader: boolean
  /**
   * Continuation mode: enables the "Same as last conversation" radio option
   * for this character.
   */
  showPreviousChatOption?: boolean
  /**
   * Continuation mode: per-slot summary of what this character was wearing
   * at the end of the source chat. Rendered as a small preview under the
   * "Same as last conversation" option.
   */
  previousChatSlots?: Partial<Record<'top' | 'bottom' | 'footwear' | 'accessories', Array<{ itemId: string; title: string }>>> | null
}

function CharacterOutfitSection({
  character,
  selection,
  onChange,
  disabled,
  showHeader,
  showPreviousChatOption,
  previousChatSlots,
}: CharacterOutfitSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [internalMode, setInternalMode] = useState<OutfitSelectionMode>(selection.mode)

  // Fetch wardrobe items when mode is manual
  const { data: wardrobeData, isLoading: loadingWardrobe } = useSWR<{ wardrobeItems: WardrobeItem[] }>(
    internalMode === 'manual'
      ? `/api/v1/characters/${character.id}/wardrobe`
      : null
  )

  const wardrobeItems = useMemo(() => wardrobeData?.wardrobeItems ?? [], [wardrobeData])
  const wardrobeFetched = wardrobeData !== undefined

  const handleModeChange = useCallback(
    (mode: OutfitSelectionMode) => {
      setInternalMode(mode)

      const updated: OutfitSelection = {
        characterId: character.id,
        mode,
        slots: mode === 'manual' ? selection.slots || { ...EMPTY_EQUIPPED_SLOTS } : undefined,
      }
      onChange(updated)
    },
    [character.id, selection.slots, onChange]
  )

  const handleToggleItem = useCallback(
    (slot: WardrobeItemType, itemId: string, checked: boolean) => {
      const currentSlots = selection.slots || { ...EMPTY_EQUIPPED_SLOTS }
      const currentArray = currentSlots[slot] ?? []
      let nextArray: string[]
      if (checked) {
        if (currentArray.includes(itemId)) {
          nextArray = currentArray
        } else {
          nextArray = [...currentArray, itemId]
        }
      } else {
        nextArray = currentArray.filter((id) => id !== itemId)
      }

      const updated: OutfitSelection = {
        characterId: character.id,
        mode: 'manual',
        slots: { ...currentSlots, [slot]: nextArray },
      }
      onChange(updated)
    },
    [character.id, selection.slots, onChange]
  )

  const getItemsForSlot = useCallback(
    (slot: WardrobeItemType): WardrobeItem[] => {
      return wardrobeItems.filter((item) => item.types.includes(slot))
    },
    [wardrobeItems]
  )

  const modeOptions: Array<{
    value: OutfitSelectionMode
    label: string
    description?: string
    disabled?: boolean
  }> = [
    ...(showPreviousChatOption
      ? [
          {
            value: 'previous_chat' as OutfitSelectionMode,
            label: 'Same as last conversation',
            description: 'Carry forward whatever they were wearing at the end of the source chat',
          },
        ]
      : []),
    { value: 'default', label: 'Use Defaults' },
    { value: 'manual', label: 'Choose Outfit' },
    {
      value: 'llm_choose',
      label: 'Let Character Choose',
      description: 'The character picks their own outfit based on the scenario',
    },
    {
      value: 'none',
      label: 'None',
      description: 'Character will start undressed',
    },
  ]

  const previousChatPreview = (() => {
    if (!previousChatSlots) return null
    const equipped = (['top', 'bottom', 'footwear', 'accessories'] as const)
      .map((slot) => {
        const items = previousChatSlots[slot] ?? []
        if (items.length === 0) return null
        return { slot, titles: items.map((i) => i.title) }
      })
      .filter((entry): entry is { slot: 'top' | 'bottom' | 'footwear' | 'accessories'; titles: string[] } => entry !== null)
    if (equipped.length === 0) {
      return 'Nothing equipped at the end of the source chat — defaults will be used.'
    }
    return equipped.map((e) => `${SLOT_LABELS[e.slot]}: ${e.titles.join(', ')}`).join(' · ')
  })()

  return (
    <div className="rounded-lg border qt-border-default qt-bg-muted/20 p-3">
      {showHeader && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
          disabled={disabled}
        >
          <span className="text-sm font-medium qt-text-primary">
            {character.name}
          </span>
          <svg
            className={`w-4 h-4 qt-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {(expanded || !showHeader) && (
        <div className={showHeader ? 'mt-3' : ''}>
          {/* Mode selector */}
          <div className="space-y-1.5">
            {modeOptions.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-2 rounded px-2 py-1.5 text-sm transition ${
                  opt.disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer hover:qt-bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  name={`outfit-mode-${character.id}`}
                  value={opt.value}
                  checked={internalMode === opt.value}
                  onChange={() => handleModeChange(opt.value)}
                  disabled={disabled || opt.disabled}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <div className="flex-1 min-w-0">
                  <span className="qt-text-primary">{opt.label}</span>
                  {opt.description && (
                    <span className="ml-1.5 text-xs qt-text-secondary italic">
                      {opt.description}
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>

          {/* Manual slot pickers — multi-select per slot */}
          {internalMode === 'manual' && (
            <div className="mt-3 space-y-3 pl-6">
              {loadingWardrobe ? (
                <p className="text-xs qt-text-secondary">Loading wardrobe...</p>
              ) : wardrobeItems.length === 0 && wardrobeFetched ? (
                <p className="text-xs qt-text-secondary italic">
                  No wardrobe items found. Add items in the character&apos;s wardrobe tab.
                </p>
              ) : (
                WARDROBE_SLOT_TYPES.map((slot) => {
                  const items = getItemsForSlot(slot)
                  const slotSelections = selection.slots?.[slot] ?? []
                  return (
                    <div key={slot}>
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="text-xs font-medium qt-text-secondary">
                          {SLOT_LABELS[slot]}
                        </span>
                        <span className="text-xs qt-text-secondary italic">
                          {slotSelections.length === 0
                            ? '(none)'
                            : `${slotSelections.length} selected`}
                        </span>
                      </div>
                      {items.length === 0 ? (
                        <p className="text-xs qt-text-secondary italic">
                          No items cover this slot.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {items.map((item) => {
                            const isComposite = (item.componentItemIds?.length ?? 0) > 0
                            const checked = slotSelections.includes(item.id)
                            return (
                              <label
                                key={item.id}
                                className="flex items-start gap-2 rounded px-2 py-1 text-xs cursor-pointer hover:qt-bg-muted/40"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    handleToggleItem(slot, item.id, e.target.checked)
                                  }
                                  disabled={disabled}
                                  className="mt-0.5 accent-[var(--primary)]"
                                />
                                <span className="qt-text-primary">
                                  {item.title}
                                  {item.isDefault ? ' (Default)' : ''}
                                  {isComposite ? ' · composite' : ''}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* Warning for none mode */}
          {internalMode === 'none' && (
            <div className="mt-2 ml-6 rounded border qt-border-warning/50 qt-bg-warning/10 px-2 py-1.5 text-xs qt-text-warning">
              Character will start undressed
            </div>
          )}

          {/* Continuation mode preview */}
          {internalMode === 'previous_chat' && previousChatPreview && (
            <div className="mt-2 ml-6 rounded border qt-border-default qt-bg-muted/40 px-2 py-1.5 text-xs qt-text-secondary">
              {previousChatPreview}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function OutfitSelector({
  characters,
  onSelectionsChange,
  disabled,
  sourceChatId,
  previousOutfitSummary,
}: OutfitSelectorProps) {
  // In continuation mode, default each character to "Same as last conversation"
  // so the chat picks up where the previous one left off without the user
  // having to flip every radio. In normal mode, keep the historical default.
  const initialMode: OutfitSelectionMode = sourceChatId ? 'previous_chat' : 'default'
  const [selections, setSelections] = useState<Map<string, OutfitSelection>>(
    () => {
      const map = new Map<string, OutfitSelection>()
      for (const char of characters) {
        map.set(char.id, { characterId: char.id, mode: initialMode })
      }
      return map
    }
  )

  // Notify parent when selections change
  useEffect(() => {
    onSelectionsChange(Array.from(selections.values()))
  }, [selections, onSelectionsChange])

  const handleSelectionChange = useCallback(
    (selection: OutfitSelection) => {
      setSelections((prev) => {
        const next = new Map(prev)
        next.set(selection.characterId, selection)
        return next
      })
    },
    []
  )

  if (characters.length === 0) return null

  const showHeaders = characters.length > 1

  return (
    <div className="space-y-2">
      <label className="mb-2 block text-sm qt-text-primary">
        Starting Outfit
      </label>
      {characters.map((char) => (
        <CharacterOutfitSection
          key={char.id}
          character={char}
          selection={
            selections.get(char.id) || {
              characterId: char.id,
              mode: initialMode,
            }
          }
          onChange={handleSelectionChange}
          disabled={disabled}
          showHeader={showHeaders}
          showPreviousChatOption={Boolean(sourceChatId)}
          previousChatSlots={previousOutfitSummary?.[char.id] ?? null}
        />
      ))}
    </div>
  )
}
