/**
 * Tests for PendingInformChips — the composer's "still to be told" row.
 *
 * Verifies:
 *  - nothing renders when no batch is pending;
 *  - one chip per batch, naming the pending seats, with the passage's first
 *    line as its hover title;
 *  - a batch whose seats have all left the chat is skipped rather than shown
 *    nameless;
 *  - the × posts `?action=cancel-inform` with the batch id;
 *  - the read has no bare `refetchInterval` — the offline fallback is gated by
 *    `useRealtimeRefetchInterval`, which returns false while the socket is up.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import React from 'react'
import PendingInformChips from '@/components/chat/PendingInformChips'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

// The socket is up in these tests, so the fallback poll is off. Asserted
// below: a bare interval would be a new polling site, which is a bug.
jest.mock('@/hooks/useRealtime', () => ({
  useRealtimeRefetchInterval: jest.fn(() => false),
}))

const ALICE = 'aaaa1111-1111-1111-1111-111111111111'
const BOB = 'bbbb2222-2222-2222-2222-222222222222'
const GHOST = 'dddd4444-4444-4444-4444-444444444444'

const NAMES: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob' }

interface Batch {
  batchId: string
  contentMarkdown: string
  createdAt: string
  recordMessageId: string | null
  pendingParticipantIds: string[]
}

function routeFetch(batches: Batch[]) {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url
      if (url.includes('action=cancel-inform')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ removed: 1, recordDeleted: true }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ batches }),
      } as Response)
    })
}

function renderChips() {
  return renderWithQuery(<PendingInformChips chatId="chat-1" participantNames={NAMES} />)
}

const BATCH: Batch = {
  batchId: 'batch-1',
  contentMarkdown: 'You see that Alice slipped the letter into her sleeve.\n\nShe is not subtle.',
  createdAt: '2026-09-19T21:14:00.000Z',
  recordMessageId: 'msg-1',
  pendingParticipantIds: [ALICE, BOB],
}

describe('PendingInformChips', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders nothing when no inform is pending', async () => {
    routeFetch([])
    const { container } = renderChips()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.querySelector('.qt-chat-attachment-list')).toBeNull()
  })

  it('names the pending seats and hovers the first line of the passage', async () => {
    routeFetch([BATCH])
    renderChips()

    const chip = await screen.findByText('Informing Alice, Bob before their next turn')
    expect(chip.parentElement?.getAttribute('title')).toBe(
      'You see that Alice slipped the letter into her sleeve.',
    )
  })

  it('skips a batch whose seats have all left the chat', async () => {
    routeFetch([{ ...BATCH, batchId: 'batch-2', pendingParticipantIds: [GHOST] }])
    const { container } = renderChips()

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.qt-chat-tool-result-chip')).toBeNull())
  })

  it('cancels the batch through ?action=cancel-inform', async () => {
    const spy = routeFetch([BATCH])
    renderChips()

    const remove = await screen.findByRole('button', {
      name: 'Withdraw the inform for Alice, Bob',
    })
    fireEvent.click(remove)

    await waitFor(() => {
      const call = spy.mock.calls.find(([url]) => String(url).includes('action=cancel-inform'))
      expect(call).toBeTruthy()
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ batchId: 'batch-1' })
    })
  })

  it('does not poll while the realtime socket is up', async () => {
    const { useRealtimeRefetchInterval } = jest.requireMock('@/hooks/useRealtime') as {
      useRealtimeRefetchInterval: jest.Mock
    }
    routeFetch([BATCH])
    renderChips()

    await screen.findByText('Informing Alice, Bob before their next turn')
    // The component asks the gate for its interval rather than hard-coding one,
    // and the gate answers false whenever the socket is connected.
    expect(useRealtimeRefetchInterval).toHaveBeenCalledWith(60_000)
    expect(useRealtimeRefetchInterval.mock.results.every((r) => r.value === false)).toBe(true)
  })
})
