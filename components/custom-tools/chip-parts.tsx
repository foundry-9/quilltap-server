'use client'

/**
 * Small parts the Workbench's condition chips and fields share: the key box
 * of a metadata / progress / Inventory test, the fail-soft hint beside it, the
 * read-only badge for a `$state` / `$inventory` reference (or any value the
 * form can only show), and the parameter-reference select.
 *
 * Each caller supplies its own words; these hold the markup, so the outcome
 * table, the availability gate and the roll fields draw them alike.
 *
 * @module components/custom-tools/chip-parts
 */

import type { ReactNode } from 'react'

/** The derived fields a `progress` key may name, as the key boxes' titles list them. */
export const PROGRESS_KEY_FIELDS =
  'percent, complete, remainingMs, state, started, elapsedMs, startTime, endTime, name, elapsed, remaining, quantity, public'

/** A progress key box's title; `ending` says what a progression the character lacks does to the test. */
export function progressKeyTitle(ending: string): string {
  return `A progression of the invoking character, keyed "<id>.<field>" — ${PROGRESS_KEY_FIELDS}. A progression they do not carry ${ending}.`
}

interface SubjectKeyFieldProps {
  value: string
  onChange: (key: string) => void
  disabled: boolean
  placeholder: string
  title: string
  ariaLabel: string
}

/** The key a chip tests: flagged while blank, since a test of nothing never holds. */
export function SubjectKeyField({ value, onChange, disabled, placeholder, title, ariaLabel }: Readonly<SubjectKeyFieldProps>) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`qt-input w-44 text-sm ${value.trim() === '' ? 'qt-input-error' : ''}`}
      aria-label={ariaLabel}
      title={title}
    />
  )
}

/** The ⓘ beside a test that declines, rather than errs, when the stored value is the wrong type. */
export function FailSoftHint({ title }: Readonly<{ title: string }>) {
  return (
    <span className="text-xs qt-text-secondary" title={title}>
      ⓘ
    </span>
  )
}

/** A value the form shows but does not author (a `$state` reference, a hand-written condition). */
export function RawRefBadge({ title, hasError = false, children }: Readonly<{ title: string; hasError?: boolean; children: ReactNode }>) {
  return (
    <span
      className={`qt-text-xs qt-text-secondary font-mono rounded qt-bg-muted px-2 py-1${hasError ? ' qt-input-error' : ''}`}
      title={title}
    >
      {children}
    </span>
  )
}

interface ParamRefSelectProps {
  /** The parameter referenced now; kept as an option even when it is no longer eligible. */
  value: string
  /** The parameters eligible for reference. */
  names: readonly string[]
  onChange: (name: string) => void
  disabled: boolean
  ariaLabel: string
  hasError?: boolean
}

/** Choose the parameter a `$param` reference names. */
export function ParamRefSelect({ value, names, onChange, disabled, ariaLabel, hasError = false }: Readonly<ParamRefSelectProps>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`qt-select qt-select-sm w-28${hasError ? ' qt-input-error' : ''}`}
      aria-label={ariaLabel}
    >
      {!names.includes(value) && <option value={value}>{value || '—'}</option>}
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}
