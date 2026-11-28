/**
 * The memory recall card goes back to the setting in force when a save fails
 * (#326), rather than showing a value the server never took.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRecallCard } from '@/components/tools/memory-recall-card'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { showErrorToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const mockFetch = global.fetch as jest.Mock

const RECALL = {
  scopePolicy: 'down-weight',
  expandRelated: false,
  perTurnConversationSummaries: false,
}

function respond(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response
}

function mockRecall(saveStatus: number) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!String(url).includes('recall-config')) return respond({})
    if (init?.method === 'POST') {
      if (saveStatus >= 400) return respond({ error: 'The Book is shut' }, saveStatus)
      return respond({ settings: { ...RECALL, ...JSON.parse(String(init.body)) } })
    }
    return respond({ settings: RECALL })
  })
}

describe('MemoryRecallCard', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    ;(showErrorToast as jest.Mock).mockClear()
  })

  it('restores Expand Related when the save fails', async () => {
    mockRecall(500)
    renderWithQuery(<MemoryRecallCard />)

    const checkbox = await screen.findByRole('checkbox', { name: /Follow the threads/ })
    expect(checkbox).not.toBeChecked()

    fireEvent.click(checkbox)

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    await waitFor(() => expect(checkbox).not.toBeChecked())
  })

  it('restores the cross-project policy when the save fails', async () => {
    mockRecall(500)
    renderWithQuery(<MemoryRecallCard />)

    const select = await screen.findByLabelText(/Cross-project memories/)
    fireEvent.change(select, { target: { value: 'exclude' } })

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    await waitFor(() => expect(select).toHaveValue('down-weight'))
  })

  it('keeps the new value when the save succeeds', async () => {
    mockRecall(200)
    renderWithQuery(<MemoryRecallCard />)

    const checkbox = await screen.findByRole('checkbox', { name: /Follow the threads/ })
    fireEvent.click(checkbox)

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/memories?action=recall-config',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ expandRelated: true }) }),
      ),
    )
    await waitFor(() => expect(checkbox).toBeChecked())
    expect(showErrorToast).not.toHaveBeenCalled()
  })
})
