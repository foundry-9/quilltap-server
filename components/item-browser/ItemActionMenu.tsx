'use client'

/**
 * The ⋮ menu every folder-of-items browser row carries (the wardrobe's, the
 * Inventory's, the Scriptorium's — items and folders alike), stated once.
 *
 * A row declares its actions as `MenuEntry` values; entries that are `false`,
 * `null` or `undefined` are dropped, so a row can write
 * `manageable && { … }` inline. The menu is fixed to the viewport beside its
 * button (`useFixedMenu`, so a scrolling list cannot clip it), and behaves as
 * a WAI-ARIA menu button:
 *
 *   - opening it focuses the first enabled entry;
 *   - ↓ / ↑ move between enabled entries (wrapping), Home / End jump to the
 *     ends;
 *   - Escape closes it and returns focus to the ⋮ button — swallowed in the
 *     capture phase, so an enclosing dialog stays open;
 *   - Tab, an outside click, a scroll outside the menu or a resize close it.
 *
 * Choosing an entry closes the menu, puts focus back on the button (a dialog
 * the action opens restores focus there when it closes), then runs it.
 *
 * @module components/item-browser/ItemActionMenu
 */

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useFixedMenu } from '@/hooks/useFixedMenu'
import { useClickOutside } from '@/hooks/useClickOutside'

export interface MenuEntry {
  /** Stable key; also the entry's `data-action`. */
  key: string
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** Rendered in the destructive colour (Delete). */
  destructive?: boolean
}

export type MenuEntryLike = MenuEntry | false | null | undefined

export interface ItemActionMenuProps {
  entries: readonly MenuEntryLike[]
  /** The ⋮ button's accessible name. */
  label?: string
  /** Disable the ⋮ button (a browser's select mode). */
  disabled?: boolean
  /** Room the menu wants below its button before it opens upward. */
  room?: number
  /** Tailwind min-width of the menu. */
  minWidthClass?: string
}

const ENTRY_CLASS = 'block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted disabled:opacity-50'

/** The entries a row declared, with the falsy ones dropped. */
export function presentEntries(entries: readonly MenuEntryLike[]): MenuEntry[] {
  return entries.filter((e): e is MenuEntry => Boolean(e))
}

function enabledMenuItems(list: HTMLUListElement | null): HTMLButtonElement[] {
  return Array.from(list?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])
}

export function ItemActionMenu({
  entries,
  label = 'More actions',
  disabled = false,
  room,
  minWidthClass = 'min-w-[14rem]',
}: ItemActionMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const { anchorRef, menuStyle, open, setOpen, close } = useFixedMenu(containerRef, room)
  const items = presentEntries(entries)

  const closeAndRefocus = useCallback(() => {
    close()
    anchorRef.current?.focus()
  }, [close, anchorRef])

  useClickOutside(containerRef, close, { enabled: open, onEscape: closeAndRefocus, escapeCapture: true })

  // Opening the menu puts focus on its first enabled entry — without
  // scrolling: the menu is fixed to the viewport, and a scroll the focus
  // provoked in an enclosing pane (a workspace tab) would close it again.
  useEffect(() => {
    if (open) enabledMenuItems(listRef.current)[0]?.focus({ preventScroll: true })
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const buttons = enabledMenuItems(listRef.current)
    if (buttons.length === 0) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = at < 0 ? buttons.length - 1 : (at - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'Tab') {
      close()
      return
    }
    if (next === null) return
    event.preventDefault()
    buttons[next].focus({ preventScroll: true })
  }

  if (items.length === 0) return null

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={anchorRef}
        type="button"
        className="qt-button-ghost qt-button-sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        ⋮
      </button>
      {open && (
        <div
          role="presentation"
          style={menuStyle ?? undefined}
          className={`z-30 ${minWidthClass} rounded border qt-border-default qt-bg-popover shadow-md`}
        >
          <ul ref={listRef} role="menu" aria-label={label} className="divide-y qt-border-default" onKeyDown={onMenuKeyDown}>
            {items.map((entry) => (
              <li key={entry.key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-action={entry.key}
                  tabIndex={-1}
                  disabled={entry.disabled}
                  className={`${ENTRY_CLASS}${entry.destructive ? ' qt-text-destructive' : ''}`}
                  onClick={() => {
                    closeAndRefocus()
                    entry.onSelect()
                  }}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
