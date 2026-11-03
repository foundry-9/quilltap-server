/**
 * The Salon's desktop avatar column: the picture opens full size, and the
 * glyphs of what the character carries sit between the title and the badge,
 * each with its name and description in a tooltip.
 */

import React from 'react'
import { screen, fireEvent, act } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { MessageDesktopAvatar } from '@/app/salon/[id]/components/message-row/MessageDesktopAvatar'
import { inventoryAbbreviation } from '@/components/inventory/inventory-glyph'

jest.mock('@/hooks/useAvatarDisplay', () => ({
  useAvatarDisplay: () => ({ style: 'RECTANGULAR' }),
}))

const realFetch = global.fetch

function stubInventory(inventory: Record<string, unknown>) {
  const body = { inventory, projectId: null }
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
}

const AVATAR = {
  name: 'Laura',
  characterId: 'c-laura',
  title: 'The Mathematician',
  avatarUrl: '/api/v1/files/f-1',
  defaultImage: { id: 'f-1', filepath: 'api/v1/files/f-1' },
}

const item = (id: string, fields: Record<string, unknown>) => ({ id, kind: 'item', name: id, title: null, description: null, ...fields })

afterAll(() => { global.fetch = realFetch })

describe('inventoryAbbreviation', () => {
  it('takes initials of two words, or two letters of one', () => {
    expect(inventoryAbbreviation('Pocket Watch')).toBe('PW')
    expect(inventoryAbbreviation('lantern')).toBe('LA')
    expect(inventoryAbbreviation('  — ')).toBe('?')
  })
})

describe('MessageDesktopAvatar', () => {
  it('opens the picture full size from the picture alone', () => {
    stubInventory({})
    const onImageClick = jest.fn()
    renderWithQuery(<MessageDesktopAvatar messageAvatar={AVATAR} chatId="chat-1" onImageClick={onImageClick} />)
    fireEvent.click(screen.getByRole('button', { name: "View Laura's picture full size" }))
    expect(onImageClick).toHaveBeenCalledWith('/api/v1/files/f-1', 'Laura', 'f-1')
    // The name is not part of the button.
    expect(screen.getByText('Laura').closest('button')).toBeNull()
  })

  it('shows each carried object by SVG, emoji or abbreviation, with a tooltip', async () => {
    stubInventory({
      'c-laura': {
        kits: {},
        equipped: [
          item('compass', { svg: '<svg viewBox="0 0 1 1"><rect/></svg>' }),
          item('slide-rule', { title: 'Slide Rule', emoji: '📏', description: 'Ivory, much used.' }),
          item('pocket watch', {}),
        ],
      },
      'c-other': { kits: {}, equipped: [item('sword', {})] },
    })
    renderWithQuery(<MessageDesktopAvatar messageAvatar={AVATAR} chatId="chat-1" badge={{ provider: 'X', modelName: 'm' }} />)

    const list = await screen.findByRole('list', { name: 'Carrying' })
    expect(list.querySelector('[data-testid="inventory-glyph-svg"]')).not.toBeNull()
    expect(list.querySelector('[data-testid="inventory-glyph-emoji"]')?.textContent).toBe('📏')
    expect(list.querySelector('[data-testid="inventory-glyph-abbreviation"]')?.textContent).toBe('PW')
    expect(screen.queryByRole('img', { name: 'sword' })).toBeNull()

    jest.useFakeTimers()
    try {
      fireEvent.pointerEnter(screen.getByRole('img', { name: 'Slide Rule (slide-rule)' }))
      act(() => { jest.advanceTimersByTime(300) })
      expect(screen.getByText('Ivory, much used.')).toBeTruthy()
    } finally {
      jest.runOnlyPendingTimers()
      jest.useRealTimers()
    }
  })

  it('shows nothing for a character carrying nothing', async () => {
    stubInventory({})
    renderWithQuery(<MessageDesktopAvatar messageAvatar={AVATAR} chatId="chat-1" />)
    await act(async () => {})
    expect(screen.queryByRole('list', { name: 'Carrying' })).toBeNull()
  })
})
