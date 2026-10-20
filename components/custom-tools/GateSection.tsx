'use client'

/**
 * GateSection — who may reach for this tool at all.
 *
 * The outcome table decides what happens once a tool is run; this decides
 * whether a character is offered it in the first place. Three modes, exclusive
 * by construction (the format admits at most one clause): anyone may reach for
 * it, only those whose fact sheet passes, or everyone except those whose fact
 * sheet passes.
 *
 * The chips are deliberately thinner than the outcome table's. A gate is
 * answered before the deal, so there are no parameters to compare against and
 * no roll to test — every subject is a metadata key, a progress field, an
 * Inventory object named literally, or an aggregate over the bag, and every
 * operand is a literal, and the widget offers exactly that and nothing more.
 *
 * Chips on one line AND together; an OR toggle starts a new line, and any line
 * that holds decides the gate.
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CONTAINMENT_KEYS, ORDERING_KEYS, type ComparatorKey } from '@/lib/pascal/custom-tool.types'
import {
  gateConditionSlotKey,
  groupsOf,
  nextDraftId,
  reseatOperandForComparator,
  type DraftGateCondition,
  type DraftIssue,
  type GateMode,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { COMPARATOR_LABELS } from './comparator-labels'
import { LiteralOperandField } from './LiteralOperandField'
import { INVENTORY_STATE_VALUES } from '@/lib/pascal/inventory-subjects'
import { ConditionGroups } from './ConditionGroups'
import { AggregateKeyField } from './AggregateKeyField'

interface GateSectionProps {
  draft: ToolDraft
  issues: DraftIssue[]
  onChange: (next: ToolDraft) => void
  disabled?: boolean
}

const MODE_OPTIONS: Array<{ mode: GateMode; label: string; title: string }> = [
  { mode: 'none', label: 'Anyone', title: 'Every character in the scene is offered this tool' },
  {
    mode: 'available',
    label: 'Only show if…',
    title: 'Offer it only to a character whose fact sheet passes every test below',
  },
  {
    mode: 'withheld',
    label: 'Do not show if…',
    title: 'Withhold it from a character whose fact sheet passes every test below',
  },
]

/** Every comparator is on offer: a metadata key's stored type is unknowable here. */
const COMPARATORS: ComparatorKey[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains', 'ncontains']

/**
 * What each subject may be asked: a state is = / ≠, a count is a number. An
 * aggregate offers everything; whether its key is a list or a number is the
 * validator's to flag, beside the chip.
 */
function comparatorsFor(subject: DraftGateCondition['subject']): ComparatorKey[] {
  if (subject === 'inventory') return ['eq', 'neq']
  if (subject === 'inventoryCount') return ['gt', 'gte', 'lt', 'lte', 'eq', 'neq']
  return COMPARATORS
}

/** The same chip on a new subject, its comparator and operand made legal there. */
function withSubject(condition: DraftGateCondition, subject: DraftGateCondition['subject']): DraftGateCondition {
  if (subject === 'inventory') {
    const comparator = condition.comparator === 'neq' ? 'neq' : 'eq'
    const keep =
      condition.operand.kind === 'string' &&
      (INVENTORY_STATE_VALUES as readonly string[]).includes(condition.operand.text)
    return { ...condition, subject, comparator, operand: keep ? condition.operand : { kind: 'string', text: 'equipped' } }
  }
  if (subject === 'inventoryCount') {
    const comparator = CONTAINMENT_KEYS.has(condition.comparator) ? 'gte' : condition.comparator
    const operand = condition.operand.kind === 'number' ? condition.operand : { kind: 'number' as const, text: '1' }
    return { ...condition, subject, comparator, operand }
  }
  return { ...condition, subject }
}

export function GateSection({ draft, issues, onChange, disabled = false }: Readonly<GateSectionProps>) {
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null)

  const gateIssues = issues.filter((issue) => issue.severity === 'error' && issue.where.section === 'gate')
  const sectionErrors = gateIssues
    .filter((issue) => issue.where.section === 'gate' && issue.where.conditionId === undefined)
    .map((issue) => issue.message)
  const conditionErrorIds = new Set(
    gateIssues
      .map((issue) => (issue.where.section === 'gate' ? issue.where.conditionId : undefined))
      .filter((id): id is string => id !== undefined)
  )

  const setConditions = (gateConditions: DraftGateCondition[]) => onChange({ ...draft, gateConditions })

  const setMode = (gateMode: GateMode) => {
    setDuplicateNotice(null)
    // Conditions survive a mode change, exactly as the roll fields survive a
    // form change: flipping "only if" to "not if" is the commonest edit there
    // is, and retyping the tests to make it would be a poor joke.
    onChange({ ...draft, gateMode })
  }

  const addCondition = () => {
    setDuplicateNotice(null)
    setConditions([
      ...draft.gateConditions,
      {
        id: nextDraftId('new-gate'),
        subject: 'metadata',
        key: '',
        comparator: 'eq',
        operand: { kind: 'boolean', value: true },
      },
    ])
  }

  const updateCondition = (id: string, next: DraftGateCondition) => {
    // One comparator object carries each key once, so a duplicate key+comparator
    // pair on one line is blocked at the door rather than silently overwriting
    // its twin. Another line is another object, and may repeat it.
    const slot = gateConditionSlotKey(next)
    const line = groupsOf(draft.gateConditions).find((group) => group.some((c) => c.id === id)) ?? []
    const collision = line.some((c) => c.id !== id && c.subject === next.subject && gateConditionSlotKey(c) === slot)
    if (collision) {
      setDuplicateNotice(`A line of the gate can test “${next.key}” with ${COMPARATOR_LABELS[next.comparator]} only once.`)
      return
    }
    setDuplicateNotice(null)
    setConditions(draft.gateConditions.map((c) => (c.id === id ? next : c)))
  }

  const deleteCondition = (id: string) => {
    setDuplicateNotice(null)
    setConditions(draft.gateConditions.filter((c) => c.id !== id))
  }

  return (
    <section className="qt-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="qt-card-title text-sm">Who may reach for it</h2>
          <p className="qt-hint">
            Tested before the deal, against the invoking character&rsquo;s <code>metadata.json</code>, their timed
            progressions, or what they carry in this chat — the only things known before a roll exists.
          </p>
        </div>
        <div className="flex rounded overflow-hidden border" role="radiogroup" aria-label="Availability">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={draft.gateMode === option.mode}
              onClick={() => setMode(option.mode)}
              disabled={disabled}
              title={option.title}
              className={`px-3 py-1 text-sm ${
                draft.gateMode === option.mode ? 'qt-button qt-button-primary' : 'qt-button qt-button-ghost'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {draft.gateMode === 'none' ? (
        <p className="text-xs qt-text-secondary">
          Every character in the scene is offered this tool. Set a condition and it becomes theirs alone — the model
          is never told a withheld tool exists, and the composer popup does not list it.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs qt-text-secondary">
            {draft.gateMode === 'available'
              ? 'Offered only to a character whose sheet passes the tests below:'
              : 'Withheld from a character whose sheet passes the tests below:'}
          </p>

          <ConditionGroups
            conditions={draft.gateConditions}
            disabled={disabled}
            onJoinerChange={(id, joiner) => {
              setDuplicateNotice(null)
              setConditions(draft.gateConditions.map((c) => (c.id === id ? { ...c, joiner } : c)))
            }}
            renderChip={(condition) => (
              <GateChip
                condition={condition}
                hasError={conditionErrorIds.has(condition.id)}
                disabled={disabled}
                onChange={(next) => updateCondition(condition.id, next)}
                onDelete={() => deleteCondition(condition.id)}
              />
            )}
          />

          {duplicateNotice && <p className="text-xs qt-text-destructive">{duplicateNotice}</p>}
          {sectionErrors.map((message) => (
            <p key={message} className="text-xs qt-text-destructive">
              {message}
            </p>
          ))}

          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={addCondition}
            disabled={disabled}
          >
            <Icon name="plus" className="w-3 h-3" />
            add condition
          </button>

          <p className="qt-hint">Tests on one line must all hold; any line that holds opens the door.</p>
          <p className="qt-hint">
            A key the character lacks never matches. So an &ldquo;only show if&rdquo; withholds the tool from a
            character with no sheet at all, while a &ldquo;do not show if&rdquo; still offers it to them.
          </p>
        </div>
      )}
    </section>
  )
}

interface GateChipProps {
  condition: DraftGateCondition
  hasError: boolean
  disabled: boolean
  onChange: (next: DraftGateCondition) => void
  onDelete: () => void
}

function GateChip({ condition, hasError, disabled, onChange, onDelete }: Readonly<GateChipProps>) {
  const ordering = ORDERING_KEYS.has(condition.comparator)
  const containment = CONTAINMENT_KEYS.has(condition.comparator)
  const inventorySubject = condition.subject === 'inventory' || condition.subject === 'inventoryCount'
  const aggregateSubject = condition.subject === 'inventoryAggregate'

  const handleComparatorChange = (comparator: ComparatorKey) =>
    onChange({ ...condition, comparator, operand: reseatOperandForComparator(condition.operand, comparator) })

  return (
    <div className={`flex items-center gap-1 flex-wrap rounded border px-2 py-1 ${hasError ? 'qt-input-error' : ''}`}>
      <select
        value={condition.subject}
        onChange={(e) => onChange(withSubject(condition, e.target.value as DraftGateCondition['subject']))}
        disabled={disabled}
        className="qt-select qt-select-sm w-28 shrink-0"
        aria-label="Gate subject"
        title="Which sheet this test reads: the character's own metadata.json, their derived progressions, or what they carry."
      >
        <option value="metadata">metadata</option>
        <option value="progress">progress</option>
        <option value="inventory">inventory state</option>
        <option value="inventoryCount">inventory count</option>
        <option value="inventoryAggregate">inventory aggregate</option>
      </select>

      {aggregateSubject ? (
        <AggregateKeyField
          value={condition.key}
          onChange={(key) => onChange({ ...condition, key })}
          disabled={disabled}
        />
      ) : (
        <input
          type="text"
          value={condition.key}
          onChange={(e) => onChange({ ...condition, key: e.target.value })}
          placeholder={
            condition.subject === 'progress'
              ? 'cannon.complete'
              : inventorySubject
                ? 'Excalibur'
                : "key on the character's fact sheet"
          }
          disabled={disabled}
          className={`qt-input w-44 text-sm ${condition.key.trim() === '' ? 'qt-input-error' : ''}`}
          aria-label={condition.subject === 'progress' ? 'Progress key' : inventorySubject ? 'Inventory object reference' : 'Metadata key'}
          title={
            condition.subject === 'progress'
              ? 'A progression of the invoking character, keyed "<id>.<field>" — percent, complete, remainingMs, state, started, elapsedMs, startTime, endTime, name, elapsed, remaining, quantity. A progression they do not carry never matches.'
              : inventorySubject
                ? 'An object by id, title or name, written literally — a gate has no parameters to fill a placeholder. With no character or chat, the test never matches.'
                : "The invoking character's fact sheet — a key the character lacks never matches."
          }
        />
      )}

      <select
        value={condition.comparator}
        onChange={(e) => handleComparatorChange(e.target.value as ComparatorKey)}
        disabled={disabled}
        // `.qt-select` is w-full, so the width is pinned here — otherwise an
        // eight-item comparator dropdown stretches across the whole chip and
        // shoves the operand onto a line of its own.
        className="qt-select qt-select-sm w-32 shrink-0"
        aria-label="Comparator"
      >
        {comparatorsFor(condition.subject).map((key) => (
          <option key={key} value={key}>
            {COMPARATOR_LABELS[key]}
          </option>
        ))}
      </select>

      {/* eq/neq alone need a type picker: with the stored type unknowable, only
          the author can say whether they mean 3, "3", or true. */}
      <LiteralOperandField
        operand={condition.operand}
        onChange={(operand) => onChange({ ...condition, operand })}
        disabled={disabled}
        showTypePicker={!ordering && !containment && !inventorySubject}
        pickerClassName="w-24 shrink-0"
        textClassName="w-32"
        {...(condition.subject === 'inventory' ? { stateOptions: INVENTORY_STATE_VALUES } : {})}
      />

      {(ordering || containment) && !inventorySubject && !aggregateSubject && (
        <span
          className="text-xs qt-text-secondary"
          title={
            ordering
              ? 'Matches only when the stored value is a number — anything else fails the test, fail-soft, never an error.'
              : 'Matches only when the stored value is text — anything else fails the test, fail-soft, never an error.'
          }
        >
          ⓘ
        </span>
      )}

      <button
        type="button"
        className="qt-button qt-button-ghost qt-button-sm"
        onClick={onDelete}
        disabled={disabled}
        title="Remove this condition"
        aria-label="Remove this condition"
      >
        <Icon name="close" className="w-3 h-3" />
      </button>
    </div>
  )
}

export default GateSection
