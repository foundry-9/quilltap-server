/**
 * Who answers the Salon's document-level shortcuts (#263), and Escape pressed
 * inside a dialog (#304).
 */

import { salonOwnsKeyboard, isFromDialog } from '@/app/salon/[id]/salon-keyboard'
import type { WorkspaceState } from '@/lib/workspace/types'

function state(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    tabs: {
      salonA: { id: 'salonA', kind: 'salon', title: 'A' },
      salonB: { id: 'salonB', kind: 'salon', title: 'B' },
      termA: { id: 'termA', kind: 'terminal', title: 'Terminal', parentTabId: 'salonA' },
    },
    panes: {
      left: { order: ['salonA', 'salonB', 'termA'], activeTabId: 'salonA' },
      right: null,
    },
    focusedPane: 'left',
    splitRatio: 0.5,
    ...overrides,
  } as WorkspaceState
}

describe('salonOwnsKeyboard (#263)', () => {
  it('answers outside the workspace', () => {
    expect(salonOwnsKeyboard(null, null)).toBe(true)
    expect(salonOwnsKeyboard(state(), null)).toBe(true)
  })

  it('answers only for the Salon the focused pane shows', () => {
    expect(salonOwnsKeyboard(state(), 'salonA')).toBe(true)
    expect(salonOwnsKeyboard(state(), 'salonB')).toBe(false)
  })

  it("answers while one of the Salon's own child tabs is showing", () => {
    const s = state()
    s.panes.left.activeTabId = 'termA'
    expect(salonOwnsKeyboard(s, 'salonA')).toBe(true)
    expect(salonOwnsKeyboard(s, 'salonB')).toBe(false)
  })

  it('follows pane focus in a split', () => {
    const s = state({
      panes: {
        left: { order: ['salonA'], activeTabId: 'salonA' },
        right: { order: ['salonB'], activeTabId: 'salonB' },
      },
      focusedPane: 'right',
    })
    expect(salonOwnsKeyboard(s, 'salonA')).toBe(false)
    expect(salonOwnsKeyboard(s, 'salonB')).toBe(true)
  })
})

describe('isFromDialog (#304)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function keyFrom(target: Element): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }

  it('is true for a key pressed inside a dialog or alertdialog', () => {
    document.body.innerHTML = '<div role="dialog"><input id="a" /></div><div role="alertdialog"><button id="b"></button></div>'
    expect(isFromDialog(keyFrom(document.getElementById('a')!))).toBe(true)
    expect(isFromDialog(keyFrom(document.getElementById('b')!))).toBe(true)
  })

  it('is false for a key pressed in the page', () => {
    document.body.innerHTML = '<main><textarea id="c"></textarea></main>'
    expect(isFromDialog(keyFrom(document.getElementById('c')!))).toBe(false)
    expect(isFromDialog(keyFrom(document.body))).toBe(false)
  })
})
