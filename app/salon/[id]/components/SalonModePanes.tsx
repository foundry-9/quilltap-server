'use client'

/**
 * SalonModePanes — routes the Salon's Document/Terminal "right pane" either to
 * the legacy in-chat {@link SplitLayout} (when rendered on the old `/salon/[id]`
 * route) or to sibling workspace tabs (when rendered inside the tabbed
 * workspace).
 *
 * In the workspace branch, the chat fills its own tab and the Document/Terminal
 * panes are **portaled** into their child tabs' DOM hosts. The panes stay
 * children of the Salon view's React tree — so their hooks and the live PTY /
 * editor are never remounted — while appearing in their own (possibly
 * other-pane) tab. Opening a mode spawns its child tab; turning it off closes
 * the tab; closing the tab turns the mode off. See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * The legacy branch is byte-for-byte the previous behavior, so the old route is
 * unaffected.
 *
 * @module app/salon/[id]/components/SalonModePanes
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import SplitLayout from './SplitLayout'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import {
  useWorkspaceTabId,
  useWorkspacePortalRegistry,
  portalKey,
} from '@/components/workspace/workspace-tab-context'

export interface SalonModePanesProps {
  parentChatId: string
  chatTitle?: string | null
  /** Combined legacy mode (normal/split/focus) — only used by SplitLayout. */
  mode: 'normal' | 'split' | 'focus'
  dividerPosition: number
  onDividerPositionChange: (position: number) => void
  rightPaneVerticalSplit: number
  onRightPaneVerticalSplitChange: (position: number) => void
  chatContent: ReactNode
  documentContent: ReactNode | null
  terminalContent: ReactNode | null
  /** Whether Document/Terminal mode is currently showing a pane. */
  documentActive: boolean
  terminalActive: boolean
  /** Turn the mode off for the chat (called when its child tab is closed). */
  onCloseDocument: () => void
  onCloseTerminal: () => void
}

export function SalonModePanes(props: SalonModePanesProps) {
  const {
    parentChatId,
    chatTitle,
    mode,
    dividerPosition,
    onDividerPositionChange,
    rightPaneVerticalSplit,
    onRightPaneVerticalSplitChange,
    chatContent,
    documentContent,
    terminalContent,
    documentActive,
    terminalActive,
    onCloseDocument,
    onCloseTerminal,
  } = props

  // Hooks are called unconditionally; they return null outside the workspace.
  const ws = useWorkspaceOptional()
  const parentTabId = useWorkspaceTabId()
  const registry = useWorkspacePortalRegistry()
  const inWorkspace = Boolean(ws && parentTabId && registry)

  const docTabRef = useRef<string | null>(null)
  const termTabRef = useRef<string | null>(null)

  // Reconcile the Document child tab with document-mode state.
  useEffect(() => {
    if (!inWorkspace || !ws || !parentTabId) return
    const tabs = ws.state.tabs
    if (documentActive) {
      const existing = docTabRef.current ? tabs[docTabRef.current] : undefined
      if (!existing) {
        if (docTabRef.current) {
          // We had a tab and it's gone → the user closed it → turn mode off.
          docTabRef.current = null
          onCloseDocument()
        } else {
          docTabRef.current = ws.openTab(
            'document',
            { chatId: parentChatId },
            { parentTabId, title: chatTitle ? `Document: ${chatTitle}` : 'Document' }
          )
        }
      }
    } else if (docTabRef.current) {
      if (tabs[docTabRef.current]) ws.closeTab(docTabRef.current)
      docTabRef.current = null
    }
  }, [inWorkspace, ws, parentTabId, parentChatId, chatTitle, documentActive, onCloseDocument])

  // Reconcile the Terminal child tab with terminal-mode state.
  useEffect(() => {
    if (!inWorkspace || !ws || !parentTabId) return
    const tabs = ws.state.tabs
    if (terminalActive) {
      const existing = termTabRef.current ? tabs[termTabRef.current] : undefined
      if (!existing) {
        if (termTabRef.current) {
          termTabRef.current = null
          onCloseTerminal()
        } else {
          termTabRef.current = ws.openTab(
            'terminal',
            { chatId: parentChatId },
            { parentTabId, title: chatTitle ? `Terminal: ${chatTitle}` : 'Terminal' }
          )
        }
      }
    } else if (termTabRef.current) {
      if (tabs[termTabRef.current]) ws.closeTab(termTabRef.current)
      termTabRef.current = null
    }
  }, [inWorkspace, ws, parentTabId, parentChatId, chatTitle, terminalActive, onCloseTerminal])

  if (!inWorkspace || !registry) {
    return (
      <SplitLayout
        mode={mode}
        dividerPosition={dividerPosition}
        onDividerPositionChange={onDividerPositionChange}
        rightPaneVerticalSplit={rightPaneVerticalSplit}
        onRightPaneVerticalSplitChange={onRightPaneVerticalSplitChange}
        chatContent={chatContent}
        documentContent={documentContent}
        terminalContent={terminalContent}
      />
    )
  }

  const docNode = registry.nodes[portalKey('document', parentChatId)] ?? null
  const termNode = registry.nodes[portalKey('terminal', parentChatId)] ?? null

  return (
    <div className="qt-doc-split-layout">
      <div className="qt-doc-chat-pane" style={{ flex: 1, minWidth: 0 }}>
        {chatContent}
      </div>
      {documentContent && docNode
        ? createPortal(<div className="qt-salon-portaled-pane">{documentContent}</div>, docNode)
        : null}
      {terminalContent && termNode
        ? createPortal(<div className="qt-salon-portaled-pane">{terminalContent}</div>, termNode)
        : null}
    </div>
  )
}
