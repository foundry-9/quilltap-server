'use client'

/**
 * ReferenceRows — the item list of a wardrobe or an Inventory side effect:
 * one row per reference, at least one row, up to `max`.
 *
 * A reference the vantage resolves renders as the caller's chip; any other
 * keeps its text box, with an advisory when the vantage has been read and
 * did not find it (never an error — the lens is partial and the applier
 * fail-soft), the *Choose…* button and the trash. A templated reference is
 * chosen at run time and says so. Which references count as templated, and
 * how one resolves, are the family's own rules, passed in.
 *
 * @module components/custom-tools/ReferenceRows
 */

import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'

/** `refs` with row `index` set to `value` — an empty list is one blank row. */
export function withRefAt(refs: readonly string[], index: number, value: string): string[] {
  const rows = refs.length > 0 ? refs : ['']
  return rows.map((ref, i) => (i === index ? value : ref))
}

interface ReferenceRowsProps<T> {
  /** The references as the draft holds them (an empty list shows one blank row). */
  refs: readonly string[]
  onChange: (next: string[]) => void
  /** The item a row's reference names, or undefined (the family's own lookup). */
  resolve: (ref: string, index: number) => T | undefined
  /** Whether a reference is a template, filled at run time. */
  isTemplated: (ref: string) => boolean
  /** The chip for a resolved row; `trash` is the row's remove button, `setRef` rewrites its reference. */
  renderResolved: (row: { item: T; ref: string; index: number; trash: ReactNode; setRef: (value: string) => void }) => ReactNode
  /** The vantage has been chosen and read, so a reference it did not resolve may be called unresolved. */
  canFlagUnresolved: boolean
  unresolvedText: string
  unresolvedTestId: string
  onChoose: (index: number) => void
  max: number
  maxLength: number
  hasErrors: boolean
  disabled: boolean
  placeholder: (index: number) => string
  /** The text box's name: "Item 1", "Object 2". */
  inputLabel: (index: number) => string
  removeTitle: string
  chooseTitle: string
  addLabel: string
  /** The add button's title once `max` is reached. */
  atMaxTitle: string
  /** What a reference may be, in words, before "— {{params.x}} lets a parameter choose". */
  hintLead: string
}

export function ReferenceRows<T>({
  refs,
  onChange,
  resolve,
  isTemplated,
  renderResolved,
  canFlagUnresolved,
  unresolvedText,
  unresolvedTestId,
  onChoose,
  max,
  maxLength,
  hasErrors,
  disabled,
  placeholder,
  inputLabel,
  removeTitle,
  chooseTitle,
  addLabel,
  atMaxTitle,
  hintLead,
}: Readonly<ReferenceRowsProps<T>>) {
  const rows = refs.length > 0 ? [...refs] : ['']
  const setRef = (index: number, value: string) => onChange(withRefAt(rows, index, value))
  const removeRef = (index: number) => {
    const next = rows.filter((_, i) => i !== index)
    onChange(next.length > 0 ? next : [''])
  }

  const renderRow = (ref: string, index: number) => {
    const trash = (
      <button
        type="button"
        className="qt-button qt-button-ghost qt-button-sm"
        onClick={() => removeRef(index)}
        disabled={disabled || rows.length <= 1}
        title={removeTitle}
        aria-label={removeTitle}
      >
        <Icon name="trash" className="w-4 h-4" />
      </button>
    )
    const item = resolve(ref, index)
    if (item !== undefined) {
      return renderResolved({ item, ref, index, trash, setRef: (value) => setRef(index, value) })
    }

    const templated = isTemplated(ref)
    const unresolved = !templated && canFlagUnresolved && ref.trim() !== ''
    return (
      <div key={index} className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={ref}
            maxLength={maxLength}
            onChange={(e) => setRef(index, e.target.value)}
            placeholder={placeholder(index)}
            disabled={disabled}
            className={`qt-input flex-1 min-w-48 ${hasErrors ? 'qt-input-error' : ''}`}
            aria-label={inputLabel(index)}
          />
          {unresolved && (
            <span className="qt-badge qt-badge-secondary" data-testid={unresolvedTestId}>
              {unresolvedText}
            </span>
          )}
          <button
            type="button"
            className="qt-button qt-button-secondary qt-button-sm"
            onClick={() => onChoose(index)}
            disabled={disabled}
            title={chooseTitle}
          >
            Choose…
          </button>
          {trash}
        </div>
        {templated && <p className="qt-hint">chosen at run time</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {rows.map((ref, index) => renderRow(ref, index))}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="qt-button qt-button-ghost qt-button-sm"
          onClick={() => onChange([...rows, ''])}
          disabled={disabled || rows.length >= max}
          title={rows.length >= max ? atMaxTitle : undefined}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          {addLabel}
        </button>
        <span className="qt-hint">
          {hintLead} — <code className="font-mono">{'{{params.x}}'}</code> lets a parameter choose
        </span>
      </div>
    </div>
  )
}

export default ReferenceRows
