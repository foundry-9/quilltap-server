/**
 * Garment selection lists show the whole title and say where a borrowed
 * garment hangs.
 *
 * Several garments share their first few words ("Midnight Lightning
 * Flapper…"), so a list that clips titles to one line cannot be told apart.
 * Every list a person picks a garment from wraps instead of truncating, prints
 * its slots as display labels, and appends a borrowed garment's origin.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { EquippedSlotRow } from '@/components/wardrobe/equipped-slot-row'
import { OutfitQuickPick } from '@/components/wardrobe/outfit-quick-pick'
import { WardrobeComponentPicker } from '@/components/wardrobe/wardrobe-item-editor/WardrobeComponentPicker'
import type { CandidateItem } from '@/components/wardrobe/wardrobe-item-editor/types'
import type { ListedWardrobeItem } from '@/lib/wardrobe/wardrobe-container'

const LONG_TITLE = 'Midnight Lightning Flapper Dress with the Beaded Fringe and the Long Gloves'

function makeItem(overrides: Partial<ListedWardrobeItem> = {}): ListedWardrobeItem {
  return {
    id: 'item-1',
    characterId: null,
    title: LONG_TITLE,
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ListedWardrobeItem
}

describe('EquippedSlotRow picker', () => {
  function openPicker(items: ListedWardrobeItem[]) {
    render(
      <EquippedSlotRow
        slot="top"
        equippedIds={[]}
        allItems={items}
        onAdd={jest.fn()}
        onRemove={jest.fn()}
        onClear={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '+' }))
  }

  it('wraps the title instead of truncating it', () => {
    openPicker([makeItem()])
    const title = screen.getByText(LONG_TITLE)
    expect(title).not.toHaveClass('truncate')
    expect(title).toHaveClass('break-words', 'min-w-0')
  })

  it('prints slot labels and a borrowed garment’s origin', () => {
    openPicker([
      makeItem({
        types: ['bottom', 'top'],
        origin: { scope: 'project', id: 'p1', name: 'Thornfield' },
      }),
    ])
    expect(screen.getByText('Top, Bottom · Project · Thornfield')).toBeInTheDocument()
  })

  it('adds no origin for the character’s own garment', () => {
    openPicker([
      makeItem({
        characterId: 'char-1',
        origin: { scope: 'character', id: 'char-1', name: 'Bertie' },
      }),
    ])
    expect(screen.getByText(LONG_TITLE).nextElementSibling).toHaveTextContent(/^Top$/)
  })
})

describe('OutfitQuickPick', () => {
  it('wraps the title and keeps the replaces marker beside the origin', () => {
    render(
      <OutfitQuickPick
        items={[
          makeItem({ id: 'shirt', title: 'Shirt', characterId: 'char-1' }),
          makeItem({
            id: 'bundle',
            types: ['top', 'bottom'],
            componentItemIds: ['shirt'],
            replace: true,
            origin: { scope: 'group', id: 'g1', name: 'The Sisters' },
          }),
        ]}
        onWear={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Wear an outfit/ }))
    expect(screen.getByText(LONG_TITLE)).not.toHaveClass('truncate')
    expect(screen.getByText('Top, Bottom · replaces · Group · The Sisters')).toBeInTheDocument()
  })
})

describe('WardrobeComponentPicker candidates', () => {
  const borrowed: CandidateItem = {
    id: 'c1',
    title: LONG_TITLE,
    types: ['top'],
    componentItemIds: [],
    origin: { scope: 'general', id: null, name: 'Quilltap General' },
  }

  it('keeps the origin chip outside the wrapping title', () => {
    render(
      <WardrobeComponentPicker
        effectiveTypes={[]}
        selectedComponents={[]}
        componentSearch=""
        candidatesLoading={false}
        candidates={[borrowed]}
        eligibleCandidates={[borrowed]}
        groupedCandidates={new Map([['top', [borrowed]]])}
        expandedGroups={new Set(['top'])}
        componentItemIds={[]}
        replace={false}
        computedTypes={[]}
        showComponentsError={false}
        onComponentSearchChange={jest.fn()}
        onComponentsBlur={jest.fn()}
        onToggleComponent={jest.fn()}
        onToggleGroup={jest.fn()}
        onToggleType={jest.fn()}
        onReplaceChange={jest.fn()}
      />,
    )
    const title = screen.getByText(LONG_TITLE)
    expect(title).not.toHaveClass('truncate')
    const chip = screen.getByText('Shared · Quilltap General')
    expect(chip).toHaveClass('qt-badge-wardrobe-shared')
    expect(title).not.toContainElement(chip)
  })
})
