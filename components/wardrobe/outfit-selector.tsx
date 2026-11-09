'use client'

/**
 * Outfit Selector Component
 *
 * Allows selecting outfit modes and manual slot assignments for the cast of a
 * new chat, a joining seat, or a merge.
 *
 * Each seat opens on the server's mode (`defaultModes`, from the casting
 * defaults; `defaultOutfitMode` in `lib/chat/opening/arrival.ts` is the one
 * rule) and the selector reports only the seats the operator changed — an
 * untouched seat is left out, so the server applies that same rule.
 *
 * The `Compose outfit` mode (was `Choose Outfit`) reveals an embedded
 * `<OutfitComposer>` — the same component the wardrobe dialog uses for the
 * Outfit Builder tab — seeded from the character's default-outfit items.
 *
 * @module components/wardrobe/outfit-selector
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type {
  OutfitSelectionMode,
  WardrobeItemType,
  EquippedSlots,
} from '@/lib/schemas/wardrobe.types'
import { EMPTY_EQUIPPED_SLOTS, WARDROBE_SLOT_TYPES, WARDROBE_SLOT_META } from '@/lib/schemas/wardrobe.types'
import { useCharacterWardrobeItems } from '@/lib/hooks/use-character-wardrobe-items'
import { buildDefaultOutfit, buildDefaultOutfitWithCredit } from '@/lib/wardrobe/default-outfit'
import { appendWornBundleIds, type StagedGesture } from '@/lib/wardrobe/staged-live-outfits'
import { OutfitComposer } from './outfit-composer'
import { PronounAwareToggle } from './PronounAwareToggle'
import { usePronounGuidanceFilter } from '@/lib/hooks/use-pronoun-guidance-filter'
import { useComposerHandlers } from './hooks/useComposerHandlers'

// ============================================================================
// TYPES
// ============================================================================

export interface OutfitSelection {
  characterId: string
  mode: OutfitSelectionMode
  slots?: EquippedSlots
  /**
   * `manual` only: outfits (bundles) the composer put on — dissolved into
   * `slots` client-side — so the wear ledger can credit them as worn. Ids
   * only; the server validates and expands them.
   */
  wornBundleIds?: string[]
}

export interface OutfitSelectorCharacter {
  id: string
  name: string
  /**
   * Whether this character is controlled by the human operator (as opposed
   * to an LLM). User-controlled characters don't get the `Let character
   * choose` mode — for them, this dialog *is* the choosing.
   */
  isUserControlled?: boolean
}

// ============================================================================
// MODE SUMMARY LABELS
//
// Short badges shown on a character's collapsed "Starting Outfit" header so the
// chosen mode is legible without expanding the section.
// ============================================================================

const MODE_SUMMARY_LABELS: Record<OutfitSelectionMode, string> = {
  default: 'Defaults',
  manual: 'Composed',
  llm_choose: 'Dress Themselves',
  none: 'Undressed',
  previous_chat: 'Same as Last',
}

/**
 * What a seat shows when the caller has no server mode for it: the previous
 * chat's outfit when there is a source chat (a merge), else defaults. Display
 * only — an untouched seat is never sent, so the server's own rule decides.
 */
function shownModeWithoutServer(sourceChatId?: string | null): OutfitSelectionMode {
  return sourceChatId ? 'previous_chat' : 'default'
}

/**
 * Per-character per-slot summary of what was equipped at the end of a source
 * chat. Each slot is an array of resolved items (composites already expanded
 * server-side). Surfaced in the UI when the new chat is a "change of venue"
 * continuation.
 */
export type PreviousOutfitSummary = Record<
  string,
  Partial<Record<WardrobeItemType, Array<{ itemId: string; title: string }>>>
>

export interface OutfitSelectorProps {
  /** LLM-controlled characters in this chat */
  characters: OutfitSelectorCharacter[]
  /** Called with the seats the operator has changed (an untouched seat is absent). */
  onSelectionsChange: (selections: OutfitSelection[]) => void
  /**
   * characterId → the mode the server gives that seat untouched (the casting
   * defaults' `outfitModes`). A seat missing here shows
   * `previous_chat` with a source chat, else `default`.
   */
  defaultModes?: Record<string, OutfitSelectionMode> | null
  /** Whether the parent form is submitting */
  disabled?: boolean
  /**
   * Continuation mode: when set, exposes a "Same as last conversation" option
   * that copies each character's equipped outfit forward from the source chat.
   */
  sourceChatId?: string | null
  previousOutfitSummary?: PreviousOutfitSummary | null
  /** Project the new chat will belong to — folds the project wardrobe tier into manual pickers. */
  projectId?: string | null
  /** Existing chat (when adding a participant) — the project tier is derived from it. */
  chatId?: string | null
}

// ============================================================================
// PER-CHARACTER SECTION
// ============================================================================

