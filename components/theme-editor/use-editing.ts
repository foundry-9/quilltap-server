'use client'

/**
 * The editing state around a theme draft's tokens.
 *
 * @module components/theme-editor/use-editing
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'
import { jsonEqual } from '@/lib/hooks/use-draft'
import { createEditorStore, type EditorStore } from './editor-store'
import type { EditFn } from './TokenRow'
import {
  EMPTY_HISTORY,
  analyse,
  recordEdit,
  redoStep,
  undoStep,
  type EditHistory,
  type EditorMode,
  type EditorSnapshot,
} from './model'

/**
 * The editing state around the draft's tokens: the store rows read, the one
 * `edit` every row calls, and undo and redo. An edit is a function from the
 * snapshot to a tokens document; it is recorded in the history (successive
 * edits of one key, a colour drag, as one step) and becomes the draft.
 */
export function useEditing(tokens: ThemeTokensDocument, setTokens: (next: ThemeTokensDocument) => void, mode: EditorMode) {
  const { resolved, findings } = useMemo(() => analyse(tokens), [tokens])
  const snapshot = useMemo<EditorSnapshot>(() => ({ tokens, resolved, findings, mode }), [tokens, resolved, findings, mode])
  const [store] = useState<EditorStore>(() => createEditorStore(snapshot))
  const [history, setHistory] = useState<EditHistory>(EMPTY_HISTORY)

  // What the latest edit produced, ahead of the render that shows it (a colour drag outruns renders).
  const current = useRef<{ tokens: ThemeTokensDocument; history: EditHistory }>({ tokens, history })
  useLayoutEffect(() => {
    current.current = { tokens, history }
    store.set(snapshot)
  }, [tokens, history, snapshot, store])

  const apply = useCallback(
    (next: ThemeTokensDocument, nextHistory: EditHistory) => {
      current.current = { tokens: next, history: nextHistory }
      setHistory(nextHistory)
      setTokens(next)
    },
    [setTokens],
  )

  const edit = useCallback<EditFn>(
    (key, change) => {
      const before = current.current.tokens
      const shown = store.get()
      const base = shown.tokens === before ? shown : { ...shown, tokens: before, ...analyse(before) }
      const after = change(base)
      if (after === before || jsonEqual(after, before)) return
      apply(after, recordEdit(current.current.history, before, key, Date.now()))
    },
    [store, apply],
  )

  const undo = useCallback(() => {
    const step = undoStep(current.current.history, current.current.tokens)
    if (step) apply(step.doc, step.history)
  }, [apply])
  const redo = useCallback(() => {
    const step = redoStep(current.current.history, current.current.tokens)
    if (step) apply(step.doc, step.history)
  }, [apply])
  const forget = useCallback(() => {
    current.current = { ...current.current, history: EMPTY_HISTORY }
    setHistory(EMPTY_HISTORY)
  }, [])

  return {
    store,
    resolved,
    findings,
    edit,
    undo,
    redo,
    forget,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}
