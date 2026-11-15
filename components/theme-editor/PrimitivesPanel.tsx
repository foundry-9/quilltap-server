'use client'

/**
 * Calliope's Atelier — the primitives panel (Spec E, Stage 2).
 *
 * A primitive is one of the theme's own named values (`--p-<name>`). Each
 * row edits its value with the control for its type, gives it a dark value
 * apart or joins it again, changes its type, renames it (every reference is
 * rewritten) and removes it (every reference is given its value in place,
 * after a confirm that lists them). A form at the foot adds one. Every edit
 * is an engine function from the tokens document to a tokens document
 * (`lib/themes/engine/primitives.ts`), applied through `edit` so it joins
 * undo; a row reads its view from the store, like a token row.
 *
 * @module components/theme-editor/PrimitivesPanel
 */

import { memo, useCallback, useId, useState } from 'react'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import {
  PRIMITIVE_TYPES,
  addPrimitive,
  primitiveNameProblem,
  removePrimitive,
  renamePrimitive,
  setPrimitiveDark,
  setPrimitiveType,
  setPrimitiveValue,
  type ThemePrimitive,
} from '@/lib/themes/engine/client'
import { ValueControl } from './controls'
import { useEditorSelector, type EditorStore } from './editor-store'
import { primitiveRowView, primitiveStarter, valueProblem, type EditorSnapshot, type PrimitiveRowView } from './model'
import type { EditFn } from './TokenRow'

type PrimitiveType = ThemePrimitive['type']

const TYPE_LABELS: Readonly<Record<PrimitiveType, string>> = {
  color: 'Colour',
  length: 'Length',
  radius: 'Radius',
  shadow: 'Shadow',
  'font-family': 'Font family',
  'font-weight': 'Font weight',
  duration: 'Duration',
  easing: 'Easing',
  opacity: 'Opacity',
  image: 'Image',
  number: 'Number',
  raw: 'Anything (raw)',
}

function TypeSelect({ value, label, onChange }: { value: PrimitiveType; label: string; onChange: (t: PrimitiveType) => void }) {
  return (
    <select className="qt-select qt-text-xs" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as PrimitiveType)}>
      {PRIMITIVE_TYPES.map((t) => (
        <option key={t} value={t}>
          {TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  )
}

/** The rename field: commits a valid, free name on Enter or blur; Escape puts the old one back. */
function RenameField({ view, store, edit }: { view: PrimitiveRowView; store: EditorStore; edit: EditFn }) {
  const [text, setText] = useState(view.name)
  const [seen, setSeen] = useState(view.name)
  if (view.name !== seen) {
    setSeen(view.name)
    setText(view.name)
  }
  const errorId = useId()
  const next = text.trim()
  const problem = next !== view.name && next !== '' ? primitiveNameProblem(store.get().tokens, next) : null

  const commit = () => {
    if (next === view.name || next === '' || problem) {
      if (next === '') setText(view.name)
      return
    }
    edit(`primitive:${view.name}:rename`, (s) => {
      const result = renamePrimitive(s.tokens, view.name, next)
      return result.ok ? result.document : s.tokens
    })
  }

  return (
    <div className="min-w-0">
      <input
        type="text"
        className="qt-input qt-text-xs font-mono w-48"
        value={text}
        spellCheck={false}
        aria-label={`Name of primitive ${view.name}`}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setText(view.name)
          }
        }}
      />
      {problem && (
        <p id={errorId} className="qt-text-xs qt-text-destructive mt-1">
          {problem}; the old name stands.
        </p>
      )}
    </div>
  )
}

function usersCount(view: PrimitiveRowView): number {
  return view.users.tokens.length + view.users.primitives.length
}

function UsersList({ view }: { view: PrimitiveRowView }) {
  return (
    <ul className="qt-text-xs qt-text-secondary list-disc pl-5 space-y-0.5">
      {view.users.tokens.map((t) => (
        <li key={t.name}>
          {t.label} <span className="font-mono qt-text-muted">{t.name}</span>
        </li>
      ))}
      {view.users.primitives.map((p) => (
        <li key={p}>
          Primitive “{p}”
        </li>
      ))}
    </ul>
  )
}

