/**
 * #258: making an embedding profile the default queues the re-embed on the
 * server; the modal says so and never posts a second `?action=reindex`.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProfileModal } from '@/components/settings/embedding-profiles/ProfileModal'
import { fetchJson } from '@/lib/fetch-helpers'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { showInfoToast } from '@/lib/toast'
import type { EmbeddingProfile } from '@/components/settings/embedding-profiles/types'

jest.mock('@/lib/fetch-helpers', () => ({
  fetchJson: jest.fn(),
}))

jest.mock('@/components/layout/queue-status-badges', () => ({
  notifyQueueChange: jest.fn(),
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const mockFetchJson = fetchJson as jest.MockedFunction<typeof fetchJson>

const PROVIDERS = [{ name: 'BUILTIN', displayName: 'Built-in' }] as never

const EXISTING = {
  id: 'emb-1',
  name: 'Local',
  provider: 'BUILTIN',
  apiKeyId: null,
  baseUrl: null,
  modelName: 'tfidf-bm25-v1',
  dimensions: null,
  isDefault: false,
} as unknown as EmbeddingProfile

function renderModal(profile: EmbeddingProfile | null, onClose = jest.fn()) {
  render(
    <ProfileModal
      isOpen
      onClose={onClose}
      onSuccess={jest.fn()}
      profile={profile}
      apiKeys={[]}
      embeddingModels={{}}
      embeddingProviders={PROVIDERS}
    />,
  )
  return onClose
}

function requestedUrls(): string[] {
  return mockFetchJson.mock.calls.map((call) => String(call[0]))
}

describe('ProfileModal re-embed (#258)', () => {
  afterEach(() => jest.clearAllMocks())

  it('marking an existing profile default posts no reindex and announces the server-side re-embed', async () => {
    mockFetchJson.mockResolvedValue({ ok: true, data: { id: 'emb-1', reembeddingTriggered: true } } as never)
    const onClose = renderModal(EXISTING)

    fireEvent.click(screen.getByLabelText('Set as default embedding profile'))
    fireEvent.click(screen.getByRole('button', { name: /save|update/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(requestedUrls()).toEqual(['/api/v1/embedding-profiles/emb-1'])
    expect(requestedUrls().some((u) => u.includes('action=reindex'))).toBe(false)
    expect(notifyQueueChange).toHaveBeenCalledTimes(1)
    expect(showInfoToast).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Re-embed Everything?')).toBeNull()
  })

  it('creating a default profile posts no reindex either', async () => {
    mockFetchJson.mockResolvedValue({ ok: true, data: { id: 'emb-2' } } as never)
    const onClose = renderModal(null)

    fireEvent.change(screen.getByPlaceholderText('My OpenAI Embeddings'), { target: { value: 'Fresh' } })
    fireEvent.click(screen.getByLabelText('Set as default embedding profile'))
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(requestedUrls()).toEqual(['/api/v1/embedding-profiles'])
    expect(notifyQueueChange).toHaveBeenCalledTimes(1)
  })

  it('a save that leaves the default alone announces nothing', async () => {
    mockFetchJson.mockResolvedValue({ ok: true, data: { id: 'emb-1', reembeddingTriggered: false } } as never)
    const onClose = renderModal(EXISTING)

    fireEvent.click(screen.getByRole('button', { name: /save|update/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(notifyQueueChange).not.toHaveBeenCalled()
    expect(showInfoToast).not.toHaveBeenCalled()
  })
})
