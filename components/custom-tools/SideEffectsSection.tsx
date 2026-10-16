'use client'

/**
 * SideEffectsSection — the Workbench's "Side effects" card, between the
 * builder form and the outcome table: what a run writes back once the deal is
 * done.
 *
 * Each row is one of two kinds. A WRITE has a target and a value that is a
 * literal number, a literal boolean, or an expression. A WARDROBE row changes
 * what the rolling character has on: an action (wear / take off / clear a
 * slot), a short list of item references (title or id, templated), and the
 * mode and slot where the action wants them. Switching kind keeps the other
 * half on the draft until save, so nothing typed is lost.
 *
 * The When is the common shapes only: "Always" or "on a given outcome
 * state". A hand-written richer condition (comparators,
 * metadata, the oracle) is carried verbatim behind a read-only badge — the
 * `$state`-default precedent: the builder round-trips what it cannot author.
 * Everything else arrives as issues from `validateDraft` and renders inline.
 *
 * A wardrobe row's item references are read through a VANTAGE — whose
 * wardrobe the author is browsing (editor state, never saved). Each
 * reference resolves by the one rule (`resolveWearableRef`) against that
 * pool and renders as a chip with the garment's picture, slots, origin and
 * reach; a templated reference keeps its text box; an unresolved one keeps
 * its text box under an advisory, never an error — the lens is partial and
 * the applier fail-soft. The *Choose…* picker fills a reference by title (or
 * by id, on request).
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { SlotBadge } from '@/components/wardrobe/slot-ui'
import { WardrobeItemThumbnail } from '@/components/wardrobe/wardrobe-item-thumbnail'
import {
  REFERENCE_FORM_HINT,
  WardrobeReferencePicker,
  type WardrobeReferenceForm,
} from '@/components/wardrobe/wardrobe-reference-picker'
import { useWardrobeVantageItems } from '@/lib/hooks/use-wardrobe-vantage-items'
import type { TierItem } from '@/lib/hooks/use-wardrobe-tier'
import type { CustomToolDestinations } from '@/lib/pascal/workbench'
import {
  MAX_EFFECTS,
  MAX_EFFECT_TARGET_LENGTH,
  MAX_WARDROBE_EFFECT_ITEMS,
  MAX_WARDROBE_ITEM_REF_LENGTH,
  type OutcomeState,
  type WardrobeEffectAction,
  type WardrobeEffectMode,
} from '@/lib/pascal/custom-tool.types'
import {
  newDraftEffect,
  type DraftEffect,
  type DraftIssue,
  type DraftWardrobeGesture,
  type ToolDraft,
  type WardrobeVantage,
} from '@/lib/pascal/tool-draft'
import {
  WARDROBE_SLOT_META,
  WARDROBE_SLOT_TYPES,
  formatSlotLabels,
  isComposite,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types'
import { wardrobeOriginLabel, wardrobeReachLabel } from '@/lib/wardrobe/wardrobe-container'
import { archivedWearMessage } from '@/lib/wardrobe/wearable'
import { isTemplatedWearableRef, resolveWearableRef } from '@/lib/wardrobe/wearable-ref'
import { WardrobeVantageSelect, wardrobeVantageName } from './WardrobeVantageSelect'

interface SideEffectsSectionProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  disabled?: boolean
  /** Whose wardrobe the item references are read against. Default: none. */
  vantage?: WardrobeVantage
  /** Change the vantage; without it the selector is not offered. */
  onVantageChange?: (next: WardrobeVantage) => void
  /** The destinations payload — names for characters, projects and groups. */
  destinations?: CustomToolDestinations
  /** The project whose store holds this file, if any (named in the vantage hint). */
  homeProjectName?: string | null
}

const NO_VANTAGE: WardrobeVantage = { kind: 'none' }

/** Which item row the picker is filling, and the item it currently names. */
interface PickTarget {
  effectId: string
  index: number
  highlightId: string | null
}

const OUTCOME_STATES: readonly OutcomeState[] = ['success', 'partial', 'failure', 'info'] as const

