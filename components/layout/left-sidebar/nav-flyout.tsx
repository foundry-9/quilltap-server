'use client'

/**
 * The rail's flyout: the open menu (a group or the profile menu) or panel
 * (themes, quick-hide), portalled to `document.body`.
 *
 * `.qt-workspace` is `isolation: isolate`, so a flyout left inside the rail
 * would sit under the workspace toolbar. One flyout is open at a time (the
 * rail context holds which). It opens on click, never hover; Escape, an
 * outside click or a choice closes it and focus returns to its rail button.
 * Menus are `role="menu"` with Up/Down/Home/End; Left closes. At phone width
 * the flyout is a sheet along the bottom of the screen.
 *
 * @module components/layout/left-sidebar/nav-flyout
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui/icon'
import { NavUserMenuThemeContent } from '@/components/dashboard/nav-user-menu-theme'
import { NavUserMenuQuickHideContent } from '@/components/dashboard/nav-user-menu-quick-hide'
import { NAV_GROUPS, NAV_PROFILE, type NavItem, type NavItemId } from '@/lib/navigation/registry'
import { railButtonFor, useNavRail, type OpenNavMenu } from './nav-rail-context'

/** Below this width the flyout is a bottom sheet (Tailwind's `sm`). */
const SHEET_MAX_WIDTH = 639
/** Gap between the rail button and the flyout, and the viewport margin. */
const GAP = 6
const MARGIN = 8

const PANEL_TITLES = { themes: 'Theme', 'quick-hide': 'Quick-hide' } as const

/** The id of a flyout's menu (or panel), for its button's `aria-controls`. */
export function navFlyoutId(id: OpenNavMenu['id']): string {
  return `qt-nav-flyout-${id}`
}

function menuFor(id: OpenNavMenu['id']): { label: string; items: readonly NavItem<NavItemId>[] } | null {
  if (id === NAV_PROFILE.id) return NAV_PROFILE
  return NAV_GROUPS.find((group) => group.id === id) ?? null
}

function useIsSheet(): boolean {
  const query = `(max-width: ${SHEET_MAX_WIDTH}px)`
  const [isSheet, setIsSheet] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true)
  useEffect(() => {
    const mql = window.matchMedia?.(query)
    if (!mql) return
    const onChange = () => setIsSheet(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return isSheet
}

/**
 * Beside the rail button, top-aligned with it, clamped to the viewport. A
 * pinned button's flyout (near the bottom of the rail) opens upward.
 */
function placeBeside(anchor: HTMLElement, flyout: HTMLElement): CSSProperties {
  const a = anchor.getBoundingClientRect()
  const height = flyout.offsetHeight
  const left = a.right + GAP
  const opensUpward = a.top > window.innerHeight / 2
  let top = opensUpward ? a.bottom - height : a.top
  top = Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN))
  return { position: 'fixed', left, top }
}

export function NavFlyout() {
  const { openMenu } = useNavRail()
  if (!openMenu || typeof document === 'undefined') return null
  // Keyed by menu so switching menus starts each fresh (position, focus).
  return createPortal(<FlyoutBody key={openMenu.id} menu={openMenu} />, document.body)
}

