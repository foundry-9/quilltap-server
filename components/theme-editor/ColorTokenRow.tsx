'use client'

/**
 * Calliope's Atelier — one colour token's row.
 *
 * Shows the value in force for the mode on display (swatch, and where it
 * comes from), a picker and a text field for light and for dark, a reset,
 * and the contrast of every pair the token is in.
 *
 * @module components/theme-editor/ColorTokenRow
 */

import { memo, useId, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ContrastFinding, ResolvedTheme, ThemeTokensDocument, TokenDef } from '@/lib/themes/engine/client'
import {
  clearDarkValue,
  isAcceptedColour,
  isOverridden,
  ownDarkValue,
  pickedValue,
  pickerHex,
  resetToken,
  rowContrast,
  rowModeView,
  setTokenValue,
  type EditorMode,
} from './model'

interface ColorTokenRowProps {
  token: TokenDef
  tokens: ThemeTokensDocument
  resolved: ResolvedTheme
  findings: readonly ContrastFinding[]
  mode: EditorMode
  onChange: (next: ThemeTokensDocument) => void
}

function Swatch({ literal, label }: { literal: string | null; label: string }) {
  return (
    <span
      role="img"
      aria-label={literal ? `${label}: ${literal}` : `${label}: does not come down to one colour`}
      className="inline-block w-6 h-6 rounded border qt-border-default flex-shrink-0"
      style={literal ? { background: literal } : undefined}
    />
  )
}

interface ModeFieldProps {
  token: TokenDef
  mode: EditorMode
  value: string
  literal: string | null
  disabled?: boolean
  onCommit: (value: string) => void
}

/** A picker and a text field for one mode. The text commits on Enter or blur, when it is a colour. */
function ModeField({ token, mode, value, literal, disabled, onCommit }: ModeFieldProps) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  const errorId = useId()
  const invalid = text.trim() !== value.trim() && !isAcceptedColour(text)
  const hex = pickerHex(literal)
  const modeName = mode === 'light' ? 'Light' : 'Dark'

  const commit = () => {
    const next = text.trim()
    if (next === value.trim()) return
    if (!isAcceptedColour(next)) return
    onCommit(next)
  }

  return (
    <div className="flex items-start gap-2 min-w-0">
      <input
        type="color"
        className="w-8 h-8 p-0 border qt-border-default rounded cursor-pointer flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        value={hex ?? '#000000'}
        disabled={disabled}
        aria-label={`${token.label}, ${modeName.toLowerCase()} colour picker`}
        onChange={(e) => onCommit(pickedValue(e.target.value, literal))}
      />
      <div className="min-w-0 flex-1">
        <input
          type="text"
          className="qt-input w-full font-mono qt-text-xs"
          value={text}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${token.label}, ${modeName.toLowerCase()} value`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
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
        {invalid && (
          <p id={errorId} className="qt-text-xs qt-text-destructive mt-1">
            Not a colour the atelier recognises; it will not be applied.
          </p>
        )}
      </div>
    </div>
  )
}

function ContrastLine({ finding, against, role }: ReturnType<typeof rowContrast>[number]) {
  const kind = finding.pair.kind
  const relation = role === 'foreground' ? `on ${against}` : `under ${against}`
  if (finding.status === 'unchecked') {
    return (
      <li className="qt-text-xs qt-text-muted">
        <span className="font-medium">Unchecked</span> {relation} ({kind}): {finding.reason}
      </li>
    )
  }
  const pass = finding.status === 'pass'
  return (
    <li className={`qt-text-xs ${pass ? 'qt-text-secondary' : 'qt-text-destructive'}`}>
      <Icon name={pass ? 'check' : 'alert-triangle'} className="inline w-3 h-3 mr-1 align-[-2px]" />
      <span className="font-medium">{pass ? 'Passes' : 'Falls short'}</span>{' '}
      {finding.ratio?.toFixed(2)}:1 {relation}, needs {finding.threshold}:1 ({kind})
    </li>
  )
}

function ColorTokenRowImpl({ token, tokens, resolved, findings, mode, onChange }: ColorTokenRowProps) {
  const descriptionId = useId()
  const shown = rowModeView(resolved, token.name, mode)
  const light = rowModeView(resolved, token.name, 'light')
  const dark = rowModeView(resolved, token.name, 'dark')
  const overridden = isOverridden(tokens, token.name)
  const ownDark = ownDarkValue(tokens, token.name)
  const sameAsLight = overridden ? ownDark === undefined : token.defaultDark === undefined
  const contrast = rowContrast(findings, token.name, mode)

  const toggleSameAsLight = (checked: boolean) => {
    if (checked) {
      onChange(overridden ? clearDarkValue(tokens, token.name) : setTokenValue(tokens, token.name, 'light', light.value))
    } else {
      onChange(setTokenValue(tokens, token.name, 'dark', dark.literal ?? dark.value))
    }
  }

  return (
    <li className="py-3 border-b qt-border-default last:border-b-0" aria-labelledby={`${descriptionId}-label`}>
      <div className="flex items-start gap-3">
        <Swatch literal={shown.literal} label={`${token.label} in ${mode}`} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p id={`${descriptionId}-label`} className="font-medium qt-text">{token.label}</p>
              <p className="qt-text-xs qt-text-muted font-mono">{token.name}</p>
              {token.description && (
                <p id={descriptionId} className="qt-text-xs qt-text-secondary mt-1">{token.description}</p>
              )}
              <p className="qt-text-xs qt-text-secondary mt-1">
                {shown.source.kind === 'theme' ? 'Set by this theme' : 'The house default'}
                {shown.follows && (
                  <>
                    {' · follows '}
                    <em>{shown.follows.label}</em>
                  </>
                )}
                {shown.literal && shown.literal !== shown.value && (
                  <span className="font-mono"> ({shown.literal})</span>
                )}
              </p>
            </div>
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => onChange(resetToken(tokens, token.name))}
              disabled={!overridden}
              aria-label={`Reset ${token.label} to the house default`}
            >
              <Icon name="refresh" className="w-4 h-4" />
              <span className="ml-1">Reset</span>
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="qt-text-label-xs mb-1">Light</p>
              <ModeField
                token={token}
                mode="light"
                value={light.value}
                literal={light.literal}
                onCommit={(v) => onChange(setTokenValue(tokens, token.name, 'light', v))}
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="qt-text-label-xs">Dark</p>
                <label className="qt-text-xs qt-text-secondary flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={sameAsLight}
                    onChange={(e) => toggleSameAsLight(e.target.checked)}
                  />
                  Same as light
                </label>
              </div>
              <ModeField
                token={token}
                mode="dark"
                value={dark.value}
                literal={dark.literal}
                disabled={sameAsLight}
                onCommit={(v) => onChange(setTokenValue(tokens, token.name, 'dark', v))}
              />
            </div>
          </div>

          {contrast.length > 0 && (
            <ul className="space-y-0.5" aria-label={`Contrast of ${token.label} in ${mode}`}>
              {contrast.map((c) => (
                <ContrastLine key={c.finding.pair.id} {...c} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}

export const ColorTokenRow = memo(ColorTokenRowImpl)
