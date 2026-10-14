/**
 * PhotoGalleryModal — the chat gallery grid, the album grids, and what happens
 * when a thumbnail's bytes have gone missing underneath it.
 *
 * Chat mode reads `?action=gallery` through `useChatGallery`; the album modes
 * read `/characters/[id]/photos`. Both share the shell, the zoom and the
 * deleted-image placeholder.
 */

import React from 'react'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import PhotoGalleryModal from '@/components/images/PhotoGalleryModal'
import type { ChatGalleryEntry } from '@/lib/photos/chat-gallery'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(async () => true),
}))

jest.mock('@/components/chat/ChatGalleryImageViewModal', () => ({
  __esModule: true,
  default: () => <div>ChatGalleryImageViewModal</div>,
}))

jest.mock('@/components/images/ImageDetailModal', () => ({
  __esModule: true,
  default: () => <div>ImageDetailModal</div>,
}))

jest.mock('@/app/salon/[id]/components/SaveImageDialog', () => ({
  __esModule: true,
  SaveImageDialog: ({ target }: { target: { kind: string; fileId: string } }) => (
    <div data-testid="save-image-dialog" data-kind={target.kind} data-file-id={target.fileId}>
      SaveImageDialog
    </div>
  ),
}))

jest.mock('@/components/images/DeletedImagePlaceholder', () => ({
  __esModule: true,
  default: ({ imageId, filename, onCleanup }: any) => (
    <div data-testid={`deleted-placeholder-${imageId}`}>
      <span>Image Deleted: {filename}</span>
      <button onClick={onCleanup}>Remove</button>
    </div>
  ),
}))

global.fetch = jest.fn()

function entry(overrides: Partial<ChatGalleryEntry> & { id: string }): ChatGalleryEntry {
  return {
    idKind: 'file',
    url: `/api/v1/files/${overrides.id}`,
    filename: `${overrides.id}.webp`,
    mimeType: 'image/webp',
    size: 1024,
    createdAt: '2026-09-05T00:00:00.000Z',
    source: 'attachment',
    isCurrent: false,
    deletable: true,
    ...overrides,
  }
}

const GALLERY_ENTRIES: ChatGalleryEntry[] = [
  entry({ id: 'bg-current', filename: 'a-backdrop.webp', source: 'story-background', isCurrent: true, deletable: false }),
  entry({ id: 'upload-1', filename: 'valid.png', source: 'attachment' }),
  entry({
    id: 'portrait-1',
    filename: 'amelia.webp',
    source: 'portrait',
    idKind: 'link',
    isCurrent: true,
    deletable: false,
    characterName: 'Amelia',
  }),
]

const GALLERY_COUNTS = {
  'story-background': 1,
  avatar: 0,
  portrait: 1,
  generated: 0,
  attachment: 1,
  kept: 0,
  inline: 0,
}

function mockGallery(entries: ChatGalleryEntry[] = GALLERY_ENTRIES, counts = GALLERY_COUNTS) {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('action=gallery')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ entries, counts, total: entries.length }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

function renderChatGallery(props: Record<string, unknown> = {}) {
  return renderWithQuery(
    <PhotoGalleryModal mode="chat" isOpen={true} onClose={jest.fn()} chatId="chat-1" {...props} />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  document.body.style.overflow = ''
  mockGallery()
})

describe('PhotoGalleryModal — chat mode', () => {
  it('reads the gallery action, not the file listing', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
    const urls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/v1/chats/chat-1?action=gallery'))).toBe(true)
    expect(urls.some((u) => u.includes('action=files'))).toBe(false)
  })

  it('badges the picture the chat is currently showing', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByText('current')).toHaveLength(2)
    })
  })

  it('offers a filter chip per source that has pictures, and narrows on click', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getByText('All (3)')).toBeInTheDocument()
    })
    expect(screen.getByText('Backgrounds (1)')).toBeInTheDocument()
    expect(screen.getByText('Portraits (1)')).toBeInTheDocument()
    expect(screen.getByText('Attached (1)')).toBeInTheDocument()
    // Sources with nothing in them get no chip.
    expect(screen.queryByText(/^Avatars/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Kept/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Backgrounds (1)'))

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(1)
    })
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'a-backdrop.webp')
  })

  it('says so plainly when a chip narrows to nothing', async () => {
    mockGallery([], { ...GALLERY_COUNTS, 'story-background': 0, portrait: 0, attachment: 0 })
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getByText('No photos in this chat')).toBeInTheDocument()
    })
  })

  it('hides the filter row when everything came from one place', async () => {
    mockGallery([GALLERY_ENTRIES[1]], { ...GALLERY_COUNTS, 'story-background': 0, portrait: 0 })
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(1)
    })
    expect(screen.queryByText(/^All \(/)).not.toBeInTheDocument()
  })

  it('shows the bin only on a picture the chat owns', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
    // Save and Download on all three; the bin only on the upload.
    expect(screen.getAllByLabelText('Save to a photo album')).toHaveLength(3)
    expect(screen.getAllByLabelText('Download image')).toHaveLength(3)
    expect(screen.getAllByLabelText('Delete image')).toHaveLength(1)
  })

  it('opens the album dialog against the chat, not a message', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
    fireEvent.click(screen.getAllByLabelText('Save to a photo album')[1])

    const dialog = await screen.findByTestId('save-image-dialog')
    expect(dialog).toHaveAttribute('data-kind', 'chat')
    expect(dialog).toHaveAttribute('data-file-id', 'upload-1')
  })

  it('deletes through the chat-files route and tells the transcript', async () => {
    const onImageDeleted = jest.fn()
    renderChatGallery({ onImageDeleted })

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
    fireEvent.click(screen.getByLabelText('Delete image'))

    await waitFor(() => {
      expect(onImageDeleted).toHaveBeenCalledWith('upload-1')
    })
    const deleteCall = (global.fetch as jest.Mock).mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'DELETE',
    )
    expect(String(deleteCall?.[0])).toBe('/api/v1/chat-files/upload-1')
  })

  it('detects an image whose bytes have gone missing', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })

    fireEvent.error(screen.getAllByRole('img')[1])

    await waitFor(() => {
      expect(screen.getByTestId('deleted-placeholder-upload-1')).toBeInTheDocument()
    })
    expect(screen.getByText(/Image Deleted: valid.png/)).toBeInTheDocument()
  })

  it('re-reads the gallery after a missing image is cleaned up', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(3)
    })
    fireEvent.error(screen.getAllByRole('img')[1])
    await waitFor(() => {
      expect(screen.getByTestId('deleted-placeholder-upload-1')).toBeInTheDocument()
    })

    ;(global.fetch as jest.Mock).mockClear()
    fireEvent.click(screen.getByText('Remove'))

    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u.includes('action=gallery'))).toBe(true)
    })
  })
})

