'use client'

/**
 * Calliope's Atelier — running a manifest or file operation on a draft.
 *
 * Every asset section changes the draft through one of the draft's named
 * operations (`?action=add-font`, `remove-file`, `set-manifest` …). Each
 * carries the manifest revision it was read at and returns the fresh draft.
 * `run` does the parts every caller shares, in order: flush the unsaved token
 * edits (so they are not lost behind the operation), call with the newest
 * manifest revision, adopt the returned draft — the compiled font faces,
 * icon rules, resources and preview all follow from it — and, on a stale
 * revision, read the draft again and say who else may have changed it.
 *
 * @module components/theme-editor/assets/use-draft-operations
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiFetchError, apiErrorMessage } from '@/lib/query/fetcher'
import { showErrorToast, showWarningToast } from '@/lib/toast'
import { fetchThemeDraft, type DraftDetail } from '../use-theme-drafts'

/** Said when a save or an operation finds the draft changed under it. */
export const CHANGED_ELSEWHERE =
  'This draft was changed elsewhere in the meantime — in Document Mode, perhaps, or by a character with a pen. The newer version is now before you; your last change was set aside.'

/** What an operation answered when it did not succeed. */
export interface OperationFailure {
  ok: false
  message: string
  /** For a file still in use, what uses it (in words). */
  usedBy?: string[]
  /** The draft changed under the operation and was read again. */
  conflict?: boolean
}

export type OperationResult<T> = { ok: true; value: T } | OperationFailure

export interface RunOptions {
  /** Say a failure in a toast (the default); off when the caller shows it in place. */
  toast?: boolean
}

export interface DraftOperations {
  /** An operation is under way. */
  busy: boolean
  /** The draft as last seen (the newest an operation or save returned). */
  current: () => DraftDetail
  run: <T extends { draft: DraftDetail }>(call: (manifestRevision: string, id: string) => Promise<T>, options?: RunOptions) => Promise<OperationResult<T>>
}

interface SaverLike {
  flush: () => Promise<void>
  current: () => DraftDetail
  adopt: (fresh: DraftDetail) => void
}

/** The details an error response carries (`{ error, details }`). */
function detailsOf(err: ApiFetchError): Record<string, unknown> {
  const info = err.info
  if (!info || typeof info !== 'object') return {}
  const details = (info as Record<string, unknown>).details
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : {}
}

/** An operation failure, from what the server answered. */
export function describeFailure(err: unknown): OperationFailure {
  if (err instanceof ApiFetchError) {
    const details = detailsOf(err)
    const message = apiErrorMessage(err, 'The atelier could not do that.')
    if (err.status === 409 && Array.isArray(details.usedBy)) {
      return { ok: false, message, usedBy: details.usedBy.map(String) }
    }
    if (err.status === 422 && Array.isArray(details.errors) && details.errors.length > 0) {
      return { ok: false, message: `${message}: ${details.errors.map(String).join('; ')}` }
    }
    return { ok: false, message }
  }
  return { ok: false, message: err instanceof Error ? err.message : 'The atelier could not do that.' }
}

/** Whether a 409 is a stale revision (as against a file still in use). */
function isStale(err: unknown): boolean {
  return err instanceof ApiFetchError && err.status === 409 && !Array.isArray(detailsOf(err).usedBy)
}

/**
 * The operations for one draft. `onConflict` is the editor's: it takes the
 * draft read again after a stale revision (and resets the tokens to it).
 */
export function useDraftOperationsState(saver: SaverLike, onConflict: (fresh: DraftDetail) => void): DraftOperations {
  const [count, setCount] = useState(0)
  const { flush, current, adopt } = saver
  const onConflictRef = useRef(onConflict)
  useEffect(() => {
    onConflictRef.current = onConflict
  }, [onConflict])

  const run = useCallback(
    async <T extends { draft: DraftDetail }>(call: (manifestRevision: string, id: string) => Promise<T>, options?: RunOptions): Promise<OperationResult<T>> => {
      const toast = options?.toast ?? true
      setCount((n) => n + 1)
      try {
        await flush()
        const before = current()
        try {
          const value = await call(before.manifestRevision, before.id)
          adopt(value.draft)
          return { ok: true, value }
        } catch (err) {
          if (isStale(err)) {
            try {
              const fresh = await fetchThemeDraft(before.id)
              adopt(fresh)
              onConflictRef.current(fresh)
            } catch (reloadErr) {
              showErrorToast(apiErrorMessage(reloadErr, 'The draft changed elsewhere, and could not be fetched again.'))
            }
            showWarningToast(CHANGED_ELSEWHERE)
            return { ok: false, message: CHANGED_ELSEWHERE, conflict: true }
          }
          const failure = describeFailure(err)
          if (toast) {
            showErrorToast(failure.usedBy ? `${failure.message} — used by ${failure.usedBy.join(', ')}` : failure.message)
          }
          return failure
        }
      } finally {
        setCount((n) => n - 1)
      }
    },
    [flush, current, adopt],
  )

  return useMemo(() => ({ busy: count > 0, current, run }), [count, current, run])
}

export const DraftOperationsContext = createContext<DraftOperations | null>(null)

/** The draft operations, inside the editor. */
export function useDraftOperations(): DraftOperations {
  const ops = useContext(DraftOperationsContext)
  if (!ops) throw new Error('useDraftOperations is used outside the draft editor')
  return ops
}
