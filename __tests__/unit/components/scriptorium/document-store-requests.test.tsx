/**
 * The Scriptorium's store writes (`app/scriptorium/document-store-requests`),
 * as the store list's hook uses them: a refusal reaches the operator in the
 * server's own words (a name already taken) rather than a stock "Failed to …",
 * and a success keeps its toast.
 */

import { act, renderHook } from '@testing-library/react'
import { createQueryWrapper } from '../../../helpers/renderWithQuery'
import { useDocumentStores } from '@/app/scriptorium/hooks/useDocumentStores'
import { scanCompleteMessage } from '@/app/scriptorium/document-store-requests'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/components/layout/queue-status-badges', () => ({ notifyQueueChange: jest.fn() }))

const TAKEN = 'A document store named "Notes" already exists. Names are matched without regard to case — please choose a different name.'

function respond(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, body } = handler(String(input), init)
    return { ok: status < 400, status, statusText: '', json: async () => body }
  }) as unknown as typeof fetch
}

describe('useDocumentStores writes', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows the server refusal when a name is taken', async () => {
    respond((url, init) =>
      init?.method === 'POST' ? { status: 409, body: { error: TAKEN } } : { status: 200, body: { mountPoints: [] } },
    )
    const { result } = renderHook(() => useDocumentStores(), createQueryWrapper())
    let created: unknown
    await act(async () => {
      created = await result.current.createStore({ name: 'notes', basePath: '' })
    })
    expect(created).toBeNull()
    expect(showErrorToast).toHaveBeenCalledWith(TAKEN)
  })

  it('scans and toasts the counts', async () => {
    const scan = { scanResult: { filesScanned: 3, filesNew: 0, filesModified: 0, filesDeleted: 0, chunksCreated: 0, errors: [] }, embeddingJobsEnqueued: 0 }
    respond((url) => (url.includes('action=scan') ? { status: 200, body: scan } : { status: 200, body: { mountPoints: [] } }))
    const { result } = renderHook(() => useDocumentStores(), createQueryWrapper())
    await act(async () => {
      await result.current.scanStore('s1')
    })
    expect(showSuccessToast).toHaveBeenCalledWith(scanCompleteMessage(scan))
    expect(showSuccessToast).toHaveBeenCalledWith('Scan complete: 3 files scanned, 0 embedding jobs queued')
  })
})
