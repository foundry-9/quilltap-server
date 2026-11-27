/**
 * Regression coverage for #350 — when a next page of My Photos failed, the
 * still-visible sentinel kept the IntersectionObserver firing, and every
 * failure re-armed it: the page hammered `/api/v1/photos` as fast as each
 * request could fail. A failed next page now stops the automatic loading and
 * offers a "Try again" button instead.
 */

import React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { PhotosView } from '@/app/photos/PhotosView'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))

jest.mock('@/lib/download-utils', () => ({
  downloadFetchedFile: jest.fn(),
}))

jest.mock('@/lib/clipboard-utils', () => ({
  copyImageToClipboard: jest.fn(),
}))

jest.mock('@/components/providers/theme-provider', () => ({
  useSubsystemBackgroundStyle: () => undefined,
}))

jest.mock('@/components/workspace/workspace-tab-context', () => ({
  useOnTabActivated: jest.fn(),
}))

// The sentinel is always "in view": every observe reports an intersection,
// which is exactly the condition under which the old code looped.
class ImmediateIntersectionObserver {
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

const entry = {
  linkId: 'link-1',
  mountPointId: 'mp-1',
  relativePath: 'photos/conservatory.webp',
  fileName: 'conservatory.webp',
  blobUrl: '/api/v1/mount-points/mp-1/blobs/conservatory.webp',
  mimeType: 'image/webp',
  sha256: 'abc',
  fileSizeBytes: 1024,
  keptAt: '2026-08-01T00:00:00.000Z',
  caption: 'The conservatory',
  tags: [],
  generationPromptExcerpt: '',
  linkSummary: { count: 1, linkers: [] },
}

// jest.setup replaces global.fetch with a plain jest.fn; own it per test.
const mockFetch = jest.fn()
const originalObserver = global.IntersectionObserver

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Internal Server Error',
    json: async () => body,
  }
}

function secondPageCalls(): number {
  return mockFetch.mock.calls.filter(([url]) => String(url).includes('offset=1')).length
}

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('action=albums')) return json({ albums: [] })
    if (url.includes('offset=0')) return json({ entries: [entry], total: 2, hasMore: true })
    return json({ error: 'The darkroom is flooded' }, 500)
  })
  global.fetch = mockFetch as unknown as typeof fetch
  global.IntersectionObserver = ImmediateIntersectionObserver as unknown as typeof IntersectionObserver
})

afterEach(() => {
  global.IntersectionObserver = originalObserver
})

describe('PhotosView — #350 (failed next page loops)', () => {
  it('asks for a failed next page once, then waits for "Try again"', async () => {
    renderWithQuery(<PhotosView />)

    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 })
    expect(secondPageCalls()).toBe(1)

    // Give a looping observer every chance to fire again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(secondPageCalls()).toBe(1)

    fireEvent.click(retry)
    await waitFor(() => expect(secondPageCalls()).toBe(2), { timeout: 4000 })

    // The retry failed too; it stops there again rather than looping.
    await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    expect(secondPageCalls()).toBe(2)
  })
})
