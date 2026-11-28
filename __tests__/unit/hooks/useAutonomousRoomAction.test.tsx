/** #282: a failed room action toasts the server's message and restores the run state. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../../helpers/renderWithQuery'
import { useAutonomousRoomAction } from '@/hooks/useAutonomousRoomAction'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn() }))

describe('useAutonomousRoomAction', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'already in progress' }),
      text: async () => JSON.stringify({ error: 'already in progress' }),
    }) as unknown as typeof fetch
  })

  it('shows the server message in a toast on failure', async () => {
    const { wrapper, queryClient } = createQueryWrapper()
    const before = { rooms: [{ id: 'chat-1', runState: 'idle' }] }
    queryClient.setQueryData(queryKeys.system.autonomousRooms, before)
    const setSpy = jest.spyOn(queryClient, 'setQueryData')
    const { result } = renderHook(() => useAutonomousRoomAction('Failed'), { wrapper })
    await act(async () => {
      await result.current.run('chat-1', 'start')
    })
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('already in progress'))
    expect(setSpy).toHaveBeenLastCalledWith(queryKeys.system.autonomousRooms, before)
  })
})