describe('PhotoGalleryModal — album modes', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/photos')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            entries: [
              {
                linkId: 'img-1',
                fileName: 'char-img.png',
                blobUrl: '/uploads/char-img.png',
                mimeType: 'image/png',
                fileSizeBytes: 1024,
                keptAt: '2026-01-01T00:00:00Z',
              },
            ],
            total: 1,
            hasMore: false,
          }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
  })

  it('handles deleted images in character mode', async () => {
    renderWithQuery(
      <PhotoGalleryModal
        mode="character"
        isOpen={true}
        onClose={jest.fn()}
        characterId="char-1"
        characterName="Test Character"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("Test Character's Photos")).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByRole('img')).toBeInTheDocument()
    })

    fireEvent.error(screen.getByRole('img'))

    await waitFor(() => {
      expect(screen.getByTestId('deleted-placeholder-img-1')).toBeInTheDocument()
    })
  })

  it('handles deleted images in user-character mode', async () => {
    renderWithQuery(
      <PhotoGalleryModal
        mode="user-character"
        isOpen={true}
        onClose={jest.fn()}
        userCharacterId="user-char-1"
        userCharacterName="Test User Character"
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("Test User Character's Photos")).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByRole('img')).toBeInTheDocument()
    })

    fireEvent.error(screen.getByRole('img'))

    await waitFor(() => {
      expect(screen.getByTestId('deleted-placeholder-img-1')).toBeInTheDocument()
    })
  })

  it('uses a div container for a missing image and a button for a live one', async () => {
    renderWithQuery(
      <PhotoGalleryModal
        mode="character"
        isOpen={true}
        onClose={jest.fn()}
        characterId="char-1"
        characterName="Test Character"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('img')).toBeInTheDocument()
    })
    const container = screen.getByRole('img').closest('.relative.rounded')
    expect(container?.tagName).toBe('BUTTON')

    fireEvent.error(screen.getByRole('img'))

    await waitFor(() => {
      expect(screen.getByTestId('deleted-placeholder-img-1')).toBeInTheDocument()
    })
    const placeholderContainer = screen
      .getByTestId('deleted-placeholder-img-1')
      .closest('.relative.rounded')
    expect(placeholderContainer?.tagName).toBe('DIV')
  })
})

describe('PhotoGalleryModal — shell', () => {
  it('renders through a portal to the body, not inside its parent pane', async () => {
    const { container } = renderChatGallery()

    await waitFor(() => {
      expect(screen.getByText('Chat Photos')).toBeInTheDocument()
    })
    // The workspace pane is an isolated stacking context; a `fixed inset-0`
    // child of it is trapped under the toolbar.
    expect(within(container).queryByText('Chat Photos')).toBeNull()
  })

  it('closes when the close button is clicked', async () => {
    const onClose = jest.fn()
    renderChatGallery({ onClose })

    await waitFor(() => {
      expect(screen.getByText('Chat Photos')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    renderWithQuery(
      <PhotoGalleryModal mode="chat" isOpen={false} onClose={jest.fn()} chatId="chat-1" />,
    )
    expect(screen.queryByText('Chat Photos')).not.toBeInTheDocument()
  })

  it('locks body overflow when open', async () => {
    renderChatGallery()
    await waitFor(() => {
      expect(document.body.style.overflow).toBe('hidden')
    })
  })

  it('supports zooming the thumbnails in and out', async () => {
    renderChatGallery()

    await waitFor(() => {
      expect(screen.getByTitle('Larger thumbnails')).toBeInTheDocument()
    })
    expect(screen.getByTitle('Larger thumbnails')).not.toBeDisabled()
    expect(screen.getByTitle('Smaller thumbnails')).not.toBeDisabled()
  })
})
