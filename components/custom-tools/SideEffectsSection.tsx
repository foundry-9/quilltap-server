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
 */

import { Icon } from '@/components/ui/icon'
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
} from '@/lib/pascal/tool-draft'
import { WARDROBE_SLOT_META, WARDROBE_SLOT_TYPES, type WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface SideEffectsSectionProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  disabled?: boolean
}

const OUTCOME_STATES: readonly OutcomeState[] = ['success', 'partial', 'failure', 'info'] as const

/** The When select's flat values; 'verbatim' never appears as an option. */
type WhenChoice = 'always' | OutcomeState

function whenChoiceOf(effect: DraftEffect): WhenChoice | 'verbatim' {
  if (effect.when.kind === 'always') return 'always'
  if (effect.when.kind === 'outcome-state') return effect.when.state
  return 'verbatim'
}

export function SideEffectsSection({ draft, issues, onChange, disabled = false }: Readonly<SideEffectsSectionProps>) {
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

interface WardrobeFieldsProps {
  gesture: DraftWardrobeGesture
  hasErrors: boolean
  disabled: boolean
  onChange: (next: DraftWardrobeGesture) => void
}

/** A wardrobe row's fields: action, items, and the mode and slot when the action wants them. */
function WardrobeFields({ gesture, hasErrors, disabled, onChange }: Readonly<WardrobeFieldsProps>) {
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
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {wantsItems && (
        <div className="space-y-1">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
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
              <button
                type="button"
                className="qt-button qt-button-ghost qt-button-sm"
                onClick={() => removeItem(index)}
                disabled={disabled || items.length <= 1}
                title="Remove this item"
              >
                <Icon name="trash" className="w-4 h-4" />
              </button>
            </div>
          ))}
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
