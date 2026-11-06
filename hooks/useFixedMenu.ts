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
 * An ancestor with a `transform`, `filter`, `backdrop-filter`, `perspective`,
 * paint/layout containment or a matching `will-change` captures
 * `position: fixed`: the menu is then placed against that ancestor's box, not
 * the viewport. `fixedContainingBlock` finds such an ancestor and the
 * placement subtracts its offset, so a menu in the character page's blurred
 * sticky header still lands beside its button. (The `qt-card` rule that lifts
 * a card with an open popup also clears its hover transform, so give the
 * button `aria-haspopup` and `aria-expanded`.)
 *
 * @module hooks/useFixedMenu
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/** Room the menu wants below its button before it opens upward instead. */
const DEFAULT_ROOM = 340
const GAP = 4

function capturesFixed(style: CSSStyleDeclaration): boolean {
  const set = (value: string | undefined) => Boolean(value) && value !== 'none'
  const willChange = style.willChange || ''
  const contain = style.contain || ''
  return (
    set(style.transform) ||
    set(style.perspective) ||
    set(style.filter) ||
    set(style.backdropFilter) ||
    set((style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter) ||
    /\b(transform|perspective|filter|backdrop-filter)\b/.test(willChange) ||
    /\b(paint|layout|strict|content)\b/.test(contain)
  )
}

/**
 * The nearest ancestor of `el` that captures `position: fixed`, or null when
 * the viewport is the containing block.
 */
export function fixedContainingBlock(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    if (capturesFixed(window.getComputedStyle(node))) return node
  }
  return null
}

/** Where a fixed menu sits beside `anchor`, right-aligned to it. */
export function fixedMenuPlacement(anchor: HTMLElement, room: number = DEFAULT_ROOM): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - GAP
  const above = rect.top - GAP
  const up = below < room && above > below
  // Offsets are measured against the containing block: the viewport, unless an
  // ancestor captures `position: fixed`, in which case its box stands in.
  const block = fixedContainingBlock(anchor)
  const box = block?.getBoundingClientRect()
  const blockTop = box?.top ?? 0
  const blockRight = box ? box.left + block!.clientLeft + block!.clientWidth : window.innerWidth
  const blockBottom = box ? box.top + block!.clientTop + block!.clientHeight : window.innerHeight
  return {
    position: 'fixed',
    right: Math.max(GAP, window.innerWidth - rect.right) - (window.innerWidth - blockRight),
    ...(up
      ? { bottom: blockBottom - rect.top + GAP }
      : { top: rect.bottom + GAP - blockTop - (block?.clientTop ?? 0) }),
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
