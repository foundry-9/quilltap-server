/**
 * The character page on a broken vault (D10 of
 * refactor-character-repository-and-vault.md).
 *
 * The item GET answers 503 for a character whose vault cannot be read. The
 * page used to say only "could not be loaded"; it now shows the vault-health
 * report — each file present or absent, a present-but-broken one with its
 * parse error — and offers the one repair the system may perform: seeding the
 * files that are absent. A broken file is never offered for rewriting.
 */

import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ApiFetchError } from '@/lib/query/fetcher'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const mockUseCharacter = jest.fn()
jest.mock('@/app/aurora/[id]/hooks/useCharacter', () => ({
  useCharacter: (...args: unknown[]) => mockUseCharacter(...args),
  useCharacterStats: () => ({ stats: null, groups: [], vault: null, refetch: jest.fn() }),
  useCharacterPageSupport: () => ({ profiles: [], userControlledCharacters: [] }),
}))
jest.mock('@/components/providers/quick-hide-provider', () => ({
  useQuickHide: () => ({ shouldHideByIds: () => false, hiddenTagIds: new Set() }),
}))

// The loaded page's dialogs never render on the 503 branch; stub the heavy ones.
jest.mock('@/components/providers/new-chat-provider', () => ({ useNewChatModalOptional: () => null }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => null }))

import { CharacterPage } from '@/app/aurora/[id]/CharacterPage'

const HEALTH = {
  characterId: 'char-1',
  mountPointId: 'mp-1',
  linked: true,
  readable: false,
  files: [
    { path: 'properties.json', keystone: true, present: true, parses: false, error: 'talkativeness: Too small' },
    { path: 'metadata.json', keystone: false, present: false, parses: null },
    { path: 'identity.md', keystone: true, present: true, parses: true },
  ],
  repairable: ['metadata.json'],
  needsAttention: ['properties.json'],
}

let posts: string[]

beforeEach(() => {
  posts = []
  mockUseCharacter.mockReturnValue({
    character: null,
    isLoading: false,
    error: new ApiFetchError('Character vault unavailable', 503),
    refetch: jest.fn(),
  })
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(url)
      return { ok: true, json: async () => ({ seeded: ['metadata.json'], health: HEALTH }) } as Response
    }
    return { ok: true, json: async () => ({ health: HEALTH }) } as Response
  }) as unknown as typeof fetch
})

it('shows the vault-health report instead of a dead page on a 503', async () => {
  renderWithQuery(<CharacterPage characterId="char-1" onBack={jest.fn()} />)

  expect(await screen.findByRole('heading', { name: /vault is in disarray/i })).toBeInTheDocument()
  expect(await screen.findByText(/talkativeness: Too small/)).toBeInTheDocument()
  // The broken file is named as the operator's to mend, never offered for rewriting.
  expect(screen.getByText(/present but\s+will not parse/i)).toBeInTheDocument()
})

it('repairs only what is absent', async () => {
  renderWithQuery(<CharacterPage characterId="char-1" onBack={jest.fn()} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Restore metadata.json' }))

  await waitFor(() => expect(posts).toEqual(['/api/v1/characters/char-1?action=repair-vault']))
})

it('keeps the plain message for any other failure', async () => {
  mockUseCharacter.mockReturnValue({
    character: null,
    isLoading: false,
    error: new ApiFetchError('boom', 500),
    refetch: jest.fn(),
  })
  renderWithQuery(<CharacterPage characterId="char-1" onBack={jest.fn()} />)
  expect(await screen.findByText('This character could not be loaded.')).toBeInTheDocument()
})