/** The When select's flat values; 'verbatim' never appears as an option. */
type WhenChoice = 'always' | OutcomeState

function whenChoiceOf(effect: DraftEffect): WhenChoice | 'verbatim' {
  if (effect.when.kind === 'always') return 'always'
  if (effect.when.kind === 'outcome-state') return effect.when.state
  return 'verbatim'
}

export function SideEffectsSection({
  draft,
  issues,
  onChange,
  disabled = false,
  vantage = NO_VANTAGE,
  onVantageChange,
  destinations,
  homeProjectName = null,
}: Readonly<SideEffectsSectionProps>) {
  const hasWardrobe = draft.effects.some((effect) => effect.kind === 'wardrobe')
  // Read nothing until a wardrobe row exists: an author who never dresses
  // anybody pays for no wardrobe reads.
  const pool = useWardrobeVantageItems(hasWardrobe ? vantage : null)
  const vantageName = wardrobeVantageName(vantage, destinations)
  const characterName = vantage.kind === 'character' ? vantageName : null
  const [referenceForm, setReferenceForm] = useState<WardrobeReferenceForm>('title')
  const [picking, setPicking] = useState<PickTarget | null>(null)
  const pickingEffect = picking ? draft.effects.find((effect) => effect.id === picking.effectId) : undefined

  const update = (partial: Partial<ToolDraft>) => onChange({ ...draft, ...partial })

  const updateEffect = (id: string, partial: Partial<DraftEffect>) =>
    update({ effects: draft.effects.map((effect) => (effect.id === id ? { ...effect, ...partial } : effect)) })

  const addEffect = () => {
    update({ effects: [...draft.effects, newDraftEffect()] })
  }

  const removeEffect = (id: string) => update({ effects: draft.effects.filter((effect) => effect.id !== id) })

  const effectErrors = (id: string): string[] =>
    issues
      .filter((issue) => issue.severity === 'error' && issue.where.section === 'effect' && issue.where.id === id)
      .map((issue) => issue.message)
  const effectWarnings = (id: string): string[] =>
    issues
      .filter((issue) => issue.severity === 'warning' && issue.where.section === 'effect' && issue.where.id === id)
      .map((issue) => issue.message)

  return (
    <section className="qt-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="qt-card-title text-sm">Side effects</h2>
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm"
          onClick={addEffect}
          disabled={disabled || draft.effects.length >= MAX_EFFECTS}
          title={draft.effects.length >= MAX_EFFECTS ? `At most ${MAX_EFFECTS} effects` : undefined}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          Add effect ({draft.effects.length}/{MAX_EFFECTS})
        </button>
      </div>

      {hasWardrobe && onVantageChange && (
        <WardrobeVantageSelect
          vantage={vantage}
          onChange={onVantageChange}
          destinations={destinations}
          homeProjectName={homeProjectName}
          disabled={disabled}
        />
      )}

      {draft.effects.length === 0 && (
        <p className="text-xs qt-text-secondary">
          None declared. An effect lets a roll record its consequences — tick a counter in the story&rsquo;s
          state, note a fact on the rolling character&rsquo;s sheet, put a garment on them or take one off —
          applied server-side as part of the deal,
          beyond any model&rsquo;s power to fudge.
        </p>
      )}

      {draft.effects.map((effect) => {
        const errors = effectErrors(effect.id)
        const warnings = effectWarnings(effect.id)
        const choice = whenChoiceOf(effect)

        return (
          <div key={effect.id} className="qt-card p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2">
                Kind
                <select
                  value={effect.kind}
                  onChange={(e) => updateEffect(effect.id, { kind: e.target.value as DraftEffect['kind'] })}
                  disabled={disabled}
                  className="qt-select qt-select-sm"
                  aria-label="Effect kind"
                >
                  <option value="write">Write a value</option>
                  <option value="wardrobe">Change the outfit</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                When
                {choice === 'verbatim' ? (
                  <span
                    className="qt-text-xs qt-text-secondary font-mono rounded qt-bg-muted px-2 py-1"
                    title="This condition is richer than the form authors. Edit it in the raw JSON."
                  >
                    {effect.when.kind === 'verbatim' ? JSON.stringify(effect.when.when) : ''}
                  </span>
                ) : (
                  <select
                    value={choice}
                    onChange={(e) => {
                      const value = e.target.value as WhenChoice
                      updateEffect(effect.id, {
                        when: value === 'always' ? { kind: 'always' } : { kind: 'outcome-state', state: value },
                      })
                    }}
                    disabled={disabled}
                    className="qt-select qt-select-sm"
                    aria-label="When this effect applies"
                  >
                    <option value="always">every run</option>
                    {OUTCOME_STATES.map((state) => (
                      <option key={state} value={state}>
                        outcome is {state}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm ml-auto"
                onClick={() => removeEffect(effect.id)}
                disabled={disabled}
                title="Delete this effect"
              >
                <Icon name="trash" className="w-4 h-4" />
              </button>
            </div>

            {effect.kind === 'wardrobe' ? (
              <WardrobeFields
                gesture={effect.wardrobe}
                hasErrors={errors.length > 0}
                disabled={disabled}
                onChange={(wardrobe) => updateEffect(effect.id, { wardrobe })}
                pool={pool.items}
                poolFetched={pool.fetched}
                vantage={vantage}
                vantageName={vantageName}
                characterName={characterName}
                onChoose={(index, highlightId) => setPicking({ effectId: effect.id, index, highlightId })}
              />
            ) : (
            <>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2 flex-1 min-w-56">
                Target
                <input
                  type="text"
                  value={effect.target}
                  maxLength={MAX_EFFECT_TARGET_LENGTH}
                  onChange={(e) => updateEffect(effect.id, { target: e.target.value })}
                  placeholder="state.encounter.count"
                  disabled={disabled}
                  className={`qt-input flex-1 font-mono ${errors.length > 0 ? 'qt-input-error' : ''}`}
                  aria-label="Effect target"
                />
              </label>
              {effect.target.trim() === '' && (
                <span className="flex gap-1">
                  {(['state.', 'metadata.', 'progress.'] as const).map((prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      className="qt-button qt-button-ghost qt-button-sm font-mono"
                      onClick={() => updateEffect(effect.id, { target: prefix })}
                      disabled={disabled}
                      title={
                        prefix === 'state.'
                          ? 'Write into tiered persistent state, at the tier where the key already lives'
                          : prefix === 'metadata.'
                            ? "Write onto the rolling character's own fact sheet (metadata.json)"
                            : 'Adjust one of the rolling character\u2019s timed progressions — progress.<id>.<field>. An id nobody authored is created; write true to progress.<id>.remove to delete one.'
                      }
                    >
                      {prefix}
                    </button>
                  ))}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2">
                Value
                <select
                  value={effect.valueKind}
                  onChange={(e) => {
                    const valueKind = e.target.value as DraftEffect['valueKind']
                    updateEffect(effect.id, {
                      valueKind,
                      value: valueKind === 'literal-boolean' ? 'true' : valueKind === 'literal-number' ? '' : effect.value,
                    })
                  }}
                  disabled={disabled}
                  className="qt-select qt-select-sm"
                  aria-label="Value kind"
                >
                  <option value="expression">expression</option>
                  <option value="literal-number">number</option>
                  <option value="literal-boolean">true/false</option>
                </select>
              </label>
              {effect.valueKind === 'literal-boolean' ? (
                <select
                  value={effect.value === 'true' ? 'true' : 'false'}
                  onChange={(e) => updateEffect(effect.id, { value: e.target.value })}
                  disabled={disabled}
                  className="qt-select qt-select-sm"
                  aria-label="Boolean value"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={effect.valueKind === 'literal-number' ? 'number' : 'text'}
                  step="any"
                  value={effect.value}
                  onChange={(e) => updateEffect(effect.id, { value: e.target.value })}
                  placeholder={effect.valueKind === 'literal-number' ? '1' : "{{state.encounter.count}} + 1"}
                  disabled={disabled}
                  className={`qt-input flex-1 min-w-48 font-mono ${errors.length > 0 ? 'qt-input-error' : ''}`}
                  aria-label="Effect value"
                />
              )}
            </div>
            </>
            )}

            {errors.map((message) => (
              <p key={message} className="text-xs qt-text-destructive">
                {message}
              </p>
            ))}
            {warnings.map((message) => (
              <p key={message} className="text-xs qt-text-secondary">
                ⚠ {message}
              </p>
            ))}
          </div>
        )
      })}

      <p className="qt-hint">
        Effects apply in order, after the outcome is chosen. A JSON string value is always an expression —
        quote literal prose: <code className="font-mono">&apos;broken pick&apos;</code>, never bare words.
        Expressions take + − × ÷, parentheses, and the same {'{{…}}'} references as a message. An outfit change
        dresses or undresses the rolling character and nobody else; an item it cannot find is skipped and the
        rest still go on.
      </p>

      <WardrobeReferencePicker
        isOpen={picking !== null && pickingEffect?.kind === 'wardrobe'}
        onClose={() => setPicking(null)}
        vantage={vantage}
        characterName={characterName}
        headerControl={
          onVantageChange ? (
            <WardrobeVantageSelect
              vantage={vantage}
              onChange={onVantageChange}
              destinations={destinations}
              homeProjectName={homeProjectName}
            />
          ) : undefined
        }
        action={
          pickingEffect?.wardrobe.action === 'take_off'
            ? 'take_off'
            : pickingEffect?.wardrobe.action === 'wear'
              ? 'wear'
              : undefined
        }
        slot={pickingEffect && slotIsCoupled(pickingEffect.wardrobe) ? pickingEffect.wardrobe.slot || null : null}
        highlightId={picking?.highlightId ?? null}
        reference={referenceForm}
        onReferenceChange={setReferenceForm}
        onPick={(item, { reference }) => {
          if (!picking || !pickingEffect) return
          const gesture = pickingEffect.wardrobe
          const items = gesture.items.length > 0 ? gesture.items : ['']
          const value = reference === 'id' ? item.id : item.title
          updateEffect(pickingEffect.id, {
            wardrobe: { ...gesture, items: items.map((ref, i) => (i === picking.index ? value : ref)) },
          })
        }}
      />
    </section>
  )
}

const WARDROBE_ACTIONS: ReadonlyArray<{ value: WardrobeEffectAction; label: string }> = [
  { value: 'wear', label: 'wear' },
  { value: 'take_off', label: 'take off' },
  { value: 'clear_slot', label: 'clear a slot' },
]

const WARDROBE_MODES: ReadonlyArray<{ value: WardrobeEffectMode; label: string; title: string }> = [
  { value: 'wear', label: 'as the item says', title: "Honour each item's own replace flag" },
  { value: 'replace', label: 'replace', title: 'Swap out whatever is in the slots the item covers' },
  { value: 'add_to_slot', label: 'layer into one slot', title: 'Add the item to one named slot' },
]

/**
 * True when the gesture's slot and its items must agree: `add_to_slot` layers
 * into the one slot, and a `take_off` may be restricted to one.
 */
function slotIsCoupled(gesture: DraftWardrobeGesture): boolean {
  return (gesture.action === 'wear' && gesture.mode === 'add_to_slot') || gesture.action === 'take_off'
}

interface WardrobeFieldsProps {
  gesture: DraftWardrobeGesture
  hasErrors: boolean
  disabled: boolean
  onChange: (next: DraftWardrobeGesture) => void
  /** The vantage's pool, nearest tier first, archived included. */
  pool: TierItem[]
  /** False until the pool's reads settle — no advisory before then. */
  poolFetched: boolean
  vantage: WardrobeVantage
  vantageName: string | null
  characterName: string | null
  /** Open the picker for item row `index`, highlighting the item it names. */
  onChoose: (index: number, highlightId: string | null) => void
}

/** A wardrobe row's fields: action, items, and the mode and slot when the action wants them. */
function WardrobeFields({
  gesture,
  hasErrors,
  disabled,
  onChange,
  pool,
  poolFetched,
  vantage,
  vantageName,
  characterName,
  onChoose,
}: Readonly<WardrobeFieldsProps>) {
  const set = (partial: Partial<DraftWardrobeGesture>) => onChange({ ...gesture, ...partial })
  const wantsItems = gesture.action !== 'clear_slot'
  const wantsSlot =
    gesture.action === 'clear_slot' ||
    gesture.action === 'take_off' ||
    (gesture.action === 'wear' && gesture.mode === 'add_to_slot')
  const slotOptional = gesture.action === 'take_off'
  const items = gesture.items.length > 0 ? gesture.items : ['']

  const setItem = (index: number, value: string) => set({ items: items.map((item, i) => (i === index ? value : item)) })
  const removeItem = (index: number) => {
    const next = items.filter((_, i) => i !== index)
    set({ items: next.length > 0 ? next : [''] })
  }

  // Each row's resolution, by the one rule the applier uses.
  const resolved = items.map((ref) => (vantage.kind === 'none' ? undefined : resolveWearableRef(pool, ref)))

  // Slot coupling (§3.2): only when every concrete (non-blank, non-templated)
  // row resolved — a templated row may yet cover the slot.
  const concrete = items
    .map((ref, index) => ({ ref, item: resolved[index] }))
    .filter(({ ref }) => ref.trim() !== '' && !isTemplatedWearableRef(ref))
  const coupled =
    wantsItems && slotIsCoupled(gesture) && concrete.length > 0 && concrete.every(({ item }) => item !== undefined)
  const covered = new Set<WardrobeItemType>(
    coupled ? concrete.flatMap(({ item }) => (item ? (item.types as WardrobeItemType[]) : [])) : []
  )
  const slotMismatches =
    coupled && gesture.slot
      ? concrete.filter(({ item }) => item && !item.types.includes(gesture.slot as WardrobeItemType))
      : []

  const unreachableNote =
    vantage.kind === 'character'
      ? `not in ${vantageName ?? 'this character'}\u2019s reach`
      : `not in ${vantageName ?? 'this wardrobe'}`

  const chooseButton = (index: number) => (
    <button
      type="button"
      className="qt-button qt-button-secondary qt-button-sm"
      onClick={() => onChoose(index, null)}
      disabled={disabled}
      title="Browse the wardrobe and pick a garment or outfit"
    >
      Choose…
    </button>
  )

  const trashButton = (index: number) => (
    <button
      type="button"
      className="qt-button qt-button-ghost qt-button-sm"
      onClick={() => removeItem(index)}
      disabled={disabled || items.length <= 1}
      title="Remove this item"
    >
      <Icon name="trash" className="w-4 h-4" />
    </button>
  )

  const textInput = (item: string, index: number) => (
    <input
      type="text"
      value={item}
      maxLength={MAX_WARDROBE_ITEM_REF_LENGTH}
      onChange={(e) => setItem(index, e.target.value)}
      placeholder={index === 0 ? 'Cloak of Night' : '{{params.garment}}'}
      disabled={disabled}
      className={`qt-input flex-1 min-w-48 ${hasErrors ? 'qt-input-error' : ''}`}
      aria-label={`Item ${index + 1}`}
    />
  )

  const renderItemRow = (ref: string, index: number) => {
    const item = resolved[index]
    if (item) {
      const byId = ref.trim() === item.id
      const originLabel = wardrobeOriginLabel(item.origin) ?? `${characterName ?? 'Their'}${characterName ? '\u2019s' : ''} own`
      const reach = wardrobeReachLabel(item.origin, characterName)
      return (
        <div key={index} className="space-y-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex flex-1 min-w-48 items-start gap-2 rounded border qt-border-default px-2 py-1 text-left hover:opacity-80"
              onClick={() => onChoose(index, item.id)}
              disabled={disabled}
              aria-label={`Item ${index + 1}: ${item.title} — choose another`}
              data-testid="wardrobe-reference-chip"
            >
              <WardrobeItemThumbnail fileId={item.imageFileId} size={28} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block break-words text-sm text-foreground">
                  {item.title}
                  {isComposite(item) && <span className="qt-text-secondary"> · outfit</span>}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {item.types.map((slot) => (
                    <SlotBadge key={slot} slot={slot} />
                  ))}
                  <span className="qt-badge qt-badge-wardrobe-shared">{originLabel}</span>
                  {reach && <span className="qt-text-xs qt-text-secondary">{reach}</span>}
                  {item.archivedAt && <span className="qt-badge qt-badge-secondary">archived</span>}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => setItem(index, byId ? item.title : item.id)}
              disabled={disabled}
              title={`${byId ? 'Referenced by id' : 'Referenced by title'} — click to switch. ${REFERENCE_FORM_HINT}`}
              aria-label={byId ? 'Reference by title instead' : 'Reference by id instead'}
            >
              {byId ? 'by id' : 'by title'}
            </button>
            {trashButton(index)}
          </div>
          {item.archivedAt && gesture.action === 'wear' && (
            <p className="text-xs qt-text-secondary">⚠ {archivedWearMessage(item.title)}</p>
          )}
        </div>
      )
    }

    const templated = isTemplatedWearableRef(ref)
    const unresolved = !templated && vantage.kind !== 'none' && poolFetched && ref.trim() !== ''
    return (
      <div key={index} className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {textInput(ref, index)}
          {unresolved && (
            <span className="qt-badge qt-badge-secondary" data-testid="wardrobe-reference-unresolved">
              {unreachableNote}
            </span>
          )}
          {chooseButton(index)}
          {trashButton(index)}
        </div>
        {templated && <p className="qt-hint">chosen at run time</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2">
          Action
          <select
            value={gesture.action}
            onChange={(e) => set({ action: e.target.value as WardrobeEffectAction })}
            disabled={disabled}
            className="qt-select qt-select-sm"
            aria-label="Wardrobe action"
          >
            {WARDROBE_ACTIONS.map((action) => (
              <option key={action.value} value={action.value}>
                {action.label}
              </option>
            ))}
          </select>
        </label>
        {gesture.action === 'wear' && (
          <label className="flex items-center gap-2">
            Mode
            <select
              value={gesture.mode}
              onChange={(e) => set({ mode: e.target.value as WardrobeEffectMode })}
              disabled={disabled}
              className="qt-select qt-select-sm"
              aria-label="Wear mode"
            >
              {WARDROBE_MODES.map((mode) => (
                <option key={mode.value} value={mode.value} title={mode.title}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {wantsSlot && (
          <label className="flex items-center gap-2">
            Slot
            <select
              value={gesture.slot}
              onChange={(e) => set({ slot: e.target.value as WardrobeItemType | '' })}
              disabled={disabled}
              className="qt-select qt-select-sm"
              aria-label="Wardrobe slot"
            >
              <option value="">{slotOptional ? 'every slot it covers' : 'choose a slot'}</option>
              {WARDROBE_SLOT_TYPES.map((slot) => (
                <option key={slot} value={slot}>
                  {WARDROBE_SLOT_META[slot].label}
                  {coupled && !covered.has(slot) ? ' (not covered)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {slotMismatches.map(({ item }) =>
        item && gesture.slot ? (
          <p key={item.id} className="text-xs qt-text-secondary" data-testid="wardrobe-slot-advisory">
            ⚠ &ldquo;{item.title}&rdquo; covers {formatSlotLabels(item.types)} — not{' '}
            {WARDROBE_SLOT_META[gesture.slot].label}
          </p>
        ) : null
      )}

      {wantsItems && (
        <div className="space-y-1">
          {items.map((item, index) => renderItemRow(item, index))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => set({ items: [...items, ''] })}
              disabled={disabled || items.length >= MAX_WARDROBE_EFFECT_ITEMS}
              title={items.length >= MAX_WARDROBE_EFFECT_ITEMS ? `At most ${MAX_WARDROBE_EFFECT_ITEMS} items` : undefined}
            >
              <Icon name="plus" className="w-3.5 h-3.5" />
              Add item
            </button>
            <span className="qt-hint">
              a title or id — <code className="font-mono">{'{{params.x}}'}</code> lets a parameter choose
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default SideEffectsSection