function FlyoutBody({ menu }: { menu: OpenNavMenu }) {
  const { closeFlyout, activate, availability } = useNavRail()
  const ref = useRef<HTMLDivElement>(null)
  const isSheet = useIsSheet()
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })
  const group = menuFor(menu.id)
  const headingId = `qt-nav-flyout-${menu.id}-heading`

  // Place it once it has a size; again when the window changes.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      const anchor = railButtonFor(menu.anchor)
      if (!el) return
      if (isSheet || !anchor) setStyle({})
      else setStyle(placeBeside(anchor, el))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [menu.anchor, isSheet])

  // Focus into the flyout on open: the first row for a menu opened from the
  // keyboard, the flyout itself otherwise (so Escape and arrows work).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const firstRow = el.querySelector<HTMLElement>('[role="menuitem"]')
    const firstControl = el.querySelector<HTMLElement>('button, a[href], input')
    if (firstRow) firstRow.focus()
    else if (menu.focusFirst && firstControl) firstControl.focus()
    else el.focus()
  }, [menu.focusFirst])

  // An outside click closes without stealing focus back to the rail; a click
  // on the anchor button is left to its own toggle.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target)) return
      if (railButtonFor(menu.anchor)?.contains(target)) return
      closeFlyout({ restoreFocus: false })
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menu.anchor, closeFlyout])

  // Escape is heard at the document: a panel's content may re-render and drop
  // focus to <body>, where the flyout's own handler would never see the key.
  // Focus elsewhere (another dialog, the Brahma Console) keeps its Escape.
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const active = document.activeElement
      const ours =
        !active ||
        active === document.body ||
        ref.current?.contains(active) ||
        railButtonFor(menu.anchor)?.contains(active)
      if (!ours) return
      event.preventDefault()
      event.stopPropagation()
      closeFlyout()
    }
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [menu.anchor, closeFlyout])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!group) return
      if (event.key === 'Tab') {
        event.preventDefault()
        closeFlyout()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        closeFlyout()
        return
      }
      const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      if (rows.length === 0) return
      const at = rows.indexOf(document.activeElement as HTMLElement)
      let next: number | null = null
      if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % rows.length
      else if (event.key === 'ArrowUp') next = at < 0 ? rows.length - 1 : (at - 1 + rows.length) % rows.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = rows.length - 1
      if (next !== null) {
        event.preventDefault()
        rows[next].focus()
      }
    },
    [group, closeFlyout],
  )

  const choose = (item: NavItem<NavItemId>, event: MouseEvent<HTMLElement>) => {
    // A modifier- or middle-click on a destination is the browser's (new tab).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return
    event.preventDefault()
    if (availability(item.id).disabled) return
    activate(item.id)
  }

  const className = `qt-left-sidebar-popout${isSheet ? ' qt-left-sidebar-popout-sheet' : ''}`

  if (!group) {
    const panel = menu.id as keyof typeof PANEL_TITLES
    return (
      <div
        ref={ref}
        id={navFlyoutId(menu.id)}
        role="dialog"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={className}
        style={style}
        data-nav-menu={menu.id}
        onKeyDown={onKeyDown}
      >
        <p id={headingId} className="qt-left-sidebar-menu-heading">{PANEL_TITLES[panel]}</p>
        {panel === 'themes' ? (
          <NavUserMenuThemeContent onThemeSelected={() => closeFlyout()} />
        ) : (
          <NavUserMenuQuickHideContent />
        )}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={className}
      style={style}
      data-nav-menu={menu.id}
      onKeyDown={onKeyDown}
    >
      <p id={headingId} className="qt-left-sidebar-menu-heading">{group.label}</p>
      <div role="menu" id={navFlyoutId(menu.id)} aria-labelledby={headingId} className="qt-left-sidebar-menu">
      {group.items.map((item) => {
        const { disabled, reason } = availability(item.id)
        const reasonId = reason ? `qt-nav-reason-${item.id}` : undefined
        const body = (
          <>
            <Icon name={item.icon} className="qt-left-sidebar-menu-item-icon w-5 h-5" />
            <span className="qt-left-sidebar-menu-item-text">
              <span className="qt-left-sidebar-menu-item-label">{item.label}</span>
              {reason && <span id={reasonId} className="qt-left-sidebar-menu-item-reason">{reason}</span>}
            </span>
          </>
        )
        if (item.target.type === 'destination' && !disabled) {
          return (
            <a
              key={item.id}
              role="menuitem"
              href={item.target.href}
              className="qt-left-sidebar-menu-item"
              data-nav={item.id}
              tabIndex={-1}
              onClick={(e) => choose(item, e)}
            >
              {body}
            </a>
          )
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="qt-left-sidebar-menu-item"
            data-nav={item.id}
            tabIndex={-1}
            aria-disabled={disabled || undefined}
            aria-describedby={reasonId}
            onClick={(e) => choose(item, e)}
          >
            {body}
          </button>
        )
      })}
      </div>
    </div>
  )
}
