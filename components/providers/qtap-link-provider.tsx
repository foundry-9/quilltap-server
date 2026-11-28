'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { QtapUriParts } from '@/lib/doc-edit/qtap-uri'
import { resolveDocumentExistsForChat } from '@/app/salon/[id]/hooks/documentModeApi'
import { openDocumentInChat } from '@/lib/documents/open-document-in-chat'
import ImageModal from '@/components/chat/ImageModal'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { QtapLinkContext, type QtapLinkOrigin, type QtapTargetKind, type QtapTargetResolution } from '@/components/qtap/QtapLinkContext'
import { apiFetch } from '@/lib/query/fetcher'
import { showErrorToast, showWarningToast } from '@/lib/toast'
import { standaloneDocKey, type DocumentStandaloneTabPayload, type WorkspaceState, type WorkspaceTab } from '@/lib/workspace/types'

interface QtapLinkProviderProps {
  children: ReactNode
}

interface ImageViewerState {
  src: string
  filename: string
}

function extractChatIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null
  const match = pathname.match(/^\/salon\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function getChatIdFromTab(tab: WorkspaceTab | undefined): string | null {
  if (!tab || !tab.payload || typeof tab.payload !== 'object') return null
  if (tab.kind !== 'salon' && tab.kind !== 'document' && tab.kind !== 'terminal') return null
  const chatId = (tab.payload as { chatId?: unknown }).chatId
  return typeof chatId === 'string' && chatId.length > 0 ? chatId : null
}

/**
 * The chat a qtap:// link belongs to — the tab it is rendered in, and nothing
 * else (#248). A link in a Salon (or its Document / Terminal pane, which render
 * inside the Salon's tab) resolves against that chat; a link anywhere else —
 * a files-browser preview, a help topic, the Almanack — belongs to no chat,
 * even when a Salon is open in the other pane. Without a tab id (a view
 * rendered outside any workspace tab) only the focused pane's active tab is
 * consulted; never "the first Salon in any pane".
 *
 * Exported for tests.
 */
export function chatIdForLink(
  state: WorkspaceState | undefined,
  pathname: string | null,
  tabId: string | null | undefined,
): string | null {
  const fromPath = extractChatIdFromPath(pathname)
  if (fromPath) return fromPath
  if (!state) return null
  if (tabId) return getChatIdFromTab(state.tabs[tabId])
  const focused = state.panes[state.focusedPane] ?? state.panes.left
  return focused.activeTabId ? getChatIdFromTab(state.tabs[focused.activeTabId]) : null
}

/** A target the chat-less route can address (no `self`, no on-disk `project`). */
function standaloneTarget(parts: QtapUriParts): { scope: 'document_store' | 'general'; mountPoint?: string; filePath: string } | null {
  if (parts.scope === 'project') return null
  if (parts.scope === 'document_store' && (!parts.mountPoint || parts.mountPoint.toLowerCase() === 'self')) return null
  return {
    scope: parts.scope === 'general' ? 'general' : 'document_store',
    ...(parts.mountPoint ? { mountPoint: parts.mountPoint } : {}),
    filePath: parts.path,
  }
}

function buildQtapTargetUrl(chatId: string, parts: QtapUriParts): string {
  const params = new URLSearchParams({
    filePath: parts.path,
    scope: parts.scope,
  })
  if (parts.mountPoint) {
    params.set('mountPoint', parts.mountPoint)
  }
  return `/api/v1/chats/${encodeURIComponent(chatId)}/qtap-target?${params.toString()}`
}

function basename(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

export function QtapLinkProvider({ children }: QtapLinkProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const ws = useWorkspaceOptional()
  const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null)

  const inWorkspace = ws !== null && pathname === '/workspace'
  const cacheRef = useRef<Map<string, Promise<QtapTargetResolution>>>(new Map())
  // Read at call time, so a workspace change does not hand every link a new
  // `resolve` (a tab's chat never changes under it).
  const stateRef = useRef(ws?.state)
  useLayoutEffect(() => {
    stateRef.current = ws?.state
  }, [ws?.state])

  const focusChat = useCallback((chatId: string) => {
    if (inWorkspace) {
      ws!.openTab('salon', { chatId }, { focus: true })
      return
    }
    if (extractChatIdFromPath(pathname) !== chatId) {
      router.push(`/salon/${encodeURIComponent(chatId)}`)
    }
  }, [inWorkspace, pathname, router, ws])

  const resolve = useCallback(async (parts: QtapUriParts, origin?: QtapLinkOrigin): Promise<QtapTargetResolution> => {
    const chatId = chatIdForLink(stateRef.current, pathname, origin?.tabId)
    const target = chatId ? null : standaloneTarget(parts)
    if (!chatId && !target) {
      return { exists: false, kind: 'other' }
    }

    const key = `${chatId ?? 'standalone'}|${parts.scope}|${parts.mountPoint ?? ''}|${parts.path}`
    const cached = cacheRef.current.get(key)
    if (cached) return cached

    const request = chatId
      ? resolveDocumentExistsForChat(chatId, { filePath: parts.path, scope: parts.scope, mountPoint: parts.mountPoint })
      : apiFetch<QtapTargetResolution>('/api/v1/documents?action=resolve-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(target),
        })
    const pending = request
      .then((result) => ({ exists: result.exists, kind: result.kind }))
      .catch(() => ({ exists: false, kind: 'other' as QtapTargetKind }))

    cacheRef.current.set(key, pending)
    return pending
  }, [pathname])

  const open = useCallback((parts: QtapUriParts, resolution: QtapTargetResolution, href: string, origin?: QtapLinkOrigin) => {
    if (resolution.kind === 'other') {
      showWarningToast(`We do not have a way to open ${href} yet.`)
      return
    }

    const chatId = chatIdForLink(stateRef.current, pathname, origin?.tabId)
    if (!chatId) {
      // Not in a chat: open it chat-less, so no conversation hears of it (#248).
      const target = standaloneTarget(parts)
      if (!target) {
        showWarningToast(`Open ${href} from its chat.`)
        return
      }
      const title = basename(target.filePath) || href
      if (inWorkspace) {
        const payload: DocumentStandaloneTabPayload = {
          docKey: standaloneDocKey(target.scope, target.mountPoint ?? null, target.filePath),
          scope: target.scope,
          mountPoint: target.mountPoint ?? null,
          filePath: target.filePath,
          displayTitle: title,
        }
        ws!.openTab('document-standalone', payload, { title, focus: true })
        return
      }
      const params = new URLSearchParams({ open: 'document-standalone', scope: target.scope, filePath: target.filePath })
      if (target.mountPoint) params.set('mountPoint', target.mountPoint)
      router.push(`/workspace?${params.toString()}`)
      return
    }

    if (resolution.kind === 'image') {
      setImageViewer({
        src: buildQtapTargetUrl(chatId, parts),
        filename: basename(parts.path) || href,
      })
      return
    }

    focusChat(chatId)
    void openDocumentInChat(
      chatId,
      { filePath: parts.path, scope: parts.scope, mountPoint: parts.mountPoint, mode: 'split' },
      { openTab: inWorkspace ? ws!.openTab : null },
    ).catch((error) => {
      showErrorToast(error instanceof Error ? error.message : 'Failed to open document')
    })
  }, [focusChat, inWorkspace, pathname, router, ws])

  const value = useMemo(() => ({ resolve, open }), [open, resolve])

  return (
    <QtapLinkContext.Provider value={value}>
      {children}
      <ImageModal
        isOpen={imageViewer !== null}
        onClose={() => setImageViewer(null)}
        src={imageViewer?.src ?? ''}
        filename={imageViewer?.filename ?? 'image'}
      />
    </QtapLinkContext.Provider>
  )
}