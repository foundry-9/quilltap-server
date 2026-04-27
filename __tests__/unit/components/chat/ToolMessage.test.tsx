import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ToolMessage from '@/components/chat/ToolMessage'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/format-time', () => ({
  formatMessageTime: jest.fn(() => 'just now'),
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

jest.mock('@/lib/clipboard-utils', () => ({
  copyImageToClipboard: jest.fn(),
}))

jest.mock('@/components/images/DeletedImagePlaceholder', () => ({
  __esModule: true,
  default: ({ imageId, filename, onCleanup }: any) => (
    <div data-testid={`deleted-image-${imageId}`}>
      <span>Deleted: {filename}</span>
      <button onClick={onCleanup}>Remove</button>
    </div>
  ),
}))

const mockCopyImageToClipboard = jest.mocked(copyImageToClipboard)
const mockShowSuccessToast = jest.mocked(showSuccessToast)

describe('ToolMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch
  })

  it('renders a wardrobe preset summary in the embedded tool view', () => {
    render(
      <ToolMessage
        embedded
        character={{ id: 'char-1', name: 'Riya' }}
        message={{
          id: 'msg-1',
          createdAt: '2026-04-09T00:00:00.000Z',
          content: JSON.stringify({
            tool: 'update_outfit_item',
            success: true,
            initiatedBy: 'character',
            result: {
              action: 'equipped',
              slot: 'preset',
              coverage_summary: 'Wearing a velvet coat and riding boots.',
            },
          }),
        }}
      />
    )

    expect(screen.getByText('Applied an outfit preset.')).toBeInTheDocument()
    expect(screen.getByText('Wearing a velvet coat and riding boots.')).toBeInTheDocument()
    expect(screen.getByText('Riya requested')).toBeInTheDocument()
  })

  it('copies generated images using a normalized leading-slash path', async () => {
    mockCopyImageToClipboard.mockResolvedValue(true)

    render(
      <ToolMessage
        message={{
          id: 'msg-2',
          createdAt: '2026-04-09T00:00:00.000Z',
          content: JSON.stringify({
            tool: 'generate_image',
            success: true,
            result: 'created image',
          }),
          attachments: [
            {
              id: 'file-1',
              filename: 'portrait.webp',
              filepath: 'uploads/portrait.webp',
              mimeType: 'image/webp',
            },
          ],
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /tool response/i }))
    fireEvent.click(await screen.findByTitle('Copy image'))

    await waitFor(() => {
      expect(mockCopyImageToClipboard).toHaveBeenCalledWith('/uploads/portrait.webp')
    })
    expect(mockShowSuccessToast).toHaveBeenCalledWith('Image copied to clipboard')
  })

  it('shows a deleted-image placeholder for broken non-generator attachments and removes the reference', async () => {
    const onAttachmentDeleted = jest.fn()

    render(
      <ToolMessage
        onAttachmentDeleted={onAttachmentDeleted}
        message={{
          id: 'msg-3',
          createdAt: '2026-04-09T00:00:00.000Z',
          content: JSON.stringify({
            tool: 'doc_write_file',
            success: true,
            result: 'Saved a file',
          }),
          attachments: [
            {
              id: 'file-9',
              filename: 'missing.png',
              filepath: '/uploads/missing.png',
              mimeType: 'image/png',
            },
          ],
        }}
      />
    )

    fireEvent.error(screen.getByRole('img', { name: 'missing.png' }))

    await waitFor(() => {
      expect(screen.getByTestId('deleted-image-file-9')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Remove'))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/chat-files/file-9', {
        method: 'DELETE',
      })
    })
    expect(onAttachmentDeleted).toHaveBeenCalledWith('file-9')
  })
})
