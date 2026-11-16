'use client'

/**
 * Calliope's Atelier — one token's row, for any type.
 *
 * What every row shares lives here: the label, name and help, where the
 * value comes from (the default, a choice, this theme, or unset), what it
 * follows and the means to point it at a primitive or give it a value of
 * its own, reset, the dark value apart from light, the type check of the
 * value in force, and — for colours — the swatch and the contrast of each
 * pair. The value itself is edited by the control for the token's type
 * (`ValueControl`).
 *
 * The row reads its view from the editor store, not from props, so an edit
 * elsewhere re-renders it only when its own view changes; edits go back
 * through `edit` as functions from the snapshot to a tokens document.
 *
 * @module components/theme-editor/TokenRow
 */

import { memo, useCallback, useId } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ThemeTokensDocument, TokenDef } from '@/lib/themes/engine/client'
import { ValueControl } from './controls'
import { useEditorSelector, type EditorStore } from './editor-store'
import {
  detachToLiteral,
  followPrimitive,
  joinDarkToLight,
  keywordOptions,
  resetToken,
  rowContrast,
  separateDarkValue,
  tokenRowDomId,
  setTokenValue,
  tokenRowView,
  type EditorMode,
  type EditorSnapshot,
  type RowModeView,
  type RowSource,
} from './model'

/** Apply an edit: `key` names what changed (edits of one key in quick succession undo as one). */
export type EditFn = (key: string, change: (snapshot: EditorSnapshot) => ThemeTokensDocument) => void

