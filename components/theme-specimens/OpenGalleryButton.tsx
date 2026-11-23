'use client'

/**
 * "Open the gallery" — opens Calliope's specimen gallery. Inside the
 * workspace it opens as a tab in the other pane (splitting it if need be),
 * so it sits beside the editor and repaints as the author works; outside,
 * it is a route.
 *
 * @module components/theme-specimens/OpenGalleryButton
 */

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'
import type { PaneId, WorkspaceState } from '@/lib/workspace/types'

/** The pane holding `tabId`, or null when it is in none (or outside the workspace). */
export function paneOfTab(state: WorkspaceState, tabId: string | null): PaneId | null {
  if (!tabId) return null
  if (state.panes.left.order.includes(tabId)) return 'left'
  if (state.panes.right?.order.includes(tabId)) return 'right'
  return null
}

/**
 * Opens the gallery: inside the workspace, a tab in the pane beside the one
 * the caller's tab is in (the focused pane when the caller is in none), so
 * the gallery never covers it; outside, the route.
 */
export function useOpenSpecimenGallery(): () => void {
  const workspace = useWorkspaceOptional()
  const router = useRouter()
  const tabId = useWorkspaceTabId()
  const here = workspace ? (paneOfTab(workspace.state, tabId) ?? workspace.state.focusedPane) : null
  const openTab = workspace?.openTab
  return useCallback(() => {
    if (!openTab) {
      router.push('/calliope/specimens')
      return
    }
    openTab('theme-specimens', undefined, { pane: here === 'left' ? 'right' : 'left' })
  }, [openTab, here, router])
}

export function OpenGalleryButton({ className = 'qt-button qt-button-secondary qt-button-sm' }: { className?: string }) {
  const open = useOpenSpecimenGallery()
  return (
    <button type="button" className={className} onClick={open}>
      <Icon name="layers" className="w-4 h-4" />
      <span className="ml-1">Open the gallery</span>
    </button>
  )
}
