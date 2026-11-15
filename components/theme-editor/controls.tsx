'use client'

/**
 * Calliope's Atelier — the value controls, keyed by token type.
 *
 * A row (`TokenRow`) owns everything rows share and takes the control for
 * one mode's value from `ValueControl`, which picks by type. Colour has a picker beside its
 * text; every other type has, for now, the text control, checked by the
 * engine's type check — the same message the server would give, and a value
 * that fails it is not applied.
 *
 * @module components/theme-editor/controls
 */

import { useId, useState, type ReactNode } from 'react'
import type { TokenDef, TokenType } from '@/lib/themes/engine/client'
import { pickedValue, pickerHex, rowProblem, type EditorMode } from './model'

export interface ControlProps {
  token: TokenDef
  mode: EditorMode
  /** The value as written (empty for an unset optional token). */
  value: string
  /** The value with references substituted, when it resolves. */
  literal: string | null
  /** Shown in an empty field: what "unset" means for an optional token. */
  placeholder?: string
  onCommit: (value: string) => void
}

const modeWord = (mode: EditorMode) => (mode === 'light' ? 'light' : 'dark')

/** Why typed `text` will not be applied as `token`'s value, or null when it will. */
function refusal(token: TokenDef, text: string): string | null {
  const problem = rowProblem(token, text)
  if (!problem) return null
  return token.type === 'color'
    ? 'Not a colour the atelier recognises; it will not be applied.'
    : `The atelier demurs: ${problem}. It will not be applied.`
}

/**
 * A text field for one mode's value. It commits on Enter or when it loses
 * focus, and only text the type check accepts; Escape puts back the value in
 * force. A value changed elsewhere (undo, a reload) replaces what it shows.
 */
export function TextControl({ token, mode, value, placeholder, onCommit }: ControlProps) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  const errorId = useId()
  const edited = text.trim() !== value.trim()
  const message = edited && text.trim() !== '' ? refusal(token, text) : null

  const commit = () => {
    const next = text.trim()
    if (!edited) return
    if (next === '' || refusal(token, next)) {
      if (next === '') setText(value)
      return
    }
    onCommit(next)
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        type="text"
        className="qt-input w-full font-mono qt-text-xs"
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={`${token.label}, ${modeWord(mode)} value`}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? errorId : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setText(value)
          }
        }}
      />
      {message && (
        <p id={errorId} className="qt-text-xs qt-text-destructive mt-1">
          {message}
        </p>
      )}
    </div>
  )
}

/** A colour picker beside the text field. The picker keeps the alpha of the value it replaces. */
export function ColorControl(props: ControlProps) {
  const { token, mode, literal, onCommit } = props
  const hex = pickerHex(literal)
  return (
    <div className="flex items-start gap-2 min-w-0">
      <input
        type="color"
        className="w-8 h-8 p-0 border qt-border-default rounded cursor-pointer flex-shrink-0"
        value={hex ?? '#000000'}
        aria-label={`${token.label}, ${modeWord(mode)} colour picker`}
        onChange={(e) => onCommit(pickedValue(e.target.value, literal))}
      />
      <TextControl {...props} />
    </div>
  )
}

const CONTROLS: Partial<Record<TokenType, (props: ControlProps) => ReactNode>> = {
  color: (props) => <ColorControl {...props} />,
}

/** The control for the token's type: its own where it has one, the text control otherwise. */
export function ValueControl(props: ControlProps) {
  return CONTROLS[props.token.type]?.(props) ?? <TextControl {...props} />
}
