'use client'

/**
 * A ⋮-style menu fixed to the viewport beside its button.
 *
 * A menu positioned `absolute` inside a scrolling list is clipped by that list
 * and painted under whatever sits below it (a dialog footer, the next row).
 * Fixing it to the viewport lets it escape both; it opens upward when the room
 * below is short and the room above is longer. A fixed menu would drift from
 * its button, so any scroll outside the container, or a resize, closes it.
 *
 * The card holding the button must not be transformed while the menu is open
 * (a transformed ancestor captures `position: fixed`): give the button
 * `aria-haspopup` and `aria-expanded`, and the `qt-card` rule that lifts a card
 * with an open popup also clears its hover transform.
 *
 * @module hooks/useFixedMenu
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/** Room the menu wants below its button before it opens upward instead. */
const DEFAULT_ROOM = 340
const GAP = 4

/** Where a fixed menu sits beside `anchor`, right-aligned to it. */
export function fixedMenuPlacement(anchor: HTMLElement, room: number = DEFAULT_ROOM): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - GAP
  const above = rect.top - GAP
  const up = below < room && above > below
  return {
    position: 'fixed',
    right: Math.max(GAP, window.innerWidth - rect.right),
    ...(up ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    maxHeight: Math.max(120, up ? above : below),
    overflowY: 'auto',
  }
}

export interface FixedMenu {
  /** Attach to the button the menu opens from. */
  anchorRef: RefObject<HTMLButtonElement | null>
  /** The menu's inline style; null while closed. */
  menuStyle: CSSProperties | null
  open: boolean
  setOpen: (open: boolean) => void
  close: () => void
}

/**
 * @param containerRef - Wraps the button and the menu; scrolling inside it
 *   (the menu's own overflow) does not close the menu.
 */
export function useFixedMenu(containerRef: RefObject<HTMLElement | null>, room: number = DEFAULT_ROOM): FixedMenu {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const open = menuStyle !== null
  const setOpen = useCallback(
    (next: boolean) => setMenuStyle(next && anchorRef.current ? fixedMenuPlacement(anchorRef.current, room) : null),
    [room],
  )
  const close = useCallback(() => setMenuStyle(null), [])

  useEffect(() => {
    if (!open) return
    const onScroll = (event: Event) => {
      if (containerRef.current && event.target instanceof Node && containerRef.current.contains(event.target)) return
      close()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close, containerRef])

  return { anchorRef, menuStyle, open, setOpen, close }
}