interface CharacterOutfitSectionProps {
  character: OutfitSelectorCharacter
  selection: OutfitSelection
  /** True once the operator has changed this seat; only then is it sent. */
  touched: boolean
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
  previousChatSlots?: Partial<Record<WardrobeItemType, Array<{ itemId: string; title: string }>>> | null
  /** Project this chat will belong to — folds the project wardrobe tier into the picker. */
  projectId?: string | null
  /** Existing chat (when adding a participant) — the project tier is derived from it. */
  chatId?: string | null
}

function CharacterOutfitSection({
  character,
  selection,
  touched,
  onChange,
  disabled,
  showHeader,
  showPreviousChatOption,
  previousChatSlots,
  projectId,
  chatId,
}: CharacterOutfitSectionProps) {
  const [expanded, setExpanded] = useState(false)

  // A seat the server would dress in its defaults, but whose wardrobe has no
  // usable default outfit, is shown on `Compose outfit` (expanded, so the
  // empty slots are visible). Display only: the mode is not sent until the
  // operator changes something, and `default` with nothing marked dresses
  // the seat in exactly what an empty composer would.
  const mayShowAsCompose = !touched && selection.mode === 'default'
  const wardrobeNeeded = selection.mode === 'manual' || mayShowAsCompose
  const {
    items: allWardrobeItems,
    loading: loadingWardrobe,
    fetched: wardrobeItemsFetched,
  } = useCharacterWardrobeItems(wardrobeNeeded ? character.id : null, { projectId, chatId })
  const wardrobeFetched = !loadingWardrobe && allWardrobeItems.length > 0

  /**
   * Visible items. The composer never asks for archived garments, so the
   * loader has already dropped them — no client-side pass here, which would
   * only be a second place for the rule to drift. There is deliberately no
   * "Show archived" toggle on this surface: it composes the opening outfit,
   * the same job the LLM does, and an archived garment must never audition.
   */
  const wardrobeItems = allWardrobeItems

  const hasUsableDefault = useMemo(() => {
    const defaults = buildDefaultOutfit(allWardrobeItems)
    return WARDROBE_SLOT_TYPES.some((slot) => defaults[slot].length > 0)
  }, [allWardrobeItems])
  const showsAsCompose = mayShowAsCompose && wardrobeItemsFetched && !hasUsableDefault
  const mode: OutfitSelectionMode = showsAsCompose ? 'manual' : selection.mode

  // Expand once when the seat first shows as Compose (state adjusted during
  // render, React's pattern for state that follows a derived value).
  const [sawCompose, setSawCompose] = useState(false)
  if (showsAsCompose && !sawCompose) {
    setSawCompose(true)
    setExpanded(true)
  }

  const itemsById = useMemo(
    () => new Map(wardrobeItems.map((i) => [i.id, i])),
    [wardrobeItems],
  )

  // Pronoun-aware pickers (on by default); seeded defaults stay as they are.
  const pronounFilter = usePronounGuidanceFilter(mode === 'manual' ? character.id : null)
  const pickableItems = useMemo(() => pronounFilter.offer(wardrobeItems), [pronounFilter, wardrobeItems])

  // When the operator picks `Compose outfit`, seed the slots from the
  // wardrobe's defaults once — subsequent edits stay theirs.
  const seededRef = useRef(false)
  useEffect(() => {
    if (!touched || selection.mode !== 'manual') return
    if (seededRef.current) return
    if (wardrobeItems.length === 0) return
    if (selection.slots && Object.values(selection.slots).some((arr) => arr.length > 0)) {
      seededRef.current = true
      return
    }
    const defaults = buildDefaultOutfitWithCredit(wardrobeItems)
    seededRef.current = true
    onChange({
      characterId: character.id,
      mode: 'manual',
      slots: defaults.slots,
      wornBundleIds: defaults.wornBundles.map((b) => b.id),
    })
  }, [touched, selection.mode, wardrobeItems, selection.slots, character.id, onChange])

  const handleModeChange = useCallback(
    (mode: OutfitSelectionMode) => {
      const updated: OutfitSelection = {
        characterId: character.id,
        mode,
        slots:
          mode === 'manual'
            ? selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }
            : undefined,
        wornBundleIds: mode === 'manual' ? selection.wornBundleIds : undefined,
      }
      onChange(updated)
    },
    [character.id, selection.slots, selection.wornBundleIds, onChange],
  )

  // The composer's six slot handlers, shared with the wardrobe dialog. Every
  // gesture lands on this character's selection; an outfit put on (dissolved
  // into the slots) carries its id beside them for the wear ledger.
  const applyGesture = useCallback(
    (gesture: StagedGesture) => {
      onChange({
        characterId: character.id,
        mode: 'manual',
        slots: gesture.mutate(selection.slots ?? { ...EMPTY_EQUIPPED_SLOTS }),
        wornBundleIds:
          gesture.wornBundleIds.length > 0
            ? appendWornBundleIds(selection.wornBundleIds, gesture.wornBundleIds)
            : selection.wornBundleIds,
      })
    },
    [character.id, selection.slots, selection.wornBundleIds, onChange],
  )
  const composerHandlers = useComposerHandlers({ itemsById, apply: applyGesture })

  const handleClearAll = useCallback(() => {
    onChange({
      characterId: character.id,
      mode: 'manual',
      slots: { ...EMPTY_EQUIPPED_SLOTS },
    })
  }, [character.id, onChange])

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
    ...(character.isUserControlled
      ? []
      : [
          {
            value: 'llm_choose' as OutfitSelectionMode,
            label: 'Let character choose',
            description: 'The character picks clothes, and what to carry, based on the scenario.',
          },
        ]),
    {
      value: 'none',
      label: 'Start undressed',
      description: 'Character will start undressed.',
    },
  ]

  const previousChatPreview = (() => {
    if (!previousChatSlots) return null
    const equipped = WARDROBE_SLOT_TYPES
      .map((slot) => {
        const items = previousChatSlots[slot] ?? []
        if (items.length === 0) return null
        return { slot, titles: items.map((i) => i.title) }
      })
      .filter(
        (entry): entry is { slot: WardrobeItemType; titles: string[] } => entry !== null,
      )
    if (equipped.length === 0) {
      return 'Nothing equipped at the end of the source chat — defaults will be used.'
    }
    return equipped
      .map((e) => `${WARDROBE_SLOT_META[e.slot].label}: ${e.titles.join(', ')}`)
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
          <span className="flex items-center gap-2">
            <span className="text-xs qt-text-secondary">{MODE_SUMMARY_LABELS[mode]}</span>
            <Icon name="chevron-down" className={`w-4 h-4 qt-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </span>
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
                  checked={mode === opt.value}
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

          {/* Compose outfit — embedded composer, with bundle actions and a
              `Clear all` escape hatch so the user isn't stuck with whatever
              the defaults seeded (e.g. a `Work` bundle they want to replace). */}
          {mode === 'manual' && (
            <div className="mt-3 pl-6">
              {loadingWardrobe ? (
                <p className="text-xs qt-text-secondary">Loading wardrobe…</p>
              ) : wardrobeItems.length === 0 && wardrobeFetched ? (
                <p className="text-xs qt-text-secondary italic">
                  No wardrobe items found. Add items in the character&apos;s wardrobe tab.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-end gap-3 mb-2">
                    <PronounAwareToggle filter={pronounFilter} items={wardrobeItems} />
                    <button
                      type="button"
                      onClick={handleClearAll}
                      disabled={disabled}
                      className="qt-button-ghost qt-button-sm"
                      title="Empty every slot and start from scratch"
                    >
                      Clear all
                    </button>
                  </div>
                  <OutfitComposer
                    items={wardrobeItems}
                    pickableItems={pickableItems}
                    slots={stagedSlots}
                    {...composerHandlers}
                  />
                </>
              )}
            </div>
          )}

          {/* Warning for "Start undressed" */}
          {mode === 'none' && (
            <div className="mt-2 ml-6 rounded border qt-border-warning/50 qt-bg-warning/10 px-2 py-1.5 text-xs qt-text-warning">
              Character will start undressed
            </div>
          )}

          {/* Continuation mode preview */}
          {mode === 'previous_chat' && previousChatPreview && (
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
  defaultModes,
  disabled,
  sourceChatId,
  previousOutfitSummary,
  projectId,
  chatId,
}: OutfitSelectorProps) {
  // Only the seats the operator changed. Every other seat shows the server's
  // mode and is left out of what is reported, so the server applies it.
  const [changed, setChanged] = useState<Map<string, OutfitSelection>>(() => new Map())

  // Report the changed seats still in the cast (a seat removed from the cast
  // takes its choice with it).
  useEffect(() => {
    const liveIds = new Set(characters.map((c) => c.id))
    onSelectionsChange(Array.from(changed.values()).filter((s) => liveIds.has(s.characterId)))
  }, [changed, characters, onSelectionsChange])

  const handleSelectionChange = useCallback(
    (selection: OutfitSelection) => {
      setChanged((prev) => {
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
      {characters.map((char) => {
        const choice = changed.get(char.id)
        return (
          <CharacterOutfitSection
            key={char.id}
            character={char}
            selection={
              choice ?? {
                characterId: char.id,
                mode: defaultModes?.[char.id] ?? shownModeWithoutServer(sourceChatId),
              }
            }
            touched={Boolean(choice)}
            onChange={handleSelectionChange}
            disabled={disabled}
            showHeader={showHeaders}
            showPreviousChatOption={Boolean(sourceChatId)}
            previousChatSlots={previousOutfitSummary?.[char.id] ?? null}
            projectId={projectId}
            chatId={chatId}
          />
        )
      })}
    </div>
  )
}
