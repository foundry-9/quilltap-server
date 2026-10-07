/**
 * Wardrobe item pictures in the UI.
 *
 * The editor's Picture section is present but inert while an item is being
 * created (there is no id to hang a picture on) and shows the current picture
 * with its caption once there is one. A row shows a 40 px thumbnail only when
 * the item has a current picture, and offers "Generate image" only on rows the
 * view manages — a borrowed garment is drawn by whoever manages its wardrobe.
 * The pickers show a 28 px thumbnail beside a candidate that has one.
 *
 * Design of record: docs/developer/features/complete/wardrobe-item-images.md §6
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { WardrobeItemRow } from '@/components/wardrobe/wardrobe-item-row'
import { EquippedSlotRow } from '@/components/wardrobe/equipped-slot-row'
import { WardrobeItemImageSection } from '@/components/wardrobe/wardrobe-item-editor/WardrobeItemImageSection'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { ListedWardrobeItem } from '@/lib/wardrobe/wardrobe-container'

function makeItem(overrides: Partial<ListedWardrobeItem> = {}): ListedWardrobeItem {
  return {
    id: 'item-1',
    characterId: 'char-1',
    title: 'Midnight Lightning Flapper Dress',
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

function renderRow(
  item: ListedWardrobeItem,
  opts: { canManage?: (item: WardrobeItem) => boolean; onGenerateImage?: jest.Mock } = {},
) {
  return render(
    <WardrobeItemRow
      item={item}
      allItems={[item]}
      inChat={false}
      canManage={opts.canManage}
      onToggleDefault={jest.fn()}
      onEdit={jest.fn()}
      onDuplicate={jest.fn()}
      onMove={jest.fn()}
      onCopy={jest.fn()}
      onDelete={jest.fn()}
      onGenerateImage={opts.onGenerateImage ?? jest.fn()}
    />,
  )
}

const IMAGES_BODY = {
  current: 'file-2',
  images: [
    {
      fileId: 'file-2',
      url: '/api/v1/files/file-2',
      thumbnailUrl: '/api/v1/files/file-2?action=thumbnail',
      source: 'GENERATED',
      createdAt: '2026-10-02T00:00:00.000Z',
      model: 'flux-pro',
    },
    {
      fileId: 'file-1',
      url: '/api/v1/files/file-1',
      thumbnailUrl: '/api/v1/files/file-1?action=thumbnail',
      source: 'UPLOADED',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
}

describe('WardrobeItemImageSection', () => {
  // `jest.setup.ts` assigns `global.fetch` directly, replacing jest-fetch-mock's
  // function, so `fetchMock.mockResponse(...)` would be a silent no-op. Stub it here.
  const realFetch = global.fetch
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/images')
        ? IMAGES_BODY
        : url.includes('/image-profiles')
          ? { profiles: [] }
          : {}
      return { ok: true, status: 200, statusText: 'OK', json: async () => body }
    })
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it('is present but inert in create mode', () => {
    renderWithQuery(<WardrobeItemImageSection item={null} container={null} />)
    expect(screen.getByTestId('wardrobe-item-image-section')).toBeInTheDocument()
    expect(
      screen.getByText('Save the item first; then it may sit for its portrait.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows the current picture, its history, and a catalogue caption for a shared item', async () => {
    renderWithQuery(
      <WardrobeItemImageSection
        item={makeItem({ characterId: null, imageFileId: 'file-2' }) as WardrobeItem}
        container={{ scope: 'general', id: null }}
      />,
    )

    const current = await screen.findByTestId('wardrobe-item-image-current')
    expect(current).toHaveAttribute('src', '/api/v1/files/file-2')
    expect(screen.getByTestId('wardrobe-item-image-caption')).toHaveTextContent(
      'Drawn by flux-pro · catalogue shot',
    )
    expect(screen.getAllByTestId('wardrobe-item-image-history-entry')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Make current' })).toHaveLength(1)
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).startsWith('/api/v1/wardrobe/item-1/images?scope=general'),
        ),
      ).toBe(true),
    )
  })
})

describe('WardrobeItemRow — picture', () => {
  it('shows a 40 px thumbnail when the item has a current picture', () => {
    renderRow(makeItem({ imageFileId: 'file-9' }))
    const thumb = screen.getByTestId('wardrobe-item-thumbnail')
    expect(thumb).toHaveAttribute('src', '/api/v1/files/file-9?action=thumbnail')
    expect(thumb).toHaveAttribute('width', '40')
  })

  it('shows no thumbnail when the item has no picture', () => {
    renderRow(makeItem({ imageFileId: null }))
    expect(screen.queryByTestId('wardrobe-item-thumbnail')).not.toBeInTheDocument()
  })

  it('offers "Generate image" on a manageable row, under Edit', () => {
    const onGenerateImage = jest.fn()
    const item = makeItem()
    renderRow(item, { onGenerateImage })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items.indexOf('Generate image')).toBe(items.indexOf('Edit') + 1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Generate image' }))
    expect(onGenerateImage).toHaveBeenCalledWith(item)
  })

  it('withholds "Generate image" from a borrowed row', () => {
    renderRow(
      makeItem({
        characterId: null,
        origin: { scope: 'general', id: null, name: 'Quilltap General' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Generate image' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Move' })).toBeInTheDocument()
  })
})

describe('Picker thumbnails', () => {
  it('shows a 28 px thumbnail beside a candidate that has a picture, and none otherwise', () => {
    render(
      <EquippedSlotRow
        slot="top"
        equippedIds={[]}
        allItems={[
          makeItem({ id: 'a', title: 'Pictured Blouse', imageFileId: 'file-a' }),
          makeItem({ id: 'b', title: 'Plain Blouse', imageFileId: null }),
        ]}
        onAdd={jest.fn()}
        onRemove={jest.fn()}
        onClear={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    const thumbs = screen.getAllByTestId('wardrobe-item-thumbnail')
    expect(thumbs).toHaveLength(1)
    expect(thumbs[0]).toHaveAttribute('src', '/api/v1/files/file-a?action=thumbnail')
    expect(thumbs[0]).toHaveAttribute('width', '28')
  })
})
