/**
 * The one read of a character's photo album, shared by the Aurora gallery and
 * PhotoGalleryModal's album mode.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper, createTestQueryClient } from '../../../helpers/renderWithQuery'
import {
  toGalleryImage,
  useCharacterPhotosQuery,
  type CharacterGalleryEntry,
} from '@/components/images/embedded-gallery/hooks/useCharacterPhotosQuery'
import { queryKeys } from '@/lib/query/keys'

const mockFetch = global.fetch as jest.Mock

const entry: CharacterGalleryEntry = {
  linkId: 'link-1',
  mountPointId: 'mp-1',
  relativePath: 'photos/a.webp',
  fileName: 'a.webp',
  blobUrl: '/api/v1/blobs/a',
  mimeType: 'image/webp',
  sha256: 'abc',
  fileSizeBytes: 1234,
  keptAt: '2026-01-01T00:00:00.000Z',
  caption: 'At the races',
  tags: ['t1'],
}

describe('toGalleryImage', () => {
  it('keys the image by its link id and maps the entry fields', () => {
    expect(toGalleryImage(entry)).toEqual({
      id: 'link-1',
      filename: 'a.webp',
      filepath: '/api/v1/blobs/a',
      mimeType: 'image/webp',
      size: 1234,
      createdAt: '2026-01-01T00:00:00.000Z',
      caption: 'At the races',
      tags: ['t1'],
      generationModeration: null,
    })
  })
})

describe('useCharacterPhotosQuery', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: [entry], total: 1, hasMore: false }),
    })
  })

  it('reads the whole album under the characters.photos key', async () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useCharacterPhotosQuery('char-1'), (createQueryWrapper(client)))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/characters/char-1/photos?limit=200')
    expect(client.getQueryData(queryKeys.characters.photos('char-1'))).toEqual({
      entries: [entry],
      total: 1,
      hasMore: false,
    })
  })

  it('does not read without a character or when disabled', () => {
    renderHook(() => useCharacterPhotosQuery(''), (createQueryWrapper()))
    renderHook(() => useCharacterPhotosQuery('char-1', { enabled: false }), (createQueryWrapper()))
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
