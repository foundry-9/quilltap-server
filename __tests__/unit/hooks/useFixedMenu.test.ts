/**
 * useFixedMenu / fixedMenuPlacement — the viewport-fixed ⋮ menu shared by the
 * wardrobe, Inventory, scenario and folder rows. Placement opens downward when
 * there is room and upward when the room below is short and above is longer;
 * the open menu closes on resize and on any scroll outside its container.
 */

import { act, renderHook } from '@testing-library/react'
import { fixedMenuPlacement, useFixedMenu } from '@/hooks/useFixedMenu'

function anchorAt(top: number, bottom: number, right = 900): HTMLButtonElement {
  const button = document.createElement('button')
  button.getBoundingClientRect = () =>
    ({ top, bottom, right, left: right - 24, width: 24, height: bottom - top, x: right - 24, y: top }) as DOMRect
  return button
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
})

describe('fixedMenuPlacement', () => {
  it('opens downward, right-aligned, when there is room below', () => {
    expect(fixedMenuPlacement(anchorAt(100, 124))).toEqual({
      position: 'fixed',
      right: 100,
      top: 128,
      maxHeight: 800 - 124 - 4,
      overflowY: 'auto',
    })
  })

  it('opens upward when the room below is short and above is longer', () => {
    const style = fixedMenuPlacement(anchorAt(700, 724))
    expect(style.bottom).toBe(800 - 700 + 4)
    expect(style.top).toBeUndefined()
    expect(style.maxHeight).toBe(696)
  })

  it('stays downward when short below but shorter still above', () => {
    const style = fixedMenuPlacement(anchorAt(100, 124), 2000)
    expect(style.top).toBe(128)
    expect(style.bottom).toBeUndefined()
  })

  it('keeps a minimum height and a gap from the right edge', () => {
    const style = fixedMenuPlacement(anchorAt(770, 790, 1000))
    expect(style.right).toBe(4)
    expect(style.maxHeight).toBeGreaterThanOrEqual(120)
  })
})

describe('fixedMenuPlacement inside an ancestor that captures position: fixed', () => {
  it('places the menu against a backdrop-filtered ancestor, not the viewport', () => {
    const header = document.createElement('div')
    header.style.backdropFilter = 'blur(8px)'
    header.getBoundingClientRect = () =>
      ({ top: 50, left: 200, right: 950, bottom: 250, width: 750, height: 200, x: 200, y: 50 }) as DOMRect
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 750 })
    Object.defineProperty(header, 'clientHeight', { configurable: true, value: 200 })
    const button = anchorAt(100, 124, 900)
    header.appendChild(button)
    document.body.appendChild(header)
    try {
      // jsdom does not know backdrop-filter; report it the way a browser would.
      const real = window.getComputedStyle
      const spy = jest.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
        const style = real(el)
        if (el === header) return { ...style, backdropFilter: 'blur(8px)' } as CSSStyleDeclaration
        return style
      })
      const style = fixedMenuPlacement(button)
      spy.mockRestore()
      // The button's right edge sits 50px inside the header's; its bottom 74px below the header's top.
      expect(style.right).toBe(50)
      expect(style.top).toBe(124 + 4 - 50)
    } finally {
      header.remove()
    }
  })
})

describe('useFixedMenu', () => {
  let container: HTMLDivElement
  let inside: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    inside = document.createElement('div')
    container.appendChild(inside)
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  function renderOpenMenu() {
    const containerRef = { current: container }
    const hook = renderHook(() => useFixedMenu(containerRef))
    ;(hook.result.current.anchorRef as { current: HTMLButtonElement | null }).current = anchorAt(100, 124)
    act(() => hook.result.current.setOpen(true))
    return hook
  }

  it('starts closed and opens with a placement style', () => {
    const { result } = renderOpenMenu()
    expect(result.current.open).toBe(true)
    expect(result.current.menuStyle).toMatchObject({ position: 'fixed', top: 128 })
  })

  it('stays closed when opened without an anchor', () => {
    const { result } = renderHook(() => useFixedMenu({ current: container }))
    act(() => result.current.setOpen(true))
    expect(result.current.open).toBe(false)
  })

  it('ignores a scroll inside its container', () => {
    const { result } = renderOpenMenu()
    act(() => {
      inside.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.open).toBe(true)
  })

  it('closes on a scroll outside its container', () => {
    const { result } = renderOpenMenu()
    act(() => {
      document.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.open).toBe(false)
  })

  it('closes on resize', () => {
    const { result } = renderOpenMenu()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current.open).toBe(false)
  })
})
