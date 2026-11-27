/**
 * Out of a chat, the portrait pane said "Download to keep." and offered
 * "Discard preview", though the server keeps every preview as a generated
 * file linked to the character, where it shows in their photos and can be
 * chosen as the avatar (fresh-instance dogfood, 4.14.1). The copy now says
 * where the picture goes, and closing the preview no longer claims to discard it.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AvatarGenerationPane } from '@/components/wardrobe/AvatarGenerationPane'
import { fetchJson } from '@/lib/fetch-helpers'

jest.mock('@/lib/hooks/use-profiles', () => ({
  useImageProfilesQuery: () => ({
    data: [{ id: 'p1', name: 'OpenAI - gpt-image-1-mini', provider: 'OPENAI', modelName: 'gpt-image-1-mini', isDefault: true }],
  }),
}))
jest.mock('@/lib/fetch-helpers', () => ({ fetchJson: jest.fn() }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/lib/download-utils', () => ({ triggerDownload: jest.fn() }))

const mockFetchJson = fetchJson as jest.Mock

describe('AvatarGenerationPane out of chat', () => {
  it('says the portrait is kept in the photos, and closes rather than discards it', async () => {
    mockFetchJson.mockResolvedValue({ ok: true, data: { url: '/api/v1/files/f1', fileId: 'f1' } })
    render(<AvatarGenerationPane characterId="c1" characterName="Margit" chatId={null} slots={{} as never} />)

    expect(screen.getByText(/keeps it in Margit's photos/)).toBeTruthy()
    expect(screen.queryByText(/Download to keep/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close preview' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Discard preview' })).toBeNull()
  })

  it('keeps the in-chat wording', () => {
    render(<AvatarGenerationPane characterId="c1" characterName="Margit" chatId="chat1" slots={{} as never} />)
    expect(screen.getByText(/Replaces this chat's avatar/)).toBeTruthy()
  })
})
