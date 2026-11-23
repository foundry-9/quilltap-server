'use client'

/**
 * Calliope's Atelier — the editor's state as a store rows subscribe to.
 *
 * The editor holds every token of a draft, and a keystroke in one row must
 * not re-render the others (Spec E, Stage 1). So rows do not take the
 * tokens document as a prop: each reads its own `TokenRowView` from this
 * store through `useEditorSelector`, which re-renders the row only when that
 * view changes. The editor writes the store after each render that changed
 * the snapshot.
 *
 * @module components/theme-editor/editor-store
 */

import { useState, useSyncExternalStore } from 'react'
import { jsonEqual } from '@/lib/hooks/use-draft'
import type { EditorSnapshot } from './model'

export interface EditorStore {
  get: () => EditorSnapshot
  set: (snapshot: EditorSnapshot) => void
  subscribe: (listener: () => void) => () => void
}

export function createEditorStore(initial: EditorSnapshot): EditorStore {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set: (next) => {
      if (next === snapshot) return
      snapshot = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * A getter for the part of `store`'s snapshot `select` picks, which keeps
 * returning the same object while the picked part is equal (`isEqual`).
 */
function createSelection<T>(store: EditorStore, select: (snapshot: EditorSnapshot) => T, isEqual: (a: T, b: T) => boolean): () => T {
  let seen: EditorSnapshot | undefined
  let selection: T
  return () => {
    const snapshot = store.get()
    if (snapshot === seen) return selection
    const next = select(snapshot)
    if (seen === undefined || !isEqual(selection, next)) selection = next
    seen = snapshot
    return selection
  }
}

/**
 * The part of the snapshot `select` picks, kept by identity while it is
 * equal (`isEqual`, structural by default) so a memoised consumer skips the
 * render. The store, `select` and `isEqual` are read once, when the
 * consumer mounts.
 */
export function useEditorSelector<T>(
  store: EditorStore,
  select: (snapshot: EditorSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = jsonEqual,
): T {
  const [getSelection] = useState(() => createSelection(store, select, isEqual))
  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}
