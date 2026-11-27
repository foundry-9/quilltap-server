/**
 * Regression coverage for useImageActions:
 *
 * - #297 — the hook froze the character list it was first handed. The viewer
 *   opens before the characters query resolves, so that list was empty and
 *   every "Saved to …'s photo album" toast read "character". The hook must
 *   read the list it is given now.
 * - #260 — an album picture has no images-v2 FileEntry, so "Save to gallery"
 *   must post its `linkId`, and only a plain image posts `fileId`.
 */

import { act, renderHook } from '@testing-library/react'
import { useImageActions } from '@/components/images/image-detail/hooks/useImageActions'
import type { Character, ImageData } from '@/components/images/image-detail/types'
import { showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/lib/download-utils', () => ({
  triggerDownload: jest.fn(),
}))

jest.mock('@/lib/clipboard-utils', () => ({
  copyImageToClipboard: jest.fn(),
}))

const image: ImageData = {
  id: 'img-1',
  filename: 'conservatory.webp',
  filepath: '/files/conservatory.webp',
  mimeType: 'image/webp',
  size: 1024,
  createdAt: '2026-08-01T00:00:00.000Z',
}

const EMPTY: Character[] = []
const CAST: Character[] = [{ id: 'char-1', name: 'Bertram' }]

// jest.setup replaces global.fetch with a plain jest.fn; own it per test.
const mockFetch = jest.fn()
function respond(body: unknown, ok = true) {
  mockFetch.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: async () => body })
}

beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch as unknown as typeof fetch
  ;(showSuccessToast as jest.Mock).mockClear()
})

describe('useImageActions — #297 (stale character names)', () => {
  it('labels the saved link with a character that arrived after the first render', async () => {
    respond({ linkId: 'link-9' })

    const { result, rerender } = renderHook(
      ({ characters }: { characters: Character[] }) => useImageActions(image, characters),
      { initialProps: { characters: EMPTY } }
    )
    rerender({ characters: CAST })

    await act(async () => {
      await result.current.addToCharacterGallery('char-1')
    })

    expect(showSuccessToast).toHaveBeenCalledWith("Saved to Bertram's photo album")
    expect(result.current.characterGalleryLinks).toEqual([
      { characterId: 'char-1', characterName: 'Bertram', linkId: 'link-9' },
    ])
  })
})

describe('useImageActions — #260 (save an album picture by its link)', () => {
  function postedBody(): unknown {
    const call = mockFetch.mock.calls.find(([url]) => url === '/api/v1/photos')
    expect(call).toBeDefined()
    return JSON.parse(String((call![1] as RequestInit).body))
  }

  it('posts { linkId } for an image that has one', async () => {
    respond({ data: {} })
    const { result } = renderHook(() => useImageActions({ ...image, linkId: 'link-7' }, EMPTY))

    await act(async () => {
      await result.current.handleSaveToGallery()
    })

    expect(postedBody()).toEqual({ linkId: 'link-7' })
  })

  it('posts { fileId } for an image without a linkId', async () => {
    respond({ data: {} })
    const { result } = renderHook(() => useImageActions(image, EMPTY))

    await act(async () => {
      await result.current.handleSaveToGallery()
    })

    expect(postedBody()).toEqual({ fileId: 'img-1' })
  })
})
