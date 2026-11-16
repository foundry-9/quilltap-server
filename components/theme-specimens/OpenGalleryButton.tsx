'use client'

/**
 * "Open the gallery" — opens Calliope's specimen gallery. Inside the
 * workspace it opens as a tab in the other pane (splitting it if need be),
 * so it sits beside the editor and repaints as the author works; outside,
 * it is a route.
 *
 * @module components/theme-specimens/OpenGalleryButton
 */

import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'

export function OpenGalleryButton({ className = 'qt-button qt-button-secondary qt-button-sm' }: { className?: string }) {
  const workspace = useWorkspaceOptional()
  const router = useRouter()
  const open = () => {
    if (!workspace) {
      router.push('/calliope/specimens')
      return
    }
    const beside = workspace.state.focusedPane === 'left' ? 'right' : 'left'
    workspace.openTab('theme-specimens', undefined, { pane: beside })
  }
  return (
    <button type="button" className={className} onClick={open}>
      <Icon name="layers" className="w-4 h-4" />
      <span className="ml-1">Open the gallery</span>
    </button>
  )
}
