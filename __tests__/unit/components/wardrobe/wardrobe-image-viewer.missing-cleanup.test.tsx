/**
 * Bug 194 — a wardrobe picture whose bytes are gone.
 *
 * The full-screen viewer swaps in the missing-image placeholder; its Remove
 * used to post `DELETE /api/v1/images/{id}`, which knows nothing about
 * wardrobe links or the item's `imageFileId`, and refreshed no wardrobe read.
 * The wardrobe viewer now removes the picture through the images route's own
 * `delete-image` action and invalidates the wardrobe queries; every other
 * viewer keeps the generic delete.
 */

import React from 'react'
import { fireEvent, screen, waitFor, render } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { WardrobeImageViewer } from '@/components/wardrobe/wardrobe-image-viewer'
import { FullScreenImageViewer } from '@/components/images/FullScreenImageViewer'
import { queryKeys } from '@/lib/query/keys'

jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(async () => true),
}))
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))
jest.mock('@/app/salon/[id]/components/SaveImageDialog', () => ({
  SaveImageDialog: () => null,
}))

const ITEM_ID = 'item-1'
const FILE_ID = 'file-1'
const CHARACTER_ID = 'char-1'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  global.fetch = jest.fn(async () => jsonResponse({ current: null })) as unknown as typeof fetch
})

/** Make the picture fail to load, then press the placeholder's Remove. */
async function removeMissingPicture(): Promise<void> {
  const img = await screen.findByRole('img')
  fireEvent.error(img)
  fireEvent.click(await screen.findByText('Remove'))
}

describe('WardrobeImageViewer — missing-picture cleanup (bug 194)', () => {
  it('removes the picture through the wardrobe images route and refreshes the wardrobe', async () => {
    const onClose = jest.fn()
    const { queryClient } = renderWithQuery(
      <WardrobeImageViewer
        onClose={onClose}
        itemId={ITEM_ID}
        itemTitle="Opera coat"
        container={{ scope: 'character', id: CHARACTER_ID }}
        fileId={FILE_ID}
      />,
    )
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')

    await removeMissingPicture()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/wardrobe/${ITEM_ID}/images?scope=character&id=${CHARACTER_ID}&action=delete-image`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ fileId: FILE_ID })
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).startsWith('/api/v1/images/'))).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.wardrobe.all })
  })
})

describe('FullScreenImageViewer — default missing-picture cleanup', () => {
  it('still uses the generic image delete when no override is given', async () => {
    const onClose = jest.fn()
    render(
      <FullScreenImageViewer
        isOpen={true}
        onClose={onClose}
        src="/api/v1/files/file-9"
        alt="A picture"
        imageId="file-9"
        filename="x.webp"
      />,
    )

    await removeMissingPicture()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/images/file-9', { method: 'DELETE' })
  })
})
