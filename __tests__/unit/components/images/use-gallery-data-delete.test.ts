/**
 * Regression coverage for #301 — the embedded gallery took a tile down
 * whenever the delete *finished*, not when the server accepted it, so a
 * refused delete made a picture vanish that was still there. `handleDeleteImage`
 * now answers whether the delete took, and only `true` removes the tile.
 */

import { act, renderHook } from '@testing-library/react'
import { useGalleryData } from '@/components/images/embedded-gallery/hooks/useGalleryData'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import type { GalleryImage } from '@/components/images/embedded-gallery/types'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/lib/download-utils', () => ({
  triggerDownload: jest.fn(),
}))

const mockRefetch = jest.fn()
jest.mock('@/components/images/embedded-gallery/hooks/useCharacterPhotosQuery', () => ({
  useCharacterPhotosQuery: () => ({ data: { entries: [] }, isLoading: false, refetch: mockRefetch }),
  toGalleryImage: (entry: unknown) => entry,
}))

// jest.setup replaces global.fetch with a plain jest.fn; own it per test.
const mockFetch = jest.fn()

const image = {
  id: 'link-1',
  filename: 'conservatory.webp',
  filepath: '/files/conservatory.webp',
} as unknown as GalleryImage

beforeEach(() => {
  mockFetch.mockReset()
  mockRefetch.mockReset()
  mockRefetch.mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
  ;(showErrorToast as jest.Mock).mockClear()
  ;(showSuccessToast as jest.Mock).mockClear()
})

function renderGallery() {
  const { wrapper } = createQueryWrapper()
  return renderHook(() => useGalleryData('char-1', 'character'), { wrapper })
}

describe('useGalleryData.handleDeleteImage — #301', () => {
  it('answers false and reports the error when the server refuses the delete', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'The vault is sealed' }),
    })
    const { result } = renderGallery()

    let deleted: boolean | undefined
    await act(async () => {
      deleted = await result.current.handleDeleteImage(image, undefined)
    })

    expect(deleted).toBe(false)
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/characters/char-1/photos/link-1', {
      method: 'DELETE',
    })
    expect(showErrorToast).toHaveBeenCalledWith('The vault is sealed')
    expect(showSuccessToast).not.toHaveBeenCalled()
  })

  it('answers true when the delete is accepted', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    const onAvatarChange = jest.fn()
    const { result } = renderGallery()

    let deleted: boolean | undefined
    await act(async () => {
      deleted = await result.current.handleDeleteImage(image, 'link-1', onAvatarChange)
    })

    expect(deleted).toBe(true)
    expect(mockRefetch).toHaveBeenCalled()
    expect(onAvatarChange).toHaveBeenCalledWith(null)
    expect(showSuccessToast).toHaveBeenCalledWith('Image deleted')
  })
})
