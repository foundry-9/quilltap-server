'use client'

/**
 * Sidebar Footer
 *
 * The bottom of the rail, drawn from the registry's pinned items (Help,
 * Quick-hide, Settings) plus the profile button. Each stays one click away:
 * Help and Settings are what a lost operator looks for, and Quick-hide is a
 * privacy control a menu would defeat.
 *
 * @module components/layout/left-sidebar/sidebar-footer
 */

import { useCallback, useState, type MouseEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuickHide } from '@/components/providers/quick-hide-provider'
import { QuickHideIcon } from '@/components/dashboard/nav-user-menu-quick-hide'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { standaloneDocKey, type DocumentStandaloneTabPayload } from '@/lib/workspace/types'
import { NAV_PINNED, navItemTabKinds } from '@/lib/navigation/registry'
import { Icon } from '@/components/ui/icon'
import { ProfileMenu } from './profile-menu'
import { useNavRail } from './nav-rail-context'
import { navFlyoutId } from './nav-flyout'
import { isPlainClick, useCurrentTabKind } from './collapsed-nav'

// Lazy-load the picker: the sidebar is on every page, and the modal (with its
// file browser) is only needed once Open Document… is chosen.
const DocumentPickerModal = dynamic(
  () => import('@/app/salon/[id]/components/DocumentPickerModal'),
  { ssr: false },
)

export function SidebarFooter() {
  const quickHide = useQuickHide()
  const { activate, availability, openMenu, toggleFlyout } = useNavRail()
  const currentKind = useCurrentTabKind()

  // Hydration-safe: the hidden state lives in the browser.
  const [mounted] = useState(() => typeof window !== 'undefined')
  const hasAnyHidden = mounted && (quickHide.hiddenTagIds.size > 0 || quickHide.hideDangerousChats || quickHide.hideSalonImages)

  return (
    <div className="qt-left-sidebar-footer">
      <div className="qt-left-sidebar-footer-actions">
        {NAV_PINNED.map((item) => {
          if (item.id === 'quick-hide') {
            const isOpen = openMenu?.id === 'quick-hide'
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleFlyout('quick-hide', 'quick-hide', { focusFirst: true })}
                data-nav={item.id}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls={isOpen ? navFlyoutId('quick-hide') : undefined}
                className="qt-left-sidebar-item"
                title={hasAnyHidden ? `${item.label} (some things are hidden)` : item.label}
                aria-label={item.label}
              >
                <QuickHideIcon hasHidden={hasAnyHidden} className="qt-left-sidebar-item-icon w-7 h-7" />
              </button>
            )
          }
          if (item.target.type === 'destination') {
            const current = currentKind && navItemTabKinds(item).includes(currentKind) ? ('page' as const) : undefined
            return (
              <a
                key={item.id}
                href={item.target.href}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (!isPlainClick(event)) return
                  event.preventDefault()
                  activate(item.id)
                }}
                data-nav={item.id}
                aria-current={current}
                className="qt-left-sidebar-item"
                title={item.label}
                aria-label={item.label}
              >
                <Icon name={item.icon} className="qt-left-sidebar-item-icon w-7 h-7" />
              </a>
            )
          }
          const { disabled, reason } = availability(item.id)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => activate(item.id)}
              data-nav={item.id}
              disabled={disabled}
              className="qt-left-sidebar-item"
              title={reason ? `${item.label} (${reason.toLowerCase()})` : item.label}
              aria-label={item.label}
            >
              <Icon name={item.icon} className="qt-left-sidebar-item-icon w-7 h-7" />
            </button>
          )
        })}
      </div>

      <ProfileMenu />

      <StandaloneDocumentPicker />
    </div>
  )
}

/**
 * Open Document…: pick a file and open it as a standalone (chat-less)
 * Document Mode tab. No conversation is attached, so nothing is announced
 * when it is edited.
 */
function StandaloneDocumentPicker() {
  const { showDocumentPicker, setShowDocumentPicker } = useNavRail()
  const workspace = useWorkspaceOptional()
  const pathname = usePathname()
  const router = useRouter()
  const inWorkspace = Boolean(workspace) && pathname === '/workspace'

  const handleSelectDocument = useCallback((params: {
    filePath?: string
    title?: string
    scope?: 'project' | 'document_store' | 'general'
    mountPoint?: string
    targetFolder?: string
  }) => {
    setShowDocumentPicker(false)
    // The standalone surface has no project context; `project` can't arrive
    // from a chat-less picker, but map it defensively.
    const scope: DocumentStandaloneTabPayload['scope'] =
      params.scope === 'document_store' ? 'document_store' : 'general'

    if (inWorkspace) {
      const payload: DocumentStandaloneTabPayload = {
        docKey: standaloneDocKey(scope, params.mountPoint ?? null, params.filePath),
        scope,
        mountPoint: params.mountPoint ?? null,
        filePath: params.filePath,
        targetFolder: params.targetFolder,
        displayTitle: params.title,
      }
      const title = params.filePath?.split('/').pop() || params.title || 'New Document'
      workspace!.openTab('document-standalone', payload, { title })
      return
    }

    // Outside the workspace: funnel into it with an `?open=` intent, which
    // mints the tab (and its docKey) on arrival.
    const sp = new URLSearchParams({ open: 'document-standalone', scope })
    if (params.mountPoint) sp.set('mountPoint', params.mountPoint)
    if (params.filePath) sp.set('filePath', params.filePath)
    if (params.targetFolder) sp.set('targetFolder', params.targetFolder)
    router.push(`/workspace?${sp.toString()}`)
  }, [inWorkspace, workspace, router, setShowDocumentPicker])

  if (!showDocumentPicker) return null
  // chatId null means "look everywhere" and no conversation is notified of edits.
  return (
    <DocumentPickerModal
      isOpen={showDocumentPicker}
      onClose={() => setShowDocumentPicker(false)}
      chatId={null}
      onSelectDocument={handleSelectDocument}
    />
  )
}
