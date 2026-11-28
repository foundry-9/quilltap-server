/**
 * #178: "Analyze for Memories" after a SillyTavern import posted to
 * /api/v1/chats/[id]/queue-memories, a path that does not exist. It must use
 * the chat's ?action=queue-memories.
 */

import React from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

import { MemoryCreationDialog } from '@/components/import/memory-creation-dialog'
import { showSuccessToast } from '@/lib/toast'

const chat = {
  id: 'chat-1',
  title: 'Imported',
  participants: [
    { type: 'CHARACTER' as const, characterId: 'c1', connectionProfileId: 'p1', character: { id: 'c1', name: 'Ada' } },
  ],
  messages: [
    { id: 'm1', role: 'USER', content: 'Hello' },
    { id: 'm2', role: 'ASSISTANT', content: 'Good evening' },
  ],
}

describe('MemoryCreationDialog', () => {
  it('queues analysis through the chat action', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ jobCount: 1 }) }))
    global.fetch = fetchMock as unknown as typeof fetch
    const onClose = jest.fn()

    render(<MemoryCreationDialog chat={chat} onClose={onClose} />)
    fireEvent.click(screen.getByText('Analyze 1 Turn'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/chats/chat-1?action=queue-memories',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(showSuccessToast).toHaveBeenCalled()
  })

  it('covers every character, needs no seat profile, and reports the server\'s job count (#330)', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ jobCount: 3 }) }))
    global.fetch = fetchMock as unknown as typeof fetch
    const twoCharacters = {
      ...chat,
      participants: [
        { type: 'CHARACTER' as const, characterId: 'c1', connectionProfileId: null, character: { id: 'c1', name: 'Ada' } },
        { type: 'CHARACTER' as const, characterId: 'c2', connectionProfileId: 'p2', character: { id: 'c2', name: 'Bertie' } },
      ],
      messages: [
        { id: 'm0', role: 'ASSISTANT', content: 'Welcome' },
        { id: 'm1', role: 'USER', content: 'Hello' },
        { id: 'm2', role: 'ASSISTANT', content: 'Good evening' },
        { id: 'm3', role: 'ASSISTANT', content: 'Quite so' },
        { id: 'm4', role: 'USER', content: 'And you?' },
      ],
    }
    const onClose = jest.fn()
    render(<MemoryCreationDialog chat={twoCharacters} onClose={onClose} />)

    expect(screen.queryByText(/No character with a connection profile/)).not.toBeInTheDocument()
    expect(screen.getByText(/every character in the chat/)).toHaveTextContent('Ada, Bertie')
    const button = screen.getByRole('button', { name: 'Analyze 3 Turns' })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(showSuccessToast).toHaveBeenCalledWith('Queued 3 turns for memory analysis')
  })
})
