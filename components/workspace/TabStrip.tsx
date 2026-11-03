'use client'

/**
 * A pane's tab bar: clickable tabs (active highlight), close affordance, and
 * HTML5 drag to reorder within the strip or move a tab into this pane from the
 * other one. Split/join via the center drop-zones lives in the host.
 *
 * @module components/workspace/TabStrip
 */

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Icon, type IconName } from '@/components/ui/icon'
import type { PaneId, PaneState, WorkspaceTab } from '@/lib/workspace/types'

export interface TabStripProps {
  pane: PaneId
  paneState: PaneState
  tabs: Record<string, WorkspaceTab>
  draggingId: string | null
  onDragStartTab: (id: string) => void
  onDragEndTab: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  /** Move the dragged tab into THIS pane at `toIndex`. */
  onMove: (id: string, toIndex: number) => void
}

export function TabStrip({
  pane,
  paneState,
  tabs,
  draggingId,
  onDragStartTab,
  onDragEndTab,
  onSelect,
  onClose,
  onMove,
}: TabStripProps) {
  const dragging = draggingId != null

  // Overflow: keep the active tab visible when the strip scrolls horizontally
  // (many tabs in a narrow pane). `block: 'nearest'` avoids vertical page jumps.
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)

  // Roving focus across the strip's tabs (WAI-ARIA tabs pattern): only the
  // active tab is a Tab stop; arrows / Home / End move focus and select.
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const order = paneState.order.filter((tid) => tabs[tid])
    const index = order.indexOf(id)
    if (index < 0) return
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (index + 1) % order.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + order.length) % order.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = order.length - 1
    else if (e.key === 'Delete') {
      e.preventDefault()
      onClose(order[index])
      return
    }
    if (next === null) return
    e.preventDefault()
    onSelect(order[next])
    const buttons = stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[next]?.focus()
  }

  useEffect(() => {
    // jsdom has no scrollIntoView; guard so tests (and any non-DOM host) are safe.
    if (typeof activeTabRef.current?.scrollIntoView === 'function') {
      activeTabRef.current.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [paneState.activeTabId])

  return (
    <div
      ref={stripRef}
      className="qt-tab-strip"
      data-pane={pane}
      role="tablist"
      onDragOver={(e) => {
        if (dragging) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!draggingId) return
        e.preventDefault()
        onMove(draggingId, paneState.order.length)
        onDragEndTab()
      }}
    >
      {paneState.order.map((id, index) => {
        const tab = tabs[id]
        if (!tab) return null
        const isActive = id === paneState.activeTabId
        const isDragging = id === draggingId
        return (
          <div
            key={id}
            ref={isActive ? activeTabRef : undefined}
            role="presentation"
            draggable
            className={
              'qt-tab' +
              (isActive ? ' qt-tab-active' : '') +
              (isDragging ? ' qt-tab-dragging' : '')
            }
            onClick={() => onSelect(id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', id)
              onDragStartTab(id)
            }}
            onDragEnd={onDragEndTab}
            onDragOver={(e) => {
              if (dragging) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            onDrop={(e) => {
              if (!draggingId) return
              e.preventDefault()
              e.stopPropagation()
              onMove(draggingId, index)
              onDragEndTab()
            }}
          >
            {/* The tab itself is a real button, so it is reachable and operable
                by keyboard; the close button sits beside it rather than inside
                it (an interactive control may not nest another). A tablist may
                own only tabs, so the close cross is a pointer convenience:
                hidden from assistive tech and out of the Tab order, with Delete
                on the focused tab as its keyboard equivalent. */}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              aria-keyshortcuts="Delete"
              className="qt-tab-select"
              onKeyDown={(e) => handleTabKeyDown(e, id)}
            >
              {tab.icon && <Icon name={tab.icon as IconName} className="qt-tab-icon" />}
              <span className="qt-tab-label">{tab.title}</span>
            </button>
            <button
              type="button"
              className="qt-tab-close"
              tabIndex={-1}
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation()
                onClose(id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Icon name="close" className="qt-tab-close-icon" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
