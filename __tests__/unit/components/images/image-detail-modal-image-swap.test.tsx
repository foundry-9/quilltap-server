/**
 * Regression coverage for #300 — the image viewer stays mounted while Prev /
 * Next swap its `image` prop, so a broken-image placeholder raised for one
 * picture used to carry over to every picture after it. And for #260 — an
 * album picture's character links are looked up by its link id, not by an
 * images-v2 id it does not have.
 */

import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import ImageDetailModal from '@/components/images/image-detail/ImageDetailModal'
import type { ImageData } from '@/components/images/image-detail/types'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/hooks/useImageNavigation', () => ({
  useImageNavigation: jest.fn(),
}))

jest.mock('@/lib/hooks/use-characters-list', () => ({
  useCharactersList: () => ({ data: [], isLoading: false }),
}))

// Stable across renders, as the real hook's `useCallback` is, so the lookup
// effect does not re-run on every render.
const mockUpdateLinks = jest.fn()
const mockActions = {
  characterGalleryLinks: [],
  savingToGalleryFor: new Set<string>(),
  settingAvatar: new Set<string>(),
  addToCharacterGallery: jest.fn(),
  removeFromCharacterGallery: jest.fn(),
  setAsAvatar: jest.fn(),
  handleDownload: jest.fn(),
  handleCopyToClipboard: jest.fn(),
  handleSaveToGallery: jest.fn(),
  savingToGallery: false,
  updateCharacterGalleryLinks: mockUpdateLinks,
}
jest.mock('@/components/images/image-detail/hooks/useImageActions', () => ({
  useImageActions: () => mockActions,
}))

jest.mock('@/components/images/image-detail/ImageActions', () => ({
  ImageActions: () => <div data-testid="image-actions">actions</div>,
}))

jest.mock('@/components/images/image-detail/ImageMetadata', () => ({
  ImageMetadata: () => <div data-testid="image-metadata">metadata</div>,
}))

jest.mock('@/components/images/DeletedImagePlaceholder', () => ({
  __esModule: true,
  default: () => <div data-testid="deleted-placeholder">deleted</div>,
}))

const imageA: ImageData = {
  id: 'img-a',
  filename: 'conservatory.webp',
  filepath: '/files/conservatory.webp',
  mimeType: 'image/webp',
  size: 1024,
  createdAt: '2026-08-01T00:00:00.000Z',
}

const imageB: ImageData = {
  id: 'img-b',
  filename: 'billiard-room.webp',
  filepath: '/files/billiard-room.webp',
  mimeType: 'image/webp',
  size: 2048,
  createdAt: '2026-08-02T00:00:00.000Z',
}

// jest.setup replaces global.fetch with a plain jest.fn; own it per test.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { characterGalleryLinks: [] } }),
  })
  global.fetch = mockFetch as unknown as typeof fetch
  mockUpdateLinks.mockClear()
})

describe('ImageDetailModal — #300 (placeholder carried across images)', () => {
  it('shows the next image after the previous one failed to load', async () => {
    const onClose = jest.fn()
    const { rerender } = renderWithQuery(
      <ImageDetailModal isOpen image={imageA} onClose={onClose} />
    )

    const imgA = screen.getByRole('img', { name: 'conservatory.webp' })
    fireEvent.error(imgA)
    expect(await screen.findByTestId('deleted-placeholder')).toBeInTheDocument()

    rerender(<ImageDetailModal isOpen image={imageB} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'billiard-room.webp' })).toBeInTheDocument()
    })
    expect(screen.queryByTestId('deleted-placeholder')).not.toBeInTheDocument()
  })
})

describe('ImageDetailModal — #260 (album lookup by link id)', () => {
  it('looks the picture up by its linkId when it has one', async () => {
    renderWithQuery(
      <ImageDetailModal isOpen image={{ ...imageA, linkId: 'link-a' }} onClose={jest.fn()} />
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/images/link-a')
    })
    expect(mockFetch).not.toHaveBeenCalledWith('/api/v1/images/img-a')
  })

  it('falls back to the image id when there is no linkId', async () => {
    renderWithQuery(<ImageDetailModal isOpen image={imageA} onClose={jest.fn()} />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/images/img-a')
    })
  })
})
