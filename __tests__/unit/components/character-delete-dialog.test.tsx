/**
 * #241: a delete whose cascade preview failed must not take the character's
 * chats and images with it — the user was never shown them or offered a choice.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { CharacterDeleteDialog } from '@/components/character-delete-dialog'

const preview = {
  characterId: 'c1',
  characterName: 'Ada',
  exclusiveChats: [{ id: 'ch1', title: 'Tea', messageCount: 3, lastMessageAt: null }],
  exclusiveCharacterImageCount: 2,
  exclusiveChatImageCount: 0,
  totalExclusiveImageCount: 2,
  memoryCount: 0,
}

function answer(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: '',
    json: async () => body,
  }) as unknown as typeof fetch
}

function renderDialog(onConfirm: jest.Mock) {
  return renderWithQuery(
    <CharacterDeleteDialog characterId="c1" characterName="Ada" onClose={jest.fn()} onConfirm={onConfirm} />,
  )
}

describe('CharacterDeleteDialog', () => {
  it('cascades nothing when the preview failed', async () => {
    answer({ error: 'boom' }, 500)
    const onConfirm = jest.fn()
    renderDialog(onConfirm)
    await screen.findByText('Failed to load preview')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Character' }))
    expect(onConfirm).toHaveBeenCalledWith({ cascadeChats: false, cascadeImages: false })
  })

  it('cascades what the loaded preview offered, by default', async () => {
    answer(preview)
    const onConfirm = jest.fn()
    renderDialog(onConfirm)
    await screen.findByText('Delete exclusive chats')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Character' }))
    expect(onConfirm).toHaveBeenCalledWith({ cascadeChats: true, cascadeImages: true })
  })

  it('honours an unticked box', async () => {
    answer(preview)
    const onConfirm = jest.fn()
    renderDialog(onConfirm)
    fireEvent.click(await screen.findByLabelText('Delete exclusive images'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Character' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ cascadeChats: true, cascadeImages: false }))
  })

  // #271: a second click while the delete runs must not send a second DELETE.
  it('sends the delete once and holds the buttons while it runs', async () => {
    answer(preview)
    let finish!: () => void
    const onConfirm = jest.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    renderDialog(onConfirm)
    await screen.findByText('Delete exclusive chats')
    const del = screen.getByRole('button', { name: 'Delete Character' })
    fireEvent.click(del)
    fireEvent.click(del)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(del).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    finish()
    // A failed delete leaves the dialog open; the buttons come back.
    await waitFor(() => expect(del).not.toBeDisabled())
  })
})
