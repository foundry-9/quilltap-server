'use client'

/**
 * The save queue for one theme draft: edits merge into one pending body, a
 * timer sends it, one PUT is in flight at a time, and each carries the
 * newest revision seen. A stale revision reloads the draft and hands it to
 * `onConflict`.
 *
 * @module components/theme-editor/use-draft-saver
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiFetchError, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast } from '@/lib/toast'
import { reloadAfterConflict } from './assets/use-draft-operations'
import { saveThemeDraft, type DraftDetail, type ThemeDraftSave } from './use-theme-drafts'

const SAVE_DELAY_MS = 700

type Pending = Omit<ThemeDraftSave, 'revision' | 'manifestRevision' | 'stylesRevision'>

/**
 * The save queue for one draft: edits merge into one pending body, a timer
 * sends it, one PUT is in flight at a time, and each carries the newest
 * revision seen.
 */
export function useDraftSaver(detail: DraftDetail, onConflict: (fresh: DraftDetail) => void) {
  const queryClient = useQueryClient()
  const latest = useRef(detail)
  const pending = useRef<Pending>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const [saving, setSaving] = useState(false)
  const onConflictRef = useRef(onConflict)

  useEffect(() => {
    onConflictRef.current = onConflict
  }, [onConflict])

  useEffect(() => {
    // A newer read (realtime refresh, our own save) carries the newer revision.
    if (
      detail.revision !== latest.current.revision ||
      detail.manifestRevision !== latest.current.manifestRevision ||
      detail.updatedAt !== latest.current.updatedAt
    ) {
      latest.current = detail
    }
  }, [detail])

  /** Take a draft a save or an operation returned as the newest, ahead of the render that shows it. */
  const adopt = useCallback(
    (fresh: DraftDetail) => {
      latest.current = fresh
      queryClient.setQueryData(queryKeys.themeDrafts.detail(fresh.id), fresh)
      void queryClient.invalidateQueries({ queryKey: queryKeys.themeDrafts.list })
    },
    [queryClient],
  )

  const send = useCallback(
    async (keepalive: boolean): Promise<void> => {
      if (inFlight.current) await inFlight.current
      const body = { ...pending.current }
      pending.current = {}
      // A stylesheet removed since the edit was queued has nothing to save it to.
      if (body.css !== undefined && !latest.current.styles) delete body.css
      if (Object.keys(body).length === 0) return
      const id = latest.current.id
      const run = (async () => {
        setSaving(true)
        try {
          const fresh = await saveThemeDraft(
            id,
            {
              ...body,
              revision: latest.current.revision,
              manifestRevision: latest.current.manifestRevision,
              stylesRevision: latest.current.styles?.revision,
            },
            { keepalive },
          )
          adopt(fresh)
        } catch (err) {
          if (err instanceof ApiFetchError && err.status === 409) {
            await reloadAfterConflict(id, adopt, onConflictRef.current)
          } else {
            showErrorToast(apiErrorMessage(err, 'The atelier could not save the draft.'))
          }
        } finally {
          setSaving(false)
        }
      })()
      inFlight.current = run
      try {
        await run
      } finally {
        if (inFlight.current === run) inFlight.current = null
      }
    },
    [adopt],
  )

  const queue = useCallback(
    (part: Pending) => {
      pending.current = { ...pending.current, ...part }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void send(false)
      }, SAVE_DELAY_MS)
    },
    [send],
  )

  const flush = useCallback(
    (keepalive = false) => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      return send(keepalive)
    },
    [send],
  )

  /** The newest draft seen: what an operation reads its manifest revision from. */
  const current = useCallback(() => latest.current, [])

  return { queue, flush, saving, current, adopt }
}

export type DraftSaver = ReturnType<typeof useDraftSaver>
