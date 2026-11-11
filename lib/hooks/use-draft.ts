'use client'

/**
 * A form's draft of a server value that a refetch must not overwrite.
 *
 * Server state lives in the query cache and is refreshed whenever a topic, a
 * tab switch or a sibling write says so. A form that copied it into
 * component state and re-copied it on every refetch threw away whatever the
 * user was typing (#170). `useDraft` holds the copy instead, and adopts a new
 * server value only when doing so loses nothing:
 *
 *   - while the draft is clean (equal to the value it was last adopted from), or
 *   - when the new server value already equals the draft (a save landing).
 *
 * A dirty draft that disagrees with the server stays as the user left it;
 * `reset()` discards it and takes the current server value.
 *
 * Adoption happens during render (React's "adjust state when a prop changes"
 * pattern), so there is no effect and no flash of the stale value.
 *
 * @module lib/hooks/use-draft
 */

import { useCallback, useState } from 'react'

/** Structural equality for JSON-shaped values (what a form drafts). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bArr = b as unknown[]
    return a.length === bArr.length && a.every((v, i) => jsonEqual(v, bArr[i]))
  }
  const aRec = a as Record<string, unknown>
  const bRec = b as Record<string, unknown>
  const aKeys = Object.keys(aRec).filter((k) => aRec[k] !== undefined)
  const bKeys = Object.keys(bRec).filter((k) => bRec[k] !== undefined)
  return aKeys.length === bKeys.length && aKeys.every((k) => jsonEqual(aRec[k], bRec[k]))
}

export interface DraftControls {
  /** The draft differs from the server value it was last adopted from. */
  dirty: boolean
  /** Discard the draft and adopt the current server value. */
  reset: () => void
}

export type SetDraft<T> = (next: T | ((prev: T) => T)) => void

export function useDraft<T>(
  serverValue: T,
  isEqual: (a: T, b: T) => boolean = jsonEqual,
): [T, SetDraft<T>, DraftControls] {
  const [state, setState] = useState<{ base: T; draft: T }>(() => ({
    base: serverValue,
    draft: serverValue,
  }))

  const dirty = !isEqual(state.draft, state.base)

  if (!isEqual(serverValue, state.base) && (!dirty || isEqual(state.draft, serverValue))) {
    // Adopt: nothing the user typed is lost.
    setState({ base: serverValue, draft: serverValue })
  }

  const setDraft = useCallback<SetDraft<T>>((next) => {
    setState((prev) => ({
      ...prev,
      draft: typeof next === 'function' ? (next as (p: T) => T)(prev.draft) : next,
    }))
  }, [])

  const reset = useCallback(() => {
    setState({ base: serverValue, draft: serverValue })
  }, [serverValue])

  return [state.draft, setDraft, { dirty, reset }]
}
