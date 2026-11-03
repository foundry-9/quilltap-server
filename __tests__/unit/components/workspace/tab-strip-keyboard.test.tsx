/**
 * Workspace tab strip keyboard access (WCAG 2.1.1, 4.1.2): each tab is a real
 * `role="tab"` button — reachable by Tab when active, arrows/Home/End move and
 * select, Delete closes — and the close cross sits beside the tab rather than
 * nested inside it, hidden from assistive tech (a tablist may own only tabs).
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { TabStrip } from '@/components/workspace/TabStrip'
import type { WorkspaceTab } from '@/lib/workspace/types'

const tabs: Record<string, WorkspaceTab> = {
  a: { id: 'a', kind: 'home', title: 'Home' },
  b: { id: 'b', kind: 'home', title: 'Second' },
  c: { id: 'c', kind: 'home', title: 'Third' },
}

function renderStrip(activeTabId = 'a') {
  const onSelect = jest.fn()
  const onClose = jest.fn()
  render(
    <TabStrip
      pane="left"
      paneState={{ order: ['a', 'b', 'c'], activeTabId }}
      tabs={tabs}
      draggingId={null}
      onDragStartTab={jest.fn()}
      onDragEndTab={jest.fn()}
      onSelect={onSelect}
      onClose={onClose}
      onMove={jest.fn()}
    />,
  )
  return { onSelect, onClose }
}

describe('TabStrip keyboard access', () => {
  it('renders each tab as a button with role tab, only the active one tabbable', () => {
    renderStrip('b')
    const rendered = screen.getAllByRole('tab')
    expect(rendered).toHaveLength(3)
    expect(rendered.map((t) => t.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
    expect(rendered.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(rendered[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the close cross out of the tab and out of the tablist\'s accessible children', () => {
    const { onClose } = renderStrip()
    const tab = screen.getByRole('tab', { name: 'Home' })
    const close = tab.parentElement!.querySelector('.qt-tab-close') as HTMLElement
    expect(tab.contains(close)).toBe(false)
    expect(close).toHaveAttribute('aria-hidden', 'true')
    expect(close).toHaveAttribute('tabindex', '-1')
    expect(tab).toHaveAttribute('aria-keyshortcuts', 'Delete')
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledWith('a')
  })

  it('moves and selects with the arrow keys, wrapping at the ends', () => {
    const { onSelect } = renderStrip('a')
    const [first, , third] = screen.getAllByRole('tab')
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('b')
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(third, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
  })

  it('jumps with Home and End and closes with Delete', () => {
    const { onSelect, onClose } = renderStrip('b')
    const [, second] = screen.getAllByRole('tab')
    fireEvent.keyDown(second, { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(second, { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(second, { key: 'Delete' })
    expect(onClose).toHaveBeenCalledWith('b')
  })

  it('selects on click', () => {
    const { onSelect } = renderStrip('a')
    fireEvent.click(screen.getByRole('tab', { name: 'Third' }))
    expect(onSelect).toHaveBeenCalledWith('c')
  })
})
