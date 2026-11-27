/**
 * Regression coverage for #290 — the Salon's quick-hide withholds every image
 * in the chat, but the file picker's "My Gallery" panel drew its thumbnails
 * regardless, so opening the picker put the hidden pictures straight back on
 * screen. Under `ImagesHiddenProvider hidden` the tiles are stand-ins.
 */

import React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import LibraryFilePickerModal from '@/components/chat/LibraryFilePickerModal'
import { ImagesHiddenProvider } from '@/components/quick-hide/images-hidden-context'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/lib/hooks/use-projects', () => ({
  useProjectsQuery: () => ({ data: [], isLoading: false }),
}))

jest.mock('@/lib/hooks/use-document-stores', () => ({
  useDocumentStoresQuery: () => ({ data: [], isLoading: false }),
}))

jest.mock('@/components/files/FileBrowser', () => ({
  __esModule: true,
  default: () => <div>file browser</div>,
}))

jest.mock('@/components/document-browser/DocumentStoreBrowser', () => ({
  DocumentStoreBrowser: () => <div>store browser</div>,
}))

jest.mock('@/components/document-browser/ProjectStoreBrowser', () => ({
  ProjectStoreBrowser: () => <div>project browser</div>,
}))

const BLOB_URL = '/api/v1/mount-points/mp-1/blobs/photos/conservatory.webp'

// jest.setup replaces global.fetch with a plain jest.fn; own it per test.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    const body = url.includes('action=photo-albums')
      ? { albums: [] }
      : url.includes('action=group-stores')
        ? { stores: [] }
        : url.startsWith('/api/v1/photos')
          ? {
              entries: [
                {
                  linkId: 'link-1',
                  mountPointId: 'mp-1',
                  relativePath: 'photos/conservatory.webp',
                  fileName: 'conservatory.webp',
                  blobUrl: BLOB_URL,
                  caption: 'The conservatory',
                  generationPromptExcerpt: '',
                },
              ],
            }
          : {}
    return { ok: true, status: 200, json: async () => body }
  })
  global.fetch = mockFetch as unknown as typeof fetch
})

async function openGallery(hidden: boolean) {
  renderWithQuery(
    <ImagesHiddenProvider hidden={hidden}>
      <LibraryFilePickerModal isOpen onClose={jest.fn()} chatId="chat-1" onFileLinked={jest.fn()} />
    </ImagesHiddenProvider>
  )
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: /My Gallery/ }))
  // The tile's button carries the caption as its title once the list is in.
  return within(dialog).findByTitle('The conservatory', {}, { timeout: 4000 })
}

describe('LibraryFilePickerModal gallery — #290 (quick-hide)', () => {
  it('draws stand-ins, not the pictures, while images are hidden', async () => {
    const tile = await openGallery(true)

    expect(within(tile).getByRole('img', { name: 'Image hidden: The conservatory' })).toBeInTheDocument()
    expect(document.querySelector(`img[src="${BLOB_URL}"]`)).toBeNull()
  })

  it('draws the pictures when images are not hidden', async () => {
    const tile = await openGallery(false)

    const img = within(tile).getByRole('img', { name: 'The conservatory' })
    expect(img).toHaveAttribute('src', BLOB_URL)
  })
})
