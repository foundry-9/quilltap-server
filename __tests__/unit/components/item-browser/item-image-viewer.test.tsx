/**
 * The shared item picture viewer (`components/item-browser/ItemImageViewer`),
 * for both kinds: the picture and its filename, the save target handed to
 * the store dialog, and the missing-picture Remove going through the kind's
 * own images route (bug 194) and refreshing the kind's queries.
 */

import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { ItemImageViewer, pictureFilename } from '@/components/item-browser/ItemImageViewer'
import { queryKeys } from '@/lib/query/keys'
import type { ItemKind } from '@/lib/folder-browser/item-kind'

jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn(async () => true) }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
const mockSaveDialog = jest.fn()
jest.mock('@/app/salon/[id]/components/SaveImageDialog', () => ({
  SaveImageDialog: (props: unknown) => {
    mockSaveDialog(props)
    return null
  },
}))

const CONTAINER = { scope: 'character' as const, id: 'char-1' }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

beforeEach(() => {
  mockSaveDialog.mockClear()
  global.fetch = jest.fn(async () => jsonResponse({ current: null })) as unknown as typeof fetch
})

const CASES: Array<{ kind: ItemKind; deleteUrl: string; refreshKey: readonly unknown[] }> = [
  {
    kind: 'wardrobe',
    deleteUrl: '/api/v1/wardrobe/item-1/images?scope=character&id=char-1&action=delete-image',
    refreshKey: queryKeys.wardrobe.all,
  },
  {
    kind: 'inventory',
    deleteUrl: '/api/v1/inventory/item-1/images?scope=character&id=char-1&action=delete-image',
    refreshKey: queryKeys.inventory.all,
  },
]

describe.each(CASES)('ItemImageViewer ($kind)', ({ kind, deleteUrl, refreshKey }) => {
  function renderViewer(onClose = jest.fn()) {
    return renderWithQuery(
      <ItemImageViewer
        kind={kind}
        onClose={onClose}
        itemId="item-1"
        itemTitle="Opera coat"
        container={CONTAINER}
        fileId="file-1"
        note="Current picture"
      />,
    )
  }

  it('shows the picture with its caption and saves to the kind\'s images route', async () => {
    renderViewer()
    expect(await screen.findByRole('img')).toHaveAttribute('src', '/api/v1/files/file-1')
    expect(screen.getByText('Current picture')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save to a document store' }))
    await waitFor(() => expect(mockSaveDialog).toHaveBeenCalled())
    expect(mockSaveDialog.mock.calls[0][0]).toMatchObject({
      target: { kind, itemId: 'item-1', container: CONTAINER, fileId: 'file-1' },
      attachments: [{ id: 'file-1', filename: 'Opera_coat.webp', mimeType: 'image/webp' }],
    })
  })

  it('removes a missing picture through the kind\'s images route and refreshes the kind', async () => {
    const onClose = jest.fn()
    const { queryClient } = renderViewer(onClose)
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')

    fireEvent.error(await screen.findByRole('img'))
    fireEvent.click(await screen.findByText('Remove'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(deleteUrl)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ fileId: 'file-1' })
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).startsWith('/api/v1/images/'))).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: refreshKey })
  })
})

describe('pictureFilename', () => {
  it('slugs the title, falling back to the kind\'s stem', () => {
    expect(pictureFilename('Blue Velvet Gown', 'wardrobe_item')).toBe('Blue_Velvet_Gown.webp')
    expect(pictureFilename('***', 'inventory_object')).toBe('inventory_object.webp')
  })
})