/** The confirm before a primitive is removed: an alertdialog naming what follows it. */
function RemoveDialog({ view, onClose, onConfirm }: { view: PrimitiveRowView | null; onClose: () => void; onConfirm: () => void }) {
  const count = view ? usersCount(view) : 0
  return (
    <BaseModal isOpen={view !== null} onClose={onClose} role="alertdialog" headerless className="p-6">
      <div className="space-y-3 mb-6">
        <ModalTitle className="qt-heading-4">Remove the primitive “{view?.name}”?</ModalTitle>
        {view && count > 0 ? (
          <>
            <p className="qt-text-small qt-text-secondary">
              {count === 1 ? 'One value follows it' : `${count} values follow it`}; each will be handed its value outright, so nothing changes to look at.
            </p>
            <UsersList view={view} />
          </>
        ) : (
          <p className="qt-text-small qt-text-secondary">Nothing follows it, so nothing else is disturbed.</p>
        )}
        <p className="qt-text-xs qt-text-muted">Undo brings it back, should you think better of it.</p>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className="qt-button qt-button-secondary" onClick={onClose}>
          Keep it
        </button>
        <button type="button" className="qt-button qt-button-destructive" onClick={onConfirm}>
          Remove the primitive
        </button>
      </div>
    </BaseModal>
  )
}

interface PrimitiveRowProps {
  name: string
  store: EditorStore
  edit: EditFn
  onRemove: (view: PrimitiveRowView) => void
}

