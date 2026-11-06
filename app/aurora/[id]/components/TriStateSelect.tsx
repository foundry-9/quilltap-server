'use client'

/**
 * A per-character tri-state (inherit / on / off) as a labelled select that
 * saves on change, and says what *Inherit* currently resolves to — from the
 * live global setting where there is one, else the built-in default — rather
 * than a hard-coded "(enabled)" in the option label.
 *
 * @module app/aurora/[id]/components/TriStateSelect
 */

import { useId, type ReactNode } from 'react'

export interface TriStateSelectProps {
  label: string
  description: ReactNode
  value: boolean | null | undefined
  /** What *Inherit* resolves to right now, or null while unknown. */
  inherited: boolean | null
  /** Where the inherited value comes from ("the Chat settings", "the house default"). */
  inheritedFrom: string
  onLabel?: string
  offLabel?: string
  disabled?: boolean
  onChange: (value: boolean | null) => void
}

export function TriStateSelect({
  label,
  description,
  value,
  inherited,
  inheritedFrom,
  onLabel = 'Enabled',
  offLabel = 'Disabled',
  disabled,
  onChange,
}: TriStateSelectProps) {
  const id = useId()
  const current = value === true ? 'on' : value === false ? 'off' : 'inherit'
  const inheritedText =
    inherited === null ? '' : ` — currently ${inherited ? onLabel.toLowerCase() : offLabel.toLowerCase()}`
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block qt-text-label">
        {label}
      </label>
      <p className="text-xs qt-text-secondary">{description}</p>
      <select
        id={id}
        value={current}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === 'on' ? true : v === 'off' ? false : null)
        }}
        className="qt-select max-w-md"
      >
        <option value="inherit">Inherit{inheritedText}</option>
        <option value="on">{onLabel}</option>
        <option value="off">{offLabel}</option>
      </select>
      {current === 'inherit' && inherited !== null && (
        <p className="text-xs qt-text-secondary">
          Inherited from {inheritedFrom}: {inherited ? onLabel.toLowerCase() : offLabel.toLowerCase()}.
        </p>
      )}
    </div>
  )
}

/** A labelled checkbox that saves on change. */
export function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <label htmlFor={id} className="block qt-text-label">
          {label}
        </label>
        <div className="text-xs qt-text-secondary mt-1">{description}</div>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 flex-shrink-0 qt-accent-primary"
      />
    </div>
  )
}
