/**
 * The one chat-settings writer: optimistic, server row on success, rollback
 * and a toast on failure (a failed save was console-only before).
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../helpers/renderWithQuery'
import { useChatSettingsMutation } from '@/hooks/useChatSettingsMutation'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { showErrorToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const mockFetch = global.fetch as jest.Mock

function useBoth() {
  return { query: useChatSettingsQuery(), mutation: useChatSettingsMutation() }
}

describe('useChatSettingsMutation', () => {
  let serverRow: Record<string, unknown>
  let failPut: boolean

  beforeEach(() => {
    jest.clearAllMocks()
    serverRow = { composerEmoji: false, timezone: 'UTC' }
    failPut = false
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        if (failPut) {
          return { ok: false, status: 400, statusText: 'Bad', json: async () => ({ error: 'Not a timezone' }) }
        }
        serverRow = { ...serverRow, ...JSON.parse(init.body as string) }
      }
      return { ok: true, status: 200, json: async () => serverRow }
    })
  })

  it('writes the server row into the shared cache on success', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => expect(result.current.query.data).toBeDefined())

    let ok = false
    await act(async () => { ok = await result.current.mutation.save({ composerEmoji: true }) })
    expect(ok).toBe(true)
    await waitFor(() => expect(result.current.query.data?.composerEmoji).toBe(true))
  })

  it('rolls the control back and toasts the server sentence on failure', async () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => expect(result.current.query.data).toBeDefined())

    failPut = true
    let ok = true
    await act(async () => { ok = await result.current.mutation.save({ timezone: 'Mars/Olympus' }, { failure: 'Failed' }) })
    expect(ok).toBe(false)
    expect(showErrorToast).toHaveBeenCalledWith('Not a timezone')
    await waitFor(() => expect(result.current.query.data?.timezone).toBe('UTC'))
  })
})
