'use client'

/**
 * Bind the presentational character field blocks
 * (`components/characters/fields/`) to the page's autosave engine.
 *
 * - **Text** (`useTextBinding`): shows the draft over the stored value, records
 *   a draft on every keystroke and commits on blur / Enter.
 * - **Value** (`useValueBinding`): the same for structured values (pronouns,
 *   birthday) whose controls commit themselves.
 * - **Markdown** (`useMarkdownBinding`): drafts on change and sends after the
 *   idle delay or on blur. It ignores the editor's change events until the
 *   user has focused it (so an editor normalising Markdown on mount never
 *   writes on its own), and remounts the editor when the stored value changes
 *   underneath it — but never while it is focused or holds a draft, which is
 *   how a refetch on tab re-activation never clobbers what is being typed.
 *   `externalToken` forces a remount after a generator rewrote the row.
 *
 * All three show {@link useHeldValue}: the engine drops a draft the moment
 * its save resolves, but the cached row reaches React a tick later, so for one
 * render "no draft" would mean "the old stored value" — which a Markdown
 * editor reads as its parent clearing it, and wipes itself. The last draft is
 * held until the stored value moves.
 *
 * @module app/aurora/[id]/components/autosave-bindings
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutosaveEngine } from '@/lib/autosave/autosave-engine'
import type { MarkdownFieldBinding, TextFieldBinding, ValueBinding } from '@/components/characters/fields/types'
import { useAutosaveFieldState } from '../hooks/useCharacterAutosave'

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * The value a field shows: its draft while there is one; after the draft goes,
 * the last draft until the stored value changes from what it was while the
 * draft stood (the save has landed in the cache, or someone else wrote it);
 * otherwise the stored value.
 */
export function useHeldValue<T>(hasDraft: boolean, draft: T, stored: T): T {
  const [held, setHeld] = useState<{ value: T; storedAtHold: T } | null>(null)
  if (hasDraft) {
    if (!held || held.value !== draft || held.storedAtHold !== stored) {
      setHeld({ value: draft, storedAtHold: stored })
    }
    return draft
  }
  if (held) {
    if (!sameValue(held.storedAtHold, stored)) {
      setHeld(null)
      return stored
    }
    return held.value
  }
  return stored
}

export function useTextBinding(engine: AutosaveEngine, key: string, stored: string | null | undefined): TextFieldBinding {
  const state = useAutosaveFieldState(engine, key)
  const storedText = stored ?? ''
  const onChange = useCallback(
    (value: string) => {
      if (value === storedText) engine.discard(key)
      else engine.setDraft(key, value)
    },
    [engine, key, storedText],
  )
  const onCommit = useCallback(() => engine.commit(), [engine])
  const value = useHeldValue(state.hasDraft, String(state.draft ?? ''), storedText)
  return {
    value,
    onChange,
    onCommit,
    failed: state.failed,
    error: state.invalid,
  }
}

export function useValueBinding<T>(engine: AutosaveEngine, key: string, stored: T): ValueBinding<T> {
  const state = useAutosaveFieldState(engine, key)
  const onChange = useCallback(
    (value: T) => {
      if (sameValue(value, stored)) engine.discard(key)
      else engine.setDraft(key, value)
    },
    [engine, key, stored],
  )
  const onCommit = useCallback(() => engine.commit(), [engine])
  const value = useHeldValue(state.hasDraft, state.draft as T, stored)
  return {
    value,
    onChange,
    onCommit,
    failed: state.failed,
  }
}

export function useMarkdownBinding(
  engine: AutosaveEngine,
  key: string,
  stored: string | null | undefined,
  externalToken: number = 0,
): MarkdownFieldBinding {
  const state = useAutosaveFieldState(engine, key)
  const storedText = stored ?? ''
  const interacted = useRef(false)
  const [focused, setFocused] = useState(false)
  // What the editor currently holds, as far as we know: what it was mounted
  // with, or the last thing it emitted.
  const editorValue = useRef(storedText)
  const [remounts, setRemounts] = useState(0)
  const value = useHeldValue(state.hasDraft, String(state.draft ?? ''), storedText)

  // Remount only when what the field should show is not what the editor holds
  // — an outside write — and never under the user's hands.
  useEffect(() => {
    if (focused || state.hasDraft) return
    if (value !== editorValue.current) {
      editorValue.current = value
      setRemounts((n) => n + 1)
    }
  }, [value, focused, state.hasDraft])

  const onChange = useCallback(
    (value: string) => {
      if (!interacted.current) return
      editorValue.current = value
      if (value === storedText) engine.discard(key)
      else engine.setDraft(key, value, { idle: true })
    },
    [engine, key, storedText],
  )
  const onFocus = useCallback(() => {
    interacted.current = true
    setFocused(true)
  }, [])
  const onCommit = useCallback(() => {
    setFocused(false)
    engine.commit()
  }, [engine])

  return {
    value,
    onChange,
    onFocus,
    onCommit,
    remountKey: `${externalToken}-${remounts}`,
    failed: state.failed,
    error: state.invalid,
  }
}
