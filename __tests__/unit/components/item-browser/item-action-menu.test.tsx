/**
 * The shared ⋮ menu (`ItemActionMenu`) every folder-of-items row carries:
 *
 *  - falsy entries are dropped, and a menu with nothing in it renders nothing;
 *  - opening it focuses the first enabled entry; ↓ / ↑ wrap, Home / End jump,
 *    disabled entries are skipped;
 *  - Escape closes it and returns focus to the ⋮ button;
 *  - an outside click closes it;
 *  - choosing an entry closes the menu and runs it;
 *  - a folder row's menu (`ItemFolderRow`) closes on Escape too.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import { ItemFolderRow } from '@/components/item-browser/ItemFolderRow'

const open = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
const items = () => screen.getAllByRole('menuitem')

describe('ItemActionMenu', () => {
  it('drops falsy entries and renders nothing when none remain', () => {
    const { container, rerender } = render(<ItemActionMenu entries={[false, null, undefined]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ItemActionMenu entries={[false, { key: 'edit', label: 'Edit', onSelect: jest.fn() }]} />)
    open()
    expect(items().map((b) => b.textContent)).toEqual(['Edit'])
  })

  it('focuses the first enabled entry and moves with the arrow keys, skipping disabled ones', () => {
    render(
      <ItemActionMenu
        entries={[
          { key: 'a', label: 'Alpha', onSelect: jest.fn(), disabled: true },
          { key: 'b', label: 'Bravo', onSelect: jest.fn() },
          { key: 'c', label: 'Charlie', onSelect: jest.fn() },
          { key: 'd', label: 'Delta', onSelect: jest.fn() },
        ]}
      />,
    )
    open()
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toHaveTextContent('Bravo')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Charlie')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toHaveTextContent('Delta')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Bravo')
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toHaveTextContent('Delta')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toHaveTextContent('Bravo')
  })

  it('closes on Escape and gives focus back to the button', () => {
    render(<ItemActionMenu entries={[{ key: 'edit', label: 'Edit', onSelect: jest.fn() }]} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More actions' }))
  })

  it('closes on an outside click', () => {
    render(
      <div>
        <p>elsewhere</p>
        <ItemActionMenu entries={[{ key: 'edit', label: 'Edit', onSelect: jest.fn() }]} />
      </div>,
    )
    open()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('runs the chosen entry and closes', () => {
    const onDelete = jest.fn()
    render(<ItemActionMenu entries={[{ key: 'delete', label: 'Delete', destructive: true, onSelect: onDelete }]} />)
    open()
    const del = screen.getByRole('menuitem', { name: 'Delete' })
    expect(del).toHaveClass('qt-text-destructive')
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('stays shut while disabled', () => {
    render(<ItemActionMenu disabled entries={[{ key: 'edit', label: 'Edit', onSelect: jest.fn() }]} />)
    expect(screen.getByRole('button', { name: 'More actions' })).toBeDisabled()
  })
})

describe('ItemFolderRow', () => {
  const row = { path: 'Formal', name: 'Formal', itemCount: 2 }

  it('closes its folder menu on Escape (it used to close only on mouse-leave)', () => {
    render(
      <ItemFolderRow row={row} manageable onOpen={jest.fn()} onRename={jest.fn()} onDelete={jest.fn()} testId="row" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions for Formal' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('puts extra entries between Rename and Delete', () => {
    render(
      <ItemFolderRow
        row={row}
        manageable
        onOpen={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
        testId="row"
        extraEntries={[{ key: 'copy', label: 'Copy to…', onSelect: jest.fn() }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Folder actions for Formal' }))
    expect(items().map((b) => b.textContent)).toEqual(['Rename', 'Copy to…', 'Delete'])
  })
})
