'use client'

/**
 * Outfit Selector Component
 *
 * Allows selecting outfit modes and manual slot assignments for
 * LLM-controlled characters when creating a new chat.
 *
 * @module components/wardrobe/outfit-selector
 */

import { useCallback, useEffect, useState, useMemo } from 'react'
import useSWR from 'swr'
import type {
  OutfitSelectionMode,
  OutfitPreset,
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

export interface OutfitSelectorProps {
  /** LLM-controlled characters in this chat */
  characters: OutfitSelectorCharacter[]
  /** Callback when selections change */
  onSelectionsChange: (selections: OutfitSelection[]) => void
  /** Whether the parent form is submitting */
  disabled?: boolean
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
// INTERNAL MODE TYPE (adds 'preset' to the selection modes)
// ============================================================================

type InternalMode = OutfitSelectionMode | 'preset'

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
}

function CharacterOutfitSection({
  character,
  selection,
  onChange,
  disabled,
  showHeader,
}: CharacterOutfitSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const [internalMode, setInternalMode] = useState<InternalMode>(selection.mode)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)

  // Fetch wardrobe items when mode is manual or preset
  const { data: wardrobeData, isLoading: loadingWardrobe } = useSWR<{ wardrobeItems: WardrobeItem[] }>(
    (internalMode === 'manual' || internalMode === 'preset')
      ? `/api/v1/characters/${character.id}/wardrobe`
      : null
  )

  // Fetch presets when mode is preset
  const { data: presetsData, isLoading: loadingPresets } = useSWR<{ presets: OutfitPreset[] }>(
    internalMode === 'preset' ? `/api/v1/characters/${character.id}/wardrobe/presets` : null
  )

  const wardrobeItems = useMemo(() => wardrobeData?.wardrobeItems ?? [], [wardrobeData])
  const presets = useMemo(() => presetsData?.presets ?? [], [presetsData])
  const wardrobeFetched = wardrobeData !== undefined
  const presetsFetched = presetsData !== undefined

  const handleModeChange = useCallback(
    (mode: InternalMode) => {
      setInternalMode(mode)

      if (mode === 'preset') {
        // Don't emit to parent yet — wait for a preset to be selected
        // Meanwhile, keep the current selection stable
        return
      }

      const updated: OutfitSelection = {
        characterId: character.id,
        mode: mode as OutfitSelectionMode,
        slots: mode === 'manual' ? selection.slots || { ...EMPTY_EQUIPPED_SLOTS } : undefined,
      }
      onChange(updated)
    },
    [character.id, selection.slots, onChange]
  )

  const handlePresetSelect = useCallback(
    (presetId: string) => {
      setSelectedPresetId(presetId)
      const preset = presets.find((p) => p.id === presetId)
      if (!preset) return

      // Resolve preset client-side: emit as 'manual' mode with the preset's slots
      const updated: OutfitSelection = {
        characterId: character.id,
        mode: 'manual',
        slots: { ...preset.slots },
      }
      onChange(updated)
    },
    [character.id, presets, onChange]
  )

  const handleSlotChange = useCallback(
    (slot: WardrobeItemType, itemId: string | null) => {
      const currentSlots = selection.slots || { ...EMPTY_EQUIPPED_SLOTS }
      const updated: OutfitSelection = {
        characterId: character.id,
        mode: 'manual',
        slots: { ...currentSlots, [slot]: itemId },
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
    value: InternalMode
    label: string
    description?: string
    disabled?: boolean
  }> = [
    { value: 'default', label: 'Use Defaults' },
    { value: 'manual', label: 'Choose Outfit' },
    { value: 'preset', label: 'Use Saved Preset' },
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

          {/* Preset picker */}
          {internalMode === 'preset' && (
            <div className="mt-3 pl-6">
              {loadingPresets ? (
                <p className="text-xs qt-text-secondary">Loading presets...</p>
              ) : presets.length === 0 && presetsFetched ? (
                <p className="text-xs qt-text-secondary italic">
                  No presets found. Create presets in the character&apos;s wardrobe tab.
                </p>
              ) : (
                <div>
                  <label
                    htmlFor={`preset-select-${character.id}`}
                    className="mb-1 block text-xs font-medium qt-text-secondary"
                  >
                    Select Preset
                  </label>
                  <select
                    id={`preset-select-${character.id}`}
                    value={selectedPresetId || ''}
                    onChange={(e) => handlePresetSelect(e.target.value)}
                    disabled={disabled}
                    className="qt-select w-full"
                  >
                    <option value="">Choose a preset...</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                        {preset.description ? ` - ${preset.description}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Manual slot pickers */}
          {internalMode === 'manual' && (
            <div className="mt-3 space-y-2 pl-6">
              {loadingWardrobe ? (
                <p className="text-xs qt-text-secondary">Loading wardrobe...</p>
              ) : wardrobeItems.length === 0 && wardrobeFetched ? (
                <p className="text-xs qt-text-secondary italic">
                  No wardrobe items found. Add items in the character&apos;s wardrobe tab.
                </p>
              ) : (
                WARDROBE_SLOT_TYPES.map((slot) => {
                  const items = getItemsForSlot(slot)
                  return (
                    <div key={slot}>
                      <label
                        htmlFor={`slot-${character.id}-${slot}`}
                        className="mb-1 block text-xs font-medium qt-text-secondary"
                      >
                        {SLOT_LABELS[slot]}
                      </label>
                      <select
                        id={`slot-${character.id}-${slot}`}
                        value={selection.slots?.[slot] || ''}
                        onChange={(e) =>
                          handleSlotChange(slot, e.target.value || null)
                        }
                        disabled={disabled}
                        className="w-full rounded border qt-border-default bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">None</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                            {item.isDefault ? ' (Default)' : ''}
                          </option>
                        ))}
                      </select>
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
}: OutfitSelectorProps) {
  const [selections, setSelections] = useState<Map<string, OutfitSelection>>(
    () => {
      const map = new Map<string, OutfitSelection>()
      for (const char of characters) {
        map.set(char.id, { characterId: char.id, mode: 'default' })
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
              mode: 'default',
            }
          }
          onChange={handleSelectionChange}
          disabled={disabled}
          showHeader={showHeaders}
        />
      ))}
    </div>
  )
}
