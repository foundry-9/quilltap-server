'use client'

/**
 * The select-mode bar of a folder-of-items browser: how many are selected,
 * the filing buttons the browser supplies, and Cancel.
 *
 * @module components/item-browser/ItemSelectBar
 */

import type { ReactNode } from 'react'

export interface ItemSelectBarProps {
  count: number
  /** Stick to the bottom of a scrolling list. */
  sticky: boolean
  onCancel: () => void
  /** `data-testid`, e.g. `wardrobe-select-bar`. */
  testId: string
  children: ReactNode
}

export function ItemSelectBar({ count, sticky, onCancel, testId, children }: ItemSelectBarProps) {
  return (
    <div
      className={`${sticky ? 'sticky bottom-0' : ''} mt-2 flex items-center justify-between gap-2 rounded border qt-border-default qt-bg-default px-3 py-2 shadow-sm`}
      data-testid={testId}
    >
      <span className="qt-text-xs qt-text-secondary">{count} selected</span>
      <div className="flex items-center gap-2">
        {children}
        <button type="button" className="qt-button-ghost qt-button-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
