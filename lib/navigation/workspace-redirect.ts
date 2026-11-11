/**
 * Old-route → workspace redirect helper (Phase 6).
 *
 * The legacy per-surface routes redirect into `/workspace` carrying a transient
 * `?open=` intent that the workspace consumes and strips. Server-component only
 * (`redirect` is from `next/navigation`).
 *
 * @module lib/navigation/workspace-redirect
 */

import { redirect } from 'next/navigation'

/**
 * Redirect to the workspace with an open-tab intent. Pass extra params (e.g.
 * `chatId`, `tab`, `section`) to deep-link. Throws `NEXT_REDIRECT` (caught by
 * Next) and never returns, so a route returns its result.
 */
export function redirectToWorkspaceTab(
  open: string,
  params?: Record<string, string | undefined>
): never {
  const search = new URLSearchParams({ open })
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value)
    }
  }
  redirect(`/workspace?${search.toString()}`)
}
