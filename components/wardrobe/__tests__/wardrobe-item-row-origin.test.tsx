/**
 * The origin chip on a Wardrobe dialog row.
 *
 * A garment borrowed from another wardrobe says *which* one — `Project ·
 * Thornfield`, not a bare "shared" — in the slot-badge chip family. A garment
 * the current view owns carries no chip, whatever its origin: "may this view
 * edit it" and "where did it come from" are different questions, and only a
 * borrowed row needs the second answered.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { render, screen } from '@testing-library/react'
import React from 'react'
import { WardrobeItemRow } from '@/components/wardrobe/wardrobe-item-row'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { ListedWardrobeItem, WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container'

function makeItem(overrides: Partial<ListedWardrobeItem> = {}): ListedWardrobeItem {
  return {
    id: 'item-1',
    characterId: null,
    title: 'Midnight Lightning Flapper Dress',
    types: ['top', 'bottom'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ListedWardrobeItem
}

function renderRow(item: ListedWardrobeItem, canManage?: (item: WardrobeItem) => boolean) {
  return render(
    <WardrobeItemRow
      item={item}
      allItems={[item]}
      inChat={false}
      canManage={canManage}
      onToggleDefault={jest.fn()}
      onEdit={jest.fn()}
      onDuplicate={jest.fn()}
      onMove={jest.fn()}
      onCopy={jest.fn()}
      onDelete={jest.fn()}
    />,
  )
}

const THORNFIELD: WardrobeOrigin = { scope: 'project', id: 'p1', name: 'Thornfield' }

describe('WardrobeItemRow — origin chip', () => {
  it('names the wardrobe a borrowed garment came from, as a shared-badge chip', () => {
    renderRow(makeItem({ origin: THORNFIELD }))
    const chip = screen.getByText('Project · Thornfield')
    expect(chip).toHaveClass('qt-badge', 'qt-badge-wardrobe-shared')
    expect(chip).toHaveAttribute('title', 'Borrowed from Project · Thornfield')
    expect(screen.queryByText('· shared')).not.toBeInTheDocument()
  })

  it('spells Quilltap General as a shared wardrobe', () => {
    renderRow(makeItem({ origin: { scope: 'general', id: null, name: 'Quilltap General' } }))
    expect(screen.getByText('Shared · Quilltap General')).toBeInTheDocument()
  })

  it('renders no chip for the character’s own garment', () => {
    const { container } = renderRow(
      makeItem({
        characterId: 'char-1',
        origin: { scope: 'character', id: 'char-1', name: 'Bertie' },
      }),
    )
    expect(container.querySelector('.qt-badge-wardrobe-shared')).toBeNull()
  })

  it('renders no chip in a project view, where every row is the project’s own', () => {
    const { container } = renderRow(makeItem({ origin: THORNFIELD }), () => true)
    expect(container.querySelector('.qt-badge-wardrobe-shared')).toBeNull()
  })
})
