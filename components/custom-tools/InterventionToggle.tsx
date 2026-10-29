'use client'

/**
 * InterventionToggle — the small raised hand beside a Workbench field's label.
 *
 * Pressed means the field is shown to the operator in the hold dialog; unpressed
 * means it is kept out of sight. `ToolFieldInterventionToggle` is the tool-level
 * wrapper: it reads and writes `draft.intervention.fields[key]`, and renders
 * nothing while the master switch is off (the per-field values stay in the
 * draft regardless).
 */

import { Icon } from '@/components/ui/icon'
import type { InterventionFieldKey } from '@/lib/pascal/custom-tool.types'
import type { ToolDraft } from '@/lib/pascal/tool-draft'

interface InterventionToggleProps {
  /** True when this field is shown in the hold dialog. */
  shown: boolean
  onChange: (next: boolean) => void
  /** Accessible name, e.g. "Show the roll in the hold dialog". */
  label: string
  disabled?: boolean
}

export function InterventionToggle({ shown, onChange, label, disabled = false }: Readonly<InterventionToggleProps>) {
  const tooltip = shown ? `${label} (shown)` : `${label} (hidden)`
  return (
    <button
      type="button"
      className={`qt-intervene-toggle${shown ? '' : ' qt-intervene-toggle--off'}`}
      aria-pressed={shown}
      aria-label={label}
      title={tooltip}
      disabled={disabled}
      onClick={() => onChange(!shown)}
    >
      <Icon name="hand-raised" className="w-3.5 h-3.5" />
    </button>
  )
}

interface ToolFieldInterventionToggleProps {
  draft: ToolDraft
  onChange: (next: ToolDraft) => void
  fieldKey: InterventionFieldKey
  label: string
  disabled?: boolean
}

/** Whether a tool-level field is shown (absent key = shown). */
export function isToolFieldShown(draft: ToolDraft, key: InterventionFieldKey): boolean {
  return draft.intervention.fields[key] !== false
}

/** A new draft with a tool-level field shown or hidden; showing deletes the key. */
export function withToolFieldShown(draft: ToolDraft, key: InterventionFieldKey, shown: boolean): ToolDraft {
  const fields = { ...draft.intervention.fields }
  if (shown) delete fields[key]
  else fields[key] = false
  return { ...draft, intervention: { ...draft.intervention, fields } }
}

export function ToolFieldInterventionToggle({
  draft,
  onChange,
  fieldKey,
  label,
  disabled = false,
}: Readonly<ToolFieldInterventionToggleProps>) {
  if (!draft.intervention.enabled) return null
  return (
    <InterventionToggle
      shown={isToolFieldShown(draft, fieldKey)}
      onChange={(next) => onChange(withToolFieldShown(draft, fieldKey, next))}
      label={label}
      disabled={disabled}
    />
  )
}
