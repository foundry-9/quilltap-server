/**
 * #255 — a refused save (and a failed probe) is said in the dialog.
 * #294 — a new profile reopens clean: no earlier error carried over.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { useConnectionProfileModal } from '@/components/settings/connection-profiles/useConnectionProfileModal'
import type { ProviderConfig } from '@/components/settings/connection-profiles/types'
import { fetchJson } from '@/lib/fetch-helpers'

jest.mock('@/lib/fetch-helpers', () => ({ fetchJson: jest.fn() }))
jest.mock('@/components/tags/tag-editor', () => ({ TagEditor: () => null }))

const mockFetchJson = fetchJson as jest.Mock

const PROVIDERS = [
  {
    name: 'OLLAMA',
    displayName: 'Ollama',
    configRequirements: { requiresApiKey: false, requiresBaseUrl: true, baseUrlDefault: 'http://localhost:11434' },
    capabilities: { chat: true, toolUse: true },
  },
] as unknown as ProviderConfig[]

function Host() {
  const { modal, openNew } = useConnectionProfileModal({ profiles: [], apiKeys: [], providers: PROVIDERS, onSuccess: () => {} })
  return (
    <>
      <button type="button" onClick={() => openNew('OLLAMA')}>
        New profile
      </button>
      {modal}
    </>
  )
}

describe('connection profile modal failures', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('shows a refused save, and a fresh opening does not', async () => {
    mockFetchJson.mockResolvedValue({ ok: false, error: 'The name is spoken for' })
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))

    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Profile' }))
    expect(await screen.findByText('The name is spoken for')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Profile' })).toBeInTheDocument())
    expect(screen.queryByText('The name is spoken for')).toBeNull()
  })
})
