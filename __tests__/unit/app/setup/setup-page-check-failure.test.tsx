/**
 * #328 — /setup spun forever when the unlock-state check failed.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SetupPage from '@/app/setup/page'

// A stable router, as Next's is: checkState depends on it.
jest.mock('next/navigation', () => {
  const router = { push: jest.fn() }
  return { useRouter: () => router }
})

describe('SetupPage unlock-state check failure', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('shows an error with Retry when the check rejects, and Retry checks again', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'needs-setup' }) })
    global.fetch = fetchMock as unknown as typeof fetch

    render(<SetupPage />)
    expect(await screen.findByText('Failed to check pepper vault status')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Welcome to Quilltap')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a non-OK response without a state as a failure, not an empty card', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Server unavailable' }),
    }) as unknown as typeof fetch

    render(<SetupPage />)
    expect(await screen.findByText('Server unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
