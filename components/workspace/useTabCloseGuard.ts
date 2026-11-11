'use client'

/**
 * useTabCloseGuard — let the workspace tab the caller is rendered in veto a
 * user-initiated close (tab strip ×, Delete on a tab, Ctrl/Cmd+Alt+W).
 *
 * The guard is registered once per tab and always calls the latest `guard`
 * passed in, so callers need not memoize it. Outside the workspace (a legacy
 * route, or no tab context) it does nothing. Programmatic closes through
 * `closeTab` are not guarded — see `requestCloseTab` in the workspace provider.
 *
 * @module components/workspace/useTabCloseGuard
 */

import { useEffect, useRef } from 'react'
import { useWorkspaceOptional, type TabCloseGuard } from '@/components/providers/workspace-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'

export function useTabCloseGuard(guard: TabCloseGuard): void {
  const registerCloseGuard = useWorkspaceOptional()?.registerCloseGuard
  const tabId = useWorkspaceTabId()
  const guardRef = useRef(guard)
  useEffect(() => {
    guardRef.current = guard
  }, [guard])

  useEffect(() => {
    if (!registerCloseGuard || !tabId) return
    return registerCloseGuard(tabId, () => guardRef.current())
  }, [registerCloseGuard, tabId])
}
