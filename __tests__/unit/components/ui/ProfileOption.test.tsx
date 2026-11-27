/**
 * A profile picker's option warns of a missing API key only when the
 * provider requires one — a keyless provider (Ollama) is not "missing" a key.
 */
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { ProfileOption, type ProfileOptionProps } from '@/components/ui/ProfileOption'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const mockFetch = global.fetch as jest.Mock

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      providers: [
        { name: 'OPENAI', configRequirements: { requiresApiKey: true } },
        { name: 'OLLAMA', configRequirements: { requiresApiKey: false } },
      ],
    }),
  }))
})

function renderOption(profile: ProfileOptionProps['profile'], label?: string) {
  return renderWithQuery(
    <select aria-label="Profile">
      <ProfileOption profile={profile} label={label} />
    </select>,
  )
}

describe('ProfileOption', () => {
  it('warns when a key-requiring provider has no key', async () => {
    renderOption({ id: 'p1', name: 'Gatsby', provider: 'OPENAI', modelName: 'gpt-x' })
    expect(await screen.findByRole('option')).toHaveTextContent('Gatsby (OPENAI • gpt-x) ⚠️ No API Key')
  })

  it('does not warn for a keyless provider once the list has loaded', async () => {
    renderOption({ id: 'p2', name: 'Daisy', provider: 'OLLAMA', modelName: 'llama' })
    await waitFor(() => expect(screen.getByRole('option')).toHaveTextContent(/^Daisy \(OLLAMA • llama\)$/))
  })

  it('does not warn when the profile has a key, and honours a custom label', async () => {
    renderOption({ id: 'p3', name: 'Nick', provider: 'OPENAI', modelName: 'gpt-x', apiKey: { id: 'k' } }, 'Nick [Default]')
    const option = await screen.findByRole('option')
    expect(option).toHaveTextContent(/^Nick \[Default\]$/)
    expect(option).toHaveValue('p3')
  })
})
