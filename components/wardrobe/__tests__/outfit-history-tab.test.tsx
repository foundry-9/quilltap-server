/**
 * The Wardrobe dialog's History tab: newest first, the current entry marked
 * "Wearing now" with no button, Wear again posting the rollback, a stale-item
 * warning on the button, and — when the Live tab holds staged edits for this
 * character — a confirmation, then the staging discarded before the rollback
 * runs, so Done can never flush it over the restored outfit.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { OutfitHistoryTab, type OutfitHistoryResponse } from '@/components/wardrobe/outfit-history-tab'

const EMPTY = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

const HISTORY: OutfitHistoryResponse = {
  currentIndex: 2,
  entries: [
    {
      index: 0, at: '2026-10-16T10:00:00.000Z', source: 'chat-start', actorCharacterId: null, actorName: null, actorToolName: null,
      changedBy: 'chat opened', isCurrent: false, summary: 'Green Dress',
      slots: { ...EMPTY, top: [{ itemId: 'dress', title: 'Green Dress', archived: false, missing: false }] },
    },
    {
      index: 1, at: '2026-10-16T11:00:00.000Z', source: 'character', actorCharacterId: 'char-1', actorName: 'Bertie', actorToolName: null,
      changedBy: 'Bertie', isCurrent: false, summary: 'Greatcoat (archived)',
      slots: { ...EMPTY, top: [{ itemId: 'coat', title: 'Greatcoat', archived: true, missing: false }] },
    },
    {
      index: 2, at: '2026-10-16T12:00:00.000Z', source: 'operator', actorCharacterId: null, actorName: null, actorToolName: null,
      changedBy: 'the operator', isCurrent: true, summary: 'Nothing',
      slots: EMPTY,
    },
  ],
}

describe('OutfitHistoryTab', () => {
  const realFetch = global.fetch
  let fetchSpy: jest.Mock

  beforeEach(() => {
    fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = url.includes('action=wardrobe-rollback')
        ? { equippedSlots: EMPTY, previousIndex: 2, restoredIndex: JSON.parse(String(init?.body)).index, skipped: [] }
        : HISTORY
      return { ok: true, status: 200, statusText: 'OK', json: async () => body }
    })
    global.fetch = fetchSpy as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  function renderTab(overrides: Partial<React.ComponentProps<typeof OutfitHistoryTab>> = {}) {
    const props = {
      chatId: 'chat-1',
      characterId: 'char-1',
      characterName: 'Bertie',
      hasStagedEdits: false,
      discardStagedEdits: jest.fn(),
      requestConfirmation: jest.fn().mockResolvedValue(true),
      ...overrides,
    }
    renderWithQuery(<OutfitHistoryTab {...props} />)
    return props
  }

  const rollbackCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('wardrobe-rollback'))

  it('lists newest first, marks the current entry, and offers Wear again on the rest', async () => {
    renderTab()
    const current = await screen.findByTestId('outfit-history-entry-2')
    const entries = screen.getAllByTestId(/outfit-history-entry-/)
    expect(entries.map((e) => e.getAttribute('data-testid'))).toEqual([
      'outfit-history-entry-2',
      'outfit-history-entry-1',
      'outfit-history-entry-0',
    ])
    expect(within(current).getByText('Wearing now')).toBeInTheDocument()
    expect(within(current).queryByText('Wear again')).toBeNull()
    expect(within(screen.getByTestId('outfit-history-entry-0')).getByText('Wear again')).toBeInTheDocument()
  })

  it('warns ahead of time when an entry holds items that will be left off', async () => {
    renderTab()
    const button = within(await screen.findByTestId('outfit-history-entry-1')).getByText('Wear again')
    expect(button.getAttribute('title')).toContain('1 item in this outfit is no longer available')
    expect(within(screen.getByTestId('outfit-history-entry-1')).getByTitle('Top — archived')).toBeInTheDocument()
  })

  it('Wear again posts the rollback for that index', async () => {
    const props = renderTab()
    fireEvent.click(within(await screen.findByTestId('outfit-history-entry-0')).getByText('Wear again'))
    await waitFor(() => expect(rollbackCalls()).toHaveLength(1))
    expect(JSON.parse(String(rollbackCalls()[0][1].body))).toEqual({ characterId: 'char-1', index: 0 })
    expect(props.requestConfirmation).not.toHaveBeenCalled()
  })

  it('confirms and discards staged Live-tab edits before rolling back', async () => {
    const order: string[] = []
    const props = renderTab({
      hasStagedEdits: true,
      discardStagedEdits: jest.fn((options?: { reseed?: boolean }) => {
        order.push(options?.reseed ? 'reseed' : 'discard')
      }),
    })
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('wardrobe-rollback')) order.push('rollback')
      const body = String(input).includes('wardrobe-rollback')
        ? { equippedSlots: EMPTY, previousIndex: 2, restoredIndex: 0, skipped: [] }
        : HISTORY
      return { ok: true, status: 200, statusText: 'OK', json: async () => body }
    })

    fireEvent.click(within(await screen.findByTestId('outfit-history-entry-0')).getByText('Wear again'))
    await waitFor(() => expect(order).toContain('reseed'))

    expect(props.requestConfirmation).toHaveBeenCalledWith(
      "Discard the staged changes to Bertie's outfit and return to outfit 0?",
    )
    expect(order).toEqual(['discard', 'rollback', 'reseed'])
  })

  it('does nothing when the operator keeps the staged edits', async () => {
    const props = renderTab({ hasStagedEdits: true, requestConfirmation: jest.fn().mockResolvedValue(false) })
    fireEvent.click(within(await screen.findByTestId('outfit-history-entry-0')).getByText('Wear again'))
    await waitFor(() => expect(props.requestConfirmation).toHaveBeenCalled())
    expect(props.discardStagedEdits).not.toHaveBeenCalled()
    expect(rollbackCalls()).toHaveLength(0)
  })

  it('says so when nothing is recorded', async () => {
    fetchSpy.mockImplementation(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => ({ currentIndex: null, entries: [] }),
    }))
    renderTab()
    expect(await screen.findByText(/No outfits recorded yet/)).toBeInTheDocument()
  })
})
