'use client'

/**
 * SectionJump — the compact form of a page's section navigation: one select
 * that moves to the chosen section and returns to its prompt.
 *
 * A long list of section buttons beside a page body is the wide form; where
 * the container is too narrow for the two side by side, the list would sit
 * above the body and push it a screen down. This control stands in for the
 * list there and still reaches every section. The caller decides when each
 * form shows (a container query on the two wrappers).
 */

import { useId } from 'react'

export interface SectionJumpOption {
  id: string
  label: string
  /** Extra words for the option, such as "3 set by this theme". */
  note?: string
}

export interface SectionJumpProps {
  /** The visible label, e.g. "Go to a section". */
  label: string
  options: readonly SectionJumpOption[]
  onJump: (id: string) => void
  /** Shown when there is nothing to choose. */
  emptyText?: string
  className?: string
}

export function SectionJump({ label, options, onJump, emptyText, className }: SectionJumpProps) {
  const id = useId()
  if (options.length === 0) {
    return emptyText ? <p className={`qt-text-xs qt-text-muted ${className ?? ''}`}>{emptyText}</p> : null
  }
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <label htmlFor={id} className="qt-text-small whitespace-nowrap">{label}</label>
      <select
        id={id}
        className="qt-select qt-select-sm min-w-0 flex-1"
        value=""
        onChange={(e) => {
          const next = e.target.value
          if (next) onJump(next)
        }}
      >
        <option value="" disabled>Choose…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.note ? `${option.label} (${option.note})` : option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