const PrimitiveRow = memo(function PrimitiveRow({ name, store, edit, onRemove }: PrimitiveRowProps) {
  const labelId = useId()
  const select = useCallback((s: EditorSnapshot) => primitiveRowView(name, s), [name])
  const view = useEditorSelector(store, select)
  if (!view) return null
  const count = usersCount(view)
  const lightProblem = valueProblem(view.type, view.light.value)
  const darkProblem = view.sameAsLight ? null : valueProblem(view.type, view.dark.value)

  const block = (mode: 'light' | 'dark', heading: string, action: React.ReactNode) => {
    const modeView = view[mode]
    const problem = mode === 'light' ? lightProblem : darkProblem
    return (
      <div className="space-y-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="qt-text-label-xs">{heading}</p>
          {action}
        </div>
        <ValueControl
          type={view.type}
          label={`${view.name}, ${mode}`}
          value={modeView.value}
          literal={modeView.literal}
          onCommit={(v) =>
            edit(`primitive:${view.name}:${mode}`, (s) => (mode === 'light' ? setPrimitiveValue(s.tokens, view.name, v) : setPrimitiveDark(s.tokens, view.name, v)))
          }
        />
        {problem && (
          <p className="qt-text-xs qt-text-destructive">
            <Icon name="alert-triangle" className="inline w-3 h-3 mr-1 align-[-2px]" />
            The value does not fit its type: {problem}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="py-3 space-y-2" role="group" aria-labelledby={labelId}>
      <p id={labelId} className="sr-only">
        Primitive {view.name}
      </p>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-start gap-2 flex-wrap">
          <RenameField view={view} store={store} edit={edit} />
          <TypeSelect
            value={view.type}
            label={`Type of primitive ${view.name}`}
            onChange={(t) => edit(`primitive:${view.name}:type`, (s) => setPrimitiveType(s.tokens, view.name, t))}
          />
          <span className="qt-text-xs qt-text-muted font-mono pt-2">{view.variable}</span>
        </div>
        <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={() => onRemove(view)} aria-label={`Remove primitive ${view.name}`}>
          <Icon name="trash" className="w-4 h-4" />
          <span className="ml-1">Remove</span>
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {block(
          'light',
          view.sameAsLight ? 'Light and dark' : 'Light',
          view.sameAsLight ? (
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => edit(`primitive:${view.name}:dark`, (s) => setPrimitiveDark(s.tokens, view.name, view.light.value))}
              aria-label={`Give primitive ${view.name} a dark value of its own`}
            >
              <Icon name="moon" className="w-4 h-4" />
              <span className="ml-1">Dark apart</span>
            </button>
          ) : null,
        )}
        {!view.sameAsLight &&
          block(
            'dark',
            'Dark',
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={() => edit(`primitive:${view.name}:dark`, (s) => setPrimitiveDark(s.tokens, view.name, undefined))}
              aria-label={`Make primitive ${view.name} the same in dark as in light`}
            >
              <Icon name="sun" className="w-4 h-4" />
              <span className="ml-1">Same as light</span>
            </button>,
          )}
      </div>
      {count === 0 ? (
        <p className="qt-text-xs qt-text-muted">Nothing follows it yet.</p>
      ) : (
        <details>
          <summary className="qt-text-xs qt-text-secondary cursor-pointer">
            Followed by {count === 1 ? 'one value' : `${count} values`}
          </summary>
          <div className="mt-1">
            <UsersList view={view} />
          </div>
        </details>
      )}
    </div>
  )
})

/** The form that adds a primitive: a name, a type, and a starting value for that type. */
function AddPrimitiveForm({ store, edit }: { store: EditorStore; edit: EditFn }) {
  const nameId = useId()
  const typeId = useId()
  const errorId = useId()
  const [name, setName] = useState('')
  const [type, setType] = useState<PrimitiveType>('color')
  const [touched, setTouched] = useState(false)
  const trimmed = name.trim()
  const problem = trimmed === '' ? null : primitiveNameProblem(store.get().tokens, trimmed)
  const shown = touched ? problem : null

  const add = () => {
    setTouched(true)
    if (trimmed === '' || problem) return
    const primitive: ThemePrimitive = { type, value: primitiveStarter(type) }
    edit(`primitive:${trimmed}:add`, (s) => {
      const result = addPrimitive(s.tokens, trimmed, primitive)
      return result.ok ? result.document : s.tokens
    })
    setName('')
    setTouched(false)
  }

  return (
    <form
      className="pt-3 border-t qt-border-default space-y-1"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
    >
      <p className="qt-text-label-xs">Add a primitive</p>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className="qt-text-xs qt-text-secondary">
            Name of the new primitive
          </label>
          <input
            id={nameId}
            type="text"
            className="qt-input qt-text-xs font-mono w-48"
            value={name}
            placeholder="brass-ink"
            spellCheck={false}
            aria-invalid={shown ? true : undefined}
            aria-describedby={shown ? errorId : undefined}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(trimmed !== '')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={typeId} className="qt-text-xs qt-text-secondary">
            Its type
          </label>
          <select id={typeId} className="qt-select qt-text-xs" value={type} onChange={(e) => setType(e.target.value as PrimitiveType)}>
            {PRIMITIVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="qt-button qt-button-secondary qt-button-sm" disabled={trimmed === ''}>
          <Icon name="plus" className="w-4 h-4" />
          <span className="ml-1">Add</span>
          <span className="sr-only"> the primitive</span>
        </button>
      </div>
      {shown && (
        <p id={errorId} className="qt-text-xs qt-text-destructive">
          {shown}.
        </p>
      )}
      <p className="qt-text-xs qt-text-muted">It starts as {primitiveStarter(type)}; change it once it is on the list.</p>
    </form>
  )
}

export interface PrimitivesPanelProps {
  /** The primitives to show (narrowed by search), in order. */
  names: readonly string[]
  /** How many the draft defines in all. */
  total: number
  filtering: boolean
  store: EditorStore
  edit: EditFn
}

export function PrimitivesPanel({ names, total, filtering, store, edit }: PrimitivesPanelProps) {
  const [removing, setRemoving] = useState<PrimitiveRowView | null>(null)
  const onRemove = useCallback((view: PrimitiveRowView) => setRemoving(view), [])

  return (
    <details className="qt-card" open={filtering && names.length > 0 ? true : undefined}>
      <summary className="p-4 cursor-pointer">
        <span className="qt-heading-4">Primitives</span>
        <span className="qt-text-xs qt-text-muted ml-2">
          {filtering ? `${names.length} of ${total} answering` : `${total} defined`}
        </span>
        <p className="qt-text-xs qt-text-secondary mt-1">
          The theme&rsquo;s own named values. Point a token at one with its &ldquo;Follows&rdquo; choice, and every token that follows it changes when it does.
        </p>
      </summary>
      <div className="px-4 pb-4">
        {names.length === 0 ? (
          <p className="qt-text-small qt-text-muted">{filtering && total > 0 ? 'None answers to that description.' : 'This theme defines none yet.'}</p>
        ) : (
          <div className="divide-y qt-border-default">
            {names.map((n) => (
              <PrimitiveRow key={n} name={n} store={store} edit={edit} onRemove={onRemove} />
            ))}
          </div>
        )}
        <AddPrimitiveForm store={store} edit={edit} />
      </div>
      <RemoveDialog
        view={removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (target) edit(`primitive:${target.name}:remove`, (s) => removePrimitive(s.tokens, target.name))
        }}
      />
    </details>
  )
}
