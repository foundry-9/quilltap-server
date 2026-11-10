/**
 * The Atlas browser row's thumbnail: with a current picture and an
 * `onOpenImage` action it is a button that opens the picture full screen (as
 * a Wardrobe row's does); without a picture it is the Atlas icon and never a
 * button; without the action it is a plain, named picture.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AtlasEntryRow, type AtlasRowActions } from '@/components/atlas/atlas-entry-row'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'

const T = '2026-11-10T00:00:00.000Z'

const ENTRY: AtlasEntryWithOrigin = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Convertible',
  aliases: [],
  graphicPrompt: 'A cream 1930s roadster',
  knowledge: null,
  imageFileId: '00000000-0000-4000-8000-0000000000f1',
  metadata: {},
  folder: '',
  archivedAt: null,
  createdAt: T,
  updatedAt: T,
  origin: { scope: 'general', id: null, name: 'Quilltap General' },
}

function makeActions(overrides: Partial<AtlasRowActions> = {}): AtlasRowActions {
  return {
    onEdit: jest.fn(),
    onDuplicate: jest.fn(),
    onMoveToFolder: jest.fn(),
    onCopyToFolder: jest.fn(),
    onTransfer: jest.fn(),
    onToggleArchived: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  }
}

describe('AtlasEntryRow thumbnail', () => {
  it('opens the current picture full screen', () => {
    const onOpenImage = jest.fn()
    render(<AtlasEntryRow entry={ENTRY} manageable actions={makeActions({ onOpenImage })} />)

    const button = screen.getByRole('button', { name: 'View the picture of Convertible full size' })
    expect(button.querySelector('img')).toHaveAttribute('src', `/api/v1/files/${ENTRY.imageFileId}?action=thumbnail`)
    fireEvent.click(button)
    expect(onOpenImage).toHaveBeenCalledWith(ENTRY)
  })

  it('opens it for an entry borrowed from another tier and in select mode too', () => {
    const onOpenImage = jest.fn()
    render(
      <AtlasEntryRow
        entry={ENTRY}
        manageable={false}
        actions={makeActions({ onOpenImage })}
        selection={{ selected: false, onToggle: jest.fn() }}
      />,
    )
    fireEvent.click(screen.getByTestId('atlas-entry-picture-open'))
    expect(onOpenImage).toHaveBeenCalledWith(ENTRY)
  })

  it('is no button when the entry has no picture', () => {
    render(<AtlasEntryRow entry={{ ...ENTRY, imageFileId: null }} manageable actions={makeActions({ onOpenImage: jest.fn() })} />)
    expect(screen.queryByTestId('atlas-entry-picture-open')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('is a plain named picture without the action', () => {
    render(<AtlasEntryRow entry={ENTRY} manageable actions={makeActions()} />)
    expect(screen.queryByTestId('atlas-entry-picture-open')).toBeNull()
    expect(screen.getByRole('img', { name: 'Picture of Convertible' })).toBeInTheDocument()
  })
})
