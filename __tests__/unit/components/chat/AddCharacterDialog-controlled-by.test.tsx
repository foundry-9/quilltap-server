/**
 * #274: a background change to the characters list must not snap the chosen
 * "Controlled By" back to the default profile.
 */
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { queryKeys } from '@/lib/query/keys'
import AddCharacterDialog from '@/components/chat/AddCharacterDialog'

jest.mock('@/components/ui/Avatar', () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => <span>{name}</span>,
}))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const PROFILES = [
  { id: 'p1', name: 'GPT', provider: 'openai', modelName: 'gpt-4', isDefault: true },
  { id: 'p2', name: 'Claude', provider: 'anthropic', modelName: 'sonnet', isDefault: false },
]
let characters = [{ id: 'char-1', name: 'Ada Lovelace', title: 'the analyst', npc: false }]

describe('AddCharacterDialog Controlled By (#274)', () => {
  beforeEach(() => {
    jest.spyOn(global as unknown as { fetch: typeof fetch }, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('/api/v1/characters')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ characters }) } as Response)
      }
      if (url.startsWith('/api/v1/connection-profiles')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ profiles: PROFILES }) } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })
  })
  afterEach(() => jest.restoreAllMocks())

  it('keeps the operator pick when the characters list changes', async () => {
    const { queryClient } = renderWithQuery(
      <AddCharacterDialog isOpen onClose={() => {}} chatId="c" existingCharacterIds={[]} onCharacterAdded={() => {}} />,
    )
    fireEvent.click((await screen.findAllByText('Ada Lovelace'))[0])
    const select = (await screen.findByLabelText('Controlled By')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('p1'))
    fireEvent.change(select, { target: { value: 'p2' } })
    expect(select.value).toBe('p2')

    characters = [{ ...characters[0], title: 'the countess' }]
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.characters.all })
    })
    await screen.findByText(/the countess/)
    expect(select.value).toBe('p2')
  })
})
