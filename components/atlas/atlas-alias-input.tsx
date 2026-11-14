'use client'

/**
 * The Atlas editor's alias field — a token input. Typing a word and pressing
 * Enter or a comma adds it as an alias; Backspace in an empty field takes the
 * last one off; each alias carries its own remove button. Pasting
 * `lander, car` adds both. A word already present (any case) is not added
 * twice, and neither is the entry's own name. Leaving the field adds what was
 * typed, so nothing is lost to a click on Save.
 *
 * Fully keyboard-operable: the field and every remove button are in the tab
 * order, the field is labelled by a visible `<label>`, and its keys are
 * described to assistive technology through `aria-describedby`.
 *
 * @module components/atlas/atlas-alias-input
 */

import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ATLAS_MAX_ALIASES } from '@/lib/schemas/atlas.types'

export interface AtlasAliasInputProps {
  /** The `id` of the text field (the visible label's `htmlFor`). */
  id: string
  label: string
  aliases: string[]
  onChange: (aliases: string[]) => void
  /** The entry's canonical name; an alias equal to it is never added. */
  name?: string
  disabled?: boolean
}

const fold = (term: string): string => term.trim().toLocaleLowerCase()

/** Append the comma-separated words of `text` to `aliases`, skipping repeats and the name. */
export function addAliasTerms(aliases: readonly string[], text: string, name = ''): string[] {
  const seen = new Set(aliases.map(fold))
  if (name.trim()) seen.add(fold(name))
  const out = [...aliases]
  for (const raw of text.split(',')) {
    const term = raw.trim()
    if (!term || seen.has(fold(term)) || out.length >= ATLAS_MAX_ALIASES) continue
    seen.add(fold(term))
    out.push(term)
  }
  return out
}

export function AtlasAliasInput({ id, label, aliases, onChange, name = '', disabled = false }: AtlasAliasInputProps) {
  const [text, setText] = useState('')
  const hintId = useId()

  const commit = (value: string): void => {
    if (!value.trim()) {
      setText('')
      return
    }
    const next = addAliasTerms(aliases, value, name)
    if (next.length !== aliases.length) onChange(next)
    setText('')
  }

  const removeAt = (index: number): void => onChange(aliases.filter((_, i) => i !== index))

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit(text)
      return
    }
    if (event.key === 'Backspace' && text === '' && aliases.length > 0) {
      event.preventDefault()
      removeAt(aliases.length - 1)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData('text')
    if (!pasted.includes(',')) return
    event.preventDefault()
    commit(`${text}${pasted}`)
  }

  return (
    <div className="space-y-1">
      <label className="text-sm qt-text" htmlFor={id}>{label}</label>
      <p id={hintId} className="qt-text-xs qt-text-secondary">
        Other words it answers to — &ldquo;lander&rdquo;, &ldquo;the car&rdquo;. Press Enter or a comma after each; Backspace in an
        empty field takes the last one off. Plurals are yours to add.
      </p>
      <div className="flex flex-wrap items-center gap-1 rounded border qt-border-default px-2 py-1">
        {aliases.length > 0 && (
          <ul className="flex flex-wrap items-center gap-1" aria-label={`${label}: ${aliases.length}`}>
            {aliases.map((alias, index) => (
              <li key={`${alias}-${index}`} className="qt-badge qt-badge-secondary inline-flex items-center gap-1">
                <span>{alias}</span>
                <button
                  type="button"
                  className="qt-button-ghost qt-button-sm leading-none px-1"
                  aria-label={`Remove alias ${alias}`}
                  title={`Remove alias ${alias}`}
                  disabled={disabled}
                  onClick={() => removeAt(index)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id={id}
          type="text"
          className="qt-input qt-input-sm flex-1 min-w-[8rem] border-0"
          value={text}
          disabled={disabled}
          aria-describedby={hintId}
          placeholder={aliases.length === 0 ? 'lander, car, dinghy' : ''}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(text)}
        />
      </div>
    </div>
  )
}
