'use client'

/**
 * Outfit Selector Component
 *
 * Allows selecting outfit modes and manual slot assignments for
 * LLM-controlled characters when creating a new chat.
 *
 * The `Compose outfit` mode (was `Choose Outfit`) reveals an embedded
 * `<OutfitComposer>` — the same component the wardrobe dialog uses for the
 * Outfit Builder tab — seeded from the character's default-outfit items.
 *
 * @module components/wardrobe/outfit-selector
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  OutfitSelectionMode,
  WardrobeItem,
  WardrobeItemType,
  EquippedSlots,
} from '@/lib/schemas/wardrobe.types'
import { EMPTY_EQUIPPED_SLOTS } from '@/lib/schemas/wardrobe.types'
import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'
import { buildDefaultOutfit } from '@/lib/wardrobe/default-outfit'
import { OutfitComposer } from './outfit-composer'

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

  // Load wardrobe (personal + archetypes) only when we're in manual mode.
  // The hook returns an empty list before items are needed.
  const { items: allWardrobeItems, loading: loadingWardrobe } = useCharacterWardrobeItems(
    internalMode === 'manual' ? character.id : null,
  )
  const wardrobeFetched = !loadingWardrobe && allWardrobeItems.length > 0

  // Visible items: skip archived and items lacking any of the four slots
  // (defensive — schemas already enforce non-empty types).
  const wardrobeItems = useMemo(
    () => allWardrobeItems.filter((i) => !i.archivedAt),
    [allWardrobeItems],
  )

  // Track whether we've already seeded the manual slots from defaults — once
  // seeded, subsequent edits stay user-driven.
  const seededRef = useRef(false)
  useEffect(() => {
    if (internalMode !== 'manual') return
    if (seededRef.current) return
    if (wardrobeItems.length === 0) return
    if (selection.slots && Object.values(selection.slots).some((arr) => arr.length > 0)) {
      seededRef.current = true
      return
    }
    const defaults = buildDefaultOutfit(wardrobeItems)
    seededRef.current = true
    onChange({ characterId: character.id, mode: 'manual', slots: defaults })
  }, [internalMode, wardrobeItems, selection.slots, character.id, onChange])

  const handleModeChange = useCallback(
    (mode: OutfitSelectionMode) => {
      setInternalMode(mode)
      const updated: OutfitSelection = {
        characterId: character.id,
        mode,
        slots:
          mode === 'manual'
            ? selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
            : undefined,
      }
      onChange(updated)
    },
    [character.id, selection.slots, onChange],
  )

  const handleAddToSlot = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      if ((currentSlots[slot] ?? []).includes(itemId)) return
      const next = { ...currentSlots, [slot]: [...(currentSlots[slot] ?? []), itemId] }
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, onChange],
  )

  const handleRemoveFromSlot = useCallback(
    (slot: WardrobeItemType, itemId: string) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const next = {
        ...currentSlots,
        [slot]: (currentSlots[slot] ?? []).filter((id) => id !== itemId),
      }
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, onChange],
  )

  const handleClearSlot = useCallback(
    (slot: WardrobeItemType) => {
      const currentSlots = selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
      const next = { ...currentSlots, [slot]: [] }
      onChange({ characterId: character.id, mode: 'manual', slots: next })
    },
    [character.id, selection.slots, onChange],
  )

  const modeOptions: Array<{
    value: OutfitSelectionMode
    label: string
    description?: string
  }> = [
    ...(showPreviousChatOption
      ? [
          {
            value: 'previous_chat' as OutfitSelectionMode,
            label: 'Same as last conversation',
            description:
              'Carry forward whatever they were wearing at the end of the source chat',
          },
        ]
      : []),
    {
      value: 'default',
      label: 'Use defaults',
      description: 'Items marked default in their wardrobe.',
    },
    {
      value: 'manual',
      label: 'Compose outfit',
      description: 'Pick the starting outfit slot by slot.',
    },
    {
      value: 'llm_choose',
      label: 'Let character choose',
      description: 'The character picks based on the scenario.',
    },
    {
      value: 'none',
      label: 'Start undressed',
      description: 'Character will start undressed.',
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
      .filter(
        (entry): entry is {
          slot: 'top' | 'bottom' | 'footwear' | 'accessories'
          titles: string[]
        } => entry !== null,
      )
    if (equipped.length === 0) {
      return 'Nothing equipped at the end of the source chat — defaults will be used.'
    }
    return equipped
      .map((e) => `${SLOT_LABELS[e.slot]}: ${e.titles.join(', ')}`)
      .join(' · ')
  })()

  const stagedSlots = selection.slots ?? EMPTY_EQUIPPED_SLOTS

  return (
    <div className="rounded-lg border qt-border-default qt-bg-muted/20 p-3">
      {showHeader && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between text-left cursor-pointer"
          disabled={disabled}
        >
          <span className="text-sm font-medium qt-text-primary">{character.name}</span>
          <svg
            className={`w-4 h-4 qt-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
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
                className="flex items-start gap-2 rounded px-2 py-1.5 text-sm transition cursor-pointer hover:qt-bg-muted/40"
              >
                <input
                  type="radio"
                  name={`outfit-mode-${character.id}`}
                  value={opt.value}
                  checked={internalMode === opt.value}
                  onChange={() => handleModeChange(opt.value)}
                  disabled={disabled}
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

          {/* Compose outfit — embedded composer, no take-off / break-apart */}
          {internalMode === 'manual' && (
            <div className="mt-3 pl-6">
              {loadingWardrobe ? (
                <p className="text-xs qt-text-secondary">Loading wardrobe…</p>
              ) : wardrobeItems.length === 0 && wardrobeFetched ? (
                <p className="text-xs qt-text-secondary italic">
                  No wardrobe items found. Add items in the character&apos;s wardrobe tab.
                </p>
              ) : (
                <OutfitComposer
                  items={wardrobeItems}
                  slots={stagedSlots}
                  onAddToSlot={handleAddToSlot}
                  onRemoveFromSlot={handleRemoveFromSlot}
                  onClearSlot={handleClearSlot}
                  showBundleActions={false}
                />
              )}
            </div>
          )}

          {/* Warning for "Start undressed" */}
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
    [],
  )

  if (characters.length === 0) return null

  const showHeaders = characters.length > 1

  return (
    <div className="space-y-2">
      <label className="mb-2 block text-sm qt-text-primary">Starting Outfit</label>
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
