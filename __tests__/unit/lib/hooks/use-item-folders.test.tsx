/**
 * The shared folder hooks (`lib/hooks/use-item-folders.ts`), for both kinds:
 * the read goes to the kind's `?action=folders` under the kind's key, the
 * writes go to the kind's action URLs, the Wardrobe's `components` mode rides
 * along, and a write's refresh is left to the kind's realtime topic while the
 * socket is up and done here while it is down.
 */

jest.mock('@/lib/realtime/client', () => ({ getRealtimeStatus: jest.fn() }))

import { act, renderHook, waitFor } from '@testing-library/react'
import { getRealtimeStatus } from '@/lib/realtime/client'
import { queryKeys } from '@/lib/query/keys'
import { useItemFolderMutations, useItemFolders, type ItemKind } from '@/lib/hooks/use-item-folders'
import { InventoryRequestError } from '@/lib/inventory/request'
import { createQueryWrapper, createTestQueryClient } from '@/__tests__/helpers/renderWithQuery'

const status = getRealtimeStatus as jest.Mock
const PROJECT = { scope: 'project' as const, id: 'project-1' }
const fetchMock = global.fetch as jest.Mock

function respond(body: unknown, code = 200) {
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: code < 400,
      status: code,
      statusText: '',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  )
}

function setup() {
  const queryClient = createTestQueryClient()
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries')
  const { wrapper } = createQueryWrapper(queryClient)
  return { queryClient, invalidate, wrapper }
}

const invalidatedKeys = (spy: jest.SpyInstance) => spy.mock.calls.map(([filters]) => filters?.queryKey)
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit | undefined]

const KINDS: Array<{
  kind: ItemKind
  folders: string
  createUrl: string
  refreshed: readonly unknown[]
}> = [
  {
    kind: 'wardrobe',
    folders: '/api/v1/projects/project-1/wardrobe?action=folders',
    createUrl: '/api/v1/projects/project-1/wardrobe?action=create-folder',
    refreshed: [queryKeys.wardrobe.folderLists, queryKeys.wardrobe.lists],
  },
  {
    kind: 'inventory',
    folders: '/api/v1/projects/project-1/inventory?action=folders',
    createUrl: '/api/v1/projects/project-1/inventory?action=create-folder',
    refreshed: [
      queryKeys.inventory.lists,
      queryKeys.inventory.folderLists,
      queryKeys.inventory.archetypeLists,
      queryKeys.inventory.equippedLists,
    ],
  },
]

beforeEach(() => {
  fetchMock.mockReset()
  respond({ folders: [{ path: 'Coats', itemCount: 2 }] })
})

describe.each(KINDS)('$kind', ({ kind, folders, createUrl, refreshed }) => {
  it('reads the container\'s folder tree under the kind\'s key', async () => {
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useItemFolders(kind, PROJECT), { wrapper })
    await waitFor(() => expect(result.current.folders).toHaveLength(1))
    expect(fetchMock.mock.calls[0][0]).toBe(folders)
    expect(queryClient.getQueryData(queryKeys[kind].folders('project:project-1'))).toEqual([{ path: 'Coats', itemCount: 2 }])
  })

  it('skips the read for a null container', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useItemFolders(kind, null), { wrapper })
    expect(result.current.folders).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates a folder and leaves the refresh to the realtime publish while the socket is up', async () => {
    status.mockReturnValue('connected')
    respond({ folder: { path: 'Coats', itemCount: 0 } })
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useItemFolderMutations(kind), { wrapper })
    let folder: unknown
    await act(async () => {
      folder = await result.current.createFolder(PROJECT, 'Coats')
    })
    expect(folder).toEqual({ path: 'Coats', itemCount: 0 })
    const [url, init] = lastCall()
    expect(url).toBe(createUrl)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ path: 'Coats' })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refreshes the kind\'s lists and folders itself while the socket is down', async () => {
    status.mockReturnValue('connecting')
    respond({ movedItems: 3, movedFolders: 1 })
    const { invalidate, wrapper } = setup()
    const { result } = renderHook(() => useItemFolderMutations(kind), { wrapper })
    let moved: unknown
    await act(async () => {
      moved = await result.current.deleteFolder(PROJECT, 'Coats')
    })
    expect(moved).toEqual({ movedItems: 3, movedFolders: 1 })
    expect(invalidatedKeys(invalidate)).toEqual(refreshed)
  })

  it('throws the server\'s refusal', async () => {
    status.mockReturnValue('connected')
    respond({ error: 'That folder is taken' }, 409)
    const { wrapper } = setup()
    const { result } = renderHook(() => useItemFolderMutations(kind), { wrapper })
    await act(async () => {
      await expect(result.current.renameFolder(PROJECT, 'Coats', 'Hats')).rejects.toThrow('That folder is taken')
    })
  })
})

describe('kind-specific filing', () => {
  it('sends the Wardrobe\'s components mode with a move', async () => {
    status.mockReturnValue('connected')
    respond({ items: [{ id: 'i-1' }] })
    const { wrapper } = setup()
    const { result } = renderHook(() => useItemFolderMutations('wardrobe'), { wrapper })
    let items: unknown
    await act(async () => {
      items = await result.current.fileItems('move', PROJECT, ['i-1'], 'Coats', 'copy')
    })
    expect(items).toEqual([{ id: 'i-1' }])
    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/projects/project-1/wardrobe?action=move-items')
    expect(JSON.parse(String(init?.body))).toEqual({ itemIds: ['i-1'], folder: 'Coats', components: 'copy' })
  })

  it('copies Inventory objects with no components, and refuses with the server\'s code', async () => {
    status.mockReturnValue('connected')
    respond({ items: [] })
    const { wrapper } = setup()
    const { result } = renderHook(() => useItemFolderMutations('inventory'), { wrapper })
    await act(async () => {
      await result.current.fileItems('copy', PROJECT, ['i-1'], '')
    })
    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/projects/project-1/inventory?action=copy-items')
    expect(JSON.parse(String(init?.body))).toEqual({ itemIds: ['i-1'], folder: '' })

    respond({ error: 'No copies', details: { code: 'NOT_COPYABLE' } }, 400)
    await act(async () => {
      const error = await result.current.fileItems('copy', PROJECT, ['i-1'], '').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(InventoryRequestError)
      expect((error as InventoryRequestError).code).toBe('NOT_COPYABLE')
    })
  })
})
