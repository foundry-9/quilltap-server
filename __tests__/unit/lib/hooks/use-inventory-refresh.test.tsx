/**
 * The Inventory hooks' refresh after this tab's own write: left to the
 * server's realtime publish while the socket is up (refreshing here too would
 * fetch everything twice), done here while it is down.
 */

jest.mock('@/lib/realtime/client', () => ({ getRealtimeStatus: jest.fn() }))

import { act, renderHook } from '@testing-library/react'
import { getRealtimeStatus } from '@/lib/realtime/client'
import { queryKeys } from '@/lib/query/keys'
import { useChatInventory, useInventoryMutations } from '@/lib/hooks/use-inventory'
import { createQueryWrapper, createTestQueryClient } from '@/__tests__/helpers/renderWithQuery'

const status = getRealtimeStatus as jest.Mock
const PROJECT = { scope: 'project' as const, id: 'project-1' }

function setup() {
  const queryClient = createTestQueryClient()
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
  const { wrapper } = createQueryWrapper(queryClient)
  return { invalidate, wrapper }
}

const invalidatedKeys = (spy: jest.SpyInstance) => spy.mock.calls.map(([filters]) => filters?.queryKey)

const fetchMock = global.fetch as jest.Mock

/** Every request answers `status` with `body`. */
function respond(body: unknown, status = 200) {
  fetchMock.mockImplementation(() =>
    Promise.resolve({ ok: status < 400, status, statusText: '', json: () => Promise.resolve(body) }),
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  respond({ item: { id: 'i-1', name: 'rope' } })
})

describe('useInventoryMutations', () => {
  it('leaves the refresh to the realtime publish while the socket is up', async () => {
    status.mockReturnValue('connected')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useInventoryMutations(), { wrapper })
    await act(async () => {
      await result.current.create(PROJECT, { name: 'rope' })
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refreshes the lists, folders, archetype pickers and carried sets itself while the socket is down', async () => {
    status.mockReturnValue('connecting')
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useInventoryMutations(), { wrapper })
    await act(async () => {
      await result.current.create(PROJECT, { name: 'rope' })
    })
    expect(invalidatedKeys(invalidate)).toEqual([
      queryKeys.inventory.lists,
      queryKeys.inventory.folderLists,
      queryKeys.inventory.archetypeLists,
      queryKeys.inventory.equippedLists,
    ])
  })

  it('refreshes after a refused write too, when the socket is down', async () => {
    status.mockReturnValue('idle')
    respond({ error: 'no', details: { code: 'CAP_EXCEEDED' } }, 409)
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useInventoryMutations(), { wrapper })
    await act(async () => {
      await expect(result.current.create(PROJECT, { name: 'rope' })).rejects.toThrow()
    })
    expect(invalidate).toHaveBeenCalled()
  })
})

describe('useChatInventory', () => {
  it('leaves an equip\'s refresh to the chats and inventory publishes while the socket is up', async () => {
    status.mockReturnValue('connected')
    respond({ inventory: {}, projectId: null })
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useChatInventory('chat-1'), { wrapper })
    await act(async () => {
      await result.current.equip('c-1', ['i-1'])
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refreshes this chat\'s carried sets and the lists itself while the socket is down', async () => {
    status.mockReturnValue('connecting')
    respond({ inventory: {}, projectId: null })
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useChatInventory('chat-1'), { wrapper })
    await act(async () => {
      await result.current.equip('c-1', ['i-1'])
    })
    expect(invalidatedKeys(invalidate)).toEqual([queryKeys.inventory.equipped('chat-1'), queryKeys.inventory.lists])
  })
})
