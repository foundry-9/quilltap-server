/**
 * Regression: the first toast of a session was never announced.
 *
 * The polite live region was created and filled in the same tick, and a screen
 * reader only announces changes to a live region it has already seen. The
 * region must be in the document, empty, before the first message lands in it
 * (WCAG 4.1.3); later toasts reuse the region and render at once.
 */

import { act } from 'react'
import { showInfoToast, showSuccessToast } from '@/lib/toast'

describe('toast live region', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('mounts the region empty before the first toast and renders later toasts at once', async () => {
    showSuccessToast('Saved', 60_000)

    const region = document.querySelector<HTMLDivElement>('[data-toast-container]')
    expect(region).not.toBeNull()
    expect(region!.getAttribute('aria-live')).toBe('polite')
    // Flush React without letting time pass: the message must not be in yet.
    await act(async () => {})
    expect(region!.textContent).toBe('')

    await act(async () => {
      jest.advanceTimersByTime(100)
    })
    expect(region!.textContent).toContain('Saved')

    await act(async () => {
      showInfoToast('Second notice', 60_000)
    })
    expect(region!.textContent).toContain('Second notice')
  })
})