interface TokenRowProps {
  token: TokenDef
  store: EditorStore
  edit: EditFn
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

function sourceText(source: RowSource): string {
  switch (source.kind) {
    case 'theme':
      return 'Set by this theme'
    case 'choice':
      return `Set by the ${source.choiceLabel.toLowerCase()} choice (${source.option})`
    case 'unset':
      return 'Left unset: each place keeps its own manner'
    default:
      return 'The house default'
  }
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

const OWN_VALUE = ''

interface ModeBlockProps {
  token: TokenDef
  mode: EditorMode
  view: RowModeView
  primitives: readonly string[]
  problem: string | null
  edit: EditFn
  /** The heading over the block ("Light", "Dark", or "Light and dark"). */
  heading: string
  action?: React.ReactNode
  familyInForce: string | null
}

/** One mode's value: what it follows, the control, and the type check of what is in force. */
function ModeBlock({ token, mode, view, primitives, problem, edit, heading, action, familyInForce }: ModeBlockProps) {
  const followId = useId()
  const key = `${token.name}:${mode}`
  const followedPrimitive = view.follows?.primitive ?? null
  const followsToken = view.follows && !followedPrimitive ? view.follows : null
  const offerFollow = primitives.length > 0 || followedPrimitive !== null
  const selected = followedPrimitive ?? (followsToken ? `token:${followsToken.name}` : OWN_VALUE)

  const onFollow = (choice: string) => {
    if (choice === selected || choice.startsWith('token:')) return
    if (choice === OWN_VALUE) edit(key, (s) => detachToLiteral(s.tokens, s.resolved, token.name, mode))
    else edit(key, (s) => followPrimitive(s.tokens, token.name, mode, choice))
  }

  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="qt-text-label-xs">{heading}</p>
        {action}
      </div>
      {offerFollow && (
        <div className="flex items-center gap-2">
          <label htmlFor={followId} className="qt-text-xs qt-text-secondary flex-shrink-0">
            Follows
          </label>
          <select
            id={followId}
            className="qt-select qt-text-xs min-w-0 flex-1"
            value={selected}
            onChange={(e) => onFollow(e.target.value)}
          >
            <option value={OWN_VALUE}>Nothing: a value of its own</option>
            {followsToken && <option value={`token:${followsToken.name}`}>{followsToken.label} (as the house has it)</option>}
            {primitives.map((p) => (
              <option key={p} value={p}>
                Primitive “{p}”
              </option>
            ))}
            {followedPrimitive && !primitives.includes(followedPrimitive) && (
              <option value={followedPrimitive}>Primitive “{followedPrimitive}” (missing)</option>
            )}
          </select>
        </div>
      )}
      <ValueControl
        type={token.type}
        label={`${token.label}, ${mode}`}
        options={keywordOptions(token)}
        value={view.value}
        literal={view.literal}
        placeholder={view.source.kind === 'unset' ? token.default : undefined}
        familyInForce={familyInForce}
        onCommit={(v) => edit(key, (s) => setTokenValue(s.tokens, token.name, mode, v))}
      />
      {problem && (
        <p className="qt-text-xs qt-text-destructive">
          <Icon name="alert-triangle" className="inline w-3 h-3 mr-1 align-[-2px]" />
          The value in force does not fit: {problem}.
        </p>
      )}
    </div>
  )
}

function TokenRowImpl({ token, store, edit }: TokenRowProps) {
  const labelId = useId()
  const select = useCallback((s: EditorSnapshot) => tokenRowView(token, s), [token])
  const view = useEditorSelector(store, select)
  const { shown, light, dark, mode, overridden, sameAsLight, problems, contrast, primitives, familyInForce } = view
  const isColor = token.type === 'color'

  return (
    <div id={tokenRowDomId(token.name)} tabIndex={-1} className="py-3 scroll-mt-24" role="group" aria-labelledby={labelId}>
      <div className="flex items-start gap-3">
        {isColor && <Swatch literal={shown.literal} label={`${token.label} in ${mode}`} />}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p id={labelId} className="font-medium qt-text">{token.label}</p>
              <p className="qt-text-xs qt-text-muted font-mono">{token.name}</p>
              {token.description && <p className="qt-text-xs qt-text-secondary mt-1">{token.description}</p>}
              <p className="qt-text-xs qt-text-secondary mt-1">
                {sourceText(shown.source)}
                {shown.follows && (
                  <>
                    {' · follows '}
                    <em>{shown.follows.label}</em>
                  </>
                )}
                {shown.literal && shown.literal !== shown.value && <span className="font-mono"> ({shown.literal})</span>}
              </p>
            </div>
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => edit(`${token.name}:reset`, (s) => resetToken(s.tokens, token.name))}
              disabled={!overridden}
              aria-label={`Reset ${token.label} to the house default`}
            >
              <Icon name="refresh" className="w-4 h-4" />
              <span className="ml-1">Reset</span>
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ModeBlock
              token={token}
              mode="light"
              view={light}
              primitives={primitives}
              problem={problems.light}
              edit={edit}
              heading={sameAsLight ? 'Light and dark' : 'Light'}
              familyInForce={familyInForce}
              action={
                sameAsLight ? (
                  <button
                    type="button"
                    className="qt-button qt-button-ghost qt-button-sm"
                    onClick={() => edit(`${token.name}:dark`, (s) => separateDarkValue(s.tokens, s.resolved, token.name))}
                    aria-label={`Give ${token.label} a dark value of its own`}
                  >
                    <Icon name="moon" className="w-4 h-4" />
                    <span className="ml-1">Dark apart</span>
                  </button>
                ) : undefined
              }
            />
            {!sameAsLight && (
              <ModeBlock
                token={token}
                mode="dark"
                view={dark}
                primitives={primitives}
                problem={problems.dark}
                edit={edit}
                heading="Dark"
                familyInForce={familyInForce}
                action={
                  <button
                    type="button"
                    className="qt-button qt-button-ghost qt-button-sm"
                    onClick={() => edit(`${token.name}:dark`, (s) => joinDarkToLight(s.tokens, s.resolved, token.name))}
                    aria-label={`Make ${token.label} the same in dark as in light`}
                  >
                    <Icon name="sun" className="w-4 h-4" />
                    <span className="ml-1">Same as light</span>
                  </button>
                }
              />
            )}
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
    </div>
  )
}

export const TokenRow = memo(TokenRowImpl)
