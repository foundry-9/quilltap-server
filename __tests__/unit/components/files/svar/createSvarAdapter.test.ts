/**
 * The adapter wiring choreography, exercised with a fake SVAR api + a mock
 * fetch (no SVAR runtime, no browser): each mutating event fires the right REST
 * call, failures surface a verdict AND still ask for a reload (to revert the
 * optimistic change), capability gates block disallowed verbs without a request,
 * `unsupported` gestures never hit the network, and a cross-storage byte-copy of
 * a .pdf triggers the scoped reindex + embed.
 */

import { wireSvarAdapter, loadMountTree, wirePickerSelection } from '@/components/files/svar/createSvarAdapter'
import type { AdapterConfig, AdapterCallbacks } from '@/components/files/svar/createSvarAdapter'
import type { IApi } from '@/components/files/svar/svar-types'
import type { MountCapabilities } from '@/lib/mount-index/capabilities'

const ALL_CAPS: MountCapabilities = {
  canWrite: true,
  canDelete: true,
  canCreateFolder: true,
  canMoveIn: true,
  canMoveOut: true,
  canConvert: true,
}

type Handlers = Record<string, (payload: unknown) => void>

function makeApi(nodes: Record<string, { type: 'file' | 'folder' }>): { api: IApi; handlers: Handlers } {
  const handlers: Handlers = {}
  const api = {
    on: (action: string, cb: (p: unknown) => void) => {
      handlers[action] = cb
    },
    getFile: (id: string) => nodes[id],
    exec: jest.fn(),
    intercept: jest.fn(),
    detach: jest.fn(),
    getState: jest.fn(),
    getReactiveState: jest.fn(),
    setNext: jest.fn(),
    getStores: jest.fn(),
    serialize: jest.fn(),
  } as unknown as IApi
  return { api, handlers }
}

function jsonRes(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
}

const config: AdapterConfig = { mountId: 'A', capabilities: ALL_CAPS }

describe('wireSvarAdapter', () => {
  it('creates a folder via POST …/folders and asks for a reload', async () => {
    const { api, handlers } = makeApi({ '/Research': { type: 'folder' } })
    const fetchMock = jest.fn().mockResolvedValue(jsonRes({ path: 'Research/Sub' }))
    const onReloadNeeded = jest.fn()
    wireSvarAdapter(api, config, { onReloadNeeded }, fetchMock)

    handlers['create-file']({ file: { name: 'Sub', type: 'folder' }, parent: '/Research' })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/mount-points/A/folders',
      expect.objectContaining({ method: 'POST' })
    )
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ path: 'Research/Sub' })
    expect(onReloadNeeded).toHaveBeenCalledTimes(1)
  })

  it('renames via PATCH on the item route', async () => {
    const { api, handlers } = makeApi({ '/old.md': { type: 'file' } })
    const fetchMock = jest.fn().mockResolvedValue(jsonRes({ relativePath: 'new.md', renamed: true }))
    wireSvarAdapter(api, config, {}, fetchMock)

    handlers['rename-file']({ id: '/old.md', name: 'new.md' })
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/mount-points/A/files/old.md',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('translates a failure to a verdict and still requests a reload (revert)', async () => {
    const { api, handlers } = makeApi({ '/x.md': { type: 'file' }, '/dest': { type: 'folder' } })
    // copy refused (e.g. across storage types) — server returns UNSUPPORTED
    const fetchMock = jest.fn().mockResolvedValue(jsonRes({ code: 'UNSUPPORTED' }, { ok: false, status: 400 }))
    const onError = jest.fn()
    const onReloadNeeded = jest.fn()
    wireSvarAdapter(api, config, { onError, onReloadNeeded }, fetchMock)

    handlers['copy-files']({ ids: ['/x.md'], target: '/dest' })
    await flush()

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/copy/i), expect.objectContaining({ suggestCopy: true }))
    expect(onReloadNeeded).toHaveBeenCalled()
  })

  it('fires scoped reindex + embed after a cross-storage byte-copy of a .pdf', async () => {
    const { api, handlers } = makeApi({ '/report.pdf': { type: 'file' }, '/dest': { type: 'folder' } })
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonRes({ strategy: 'byte-copy', destMountPointId: 'B', destPath: 'report.pdf' }))
      .mockResolvedValue(jsonRes({ ok: true }))
    const onIndexing = jest.fn()
    wireSvarAdapter(api, config, { onIndexing }, fetchMock)

    handlers['copy-files']({ ids: ['/report.pdf'], target: '/dest' })
    await flush()

    expect(onIndexing).toHaveBeenCalledWith({ mountId: 'B', path: 'report.pdf' })
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toContain('/api/v1/mount-points/B?action=reindex')
    expect(urls).toContain('/api/v1/mount-points/B?action=embed')
  })

  it('blocks a delete on a no-delete mount without hitting the network', async () => {
    const { api, handlers } = makeApi({ '/x.md': { type: 'file' } })
    const fetchMock = jest.fn()
    const onError = jest.fn()
    const onReloadNeeded = jest.fn()
    wireSvarAdapter(api, { mountId: 'A', capabilities: { ...ALL_CAPS, canDelete: false } }, { onError, onReloadNeeded }, fetchMock)

    handlers['delete-files']({ ids: ['/x.md'] })
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
    expect(onReloadNeeded).toHaveBeenCalled() // revert the optimistic delete
  })

  it('surfaces an unsupported gesture without a network call', async () => {
    const { api, handlers } = makeApi({ '/Folder': { type: 'folder' }, '/dest': { type: 'folder' } })
    const fetchMock = jest.fn()
    const onError = jest.fn()
    wireSvarAdapter(api, config, { onError }, fetchMock)

    // whole-folder copy → unsupported (no copy-folder route)
    handlers['copy-files']({ ids: ['/Folder'], target: '/dest' })
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/folder/i), expect.any(Object))
  })
})

describe('wirePickerSelection (light costume)', () => {
  it('reports a file pick on select-file and on open-file (double-click)', () => {
    const { api, handlers } = makeApi({ '/notes.md': { type: 'file' } })
    const onPick = jest.fn()
    wirePickerSelection(api, { select: 'file', onPick })

    handlers['select-file']({ id: '/notes.md' })
    expect(onPick).toHaveBeenLastCalledWith({ relativePath: 'notes.md', type: 'file' })

    handlers['open-file']({ id: '/notes.md' })
    expect(onPick).toHaveBeenLastCalledWith({ relativePath: 'notes.md', type: 'file' })
  })

  it('rejects a file when the picker wants a folder (and vice-versa)', () => {
    const { api, handlers } = makeApi({ '/notes.md': { type: 'file' }, '/Research': { type: 'folder' } })
    const onPick = jest.fn()
    wirePickerSelection(api, { select: 'folder', onPick })

    handlers['select-file']({ id: '/notes.md' })
    expect(onPick).toHaveBeenLastCalledWith(null) // file rejected by a folder picker

    handlers['select-file']({ id: '/Research' })
    expect(onPick).toHaveBeenLastCalledWith({ relativePath: 'Research', type: 'folder' })
  })

  it('clears the pick when selection is empty', () => {
    const { api, handlers } = makeApi({})
    const onPick = jest.fn()
    wirePickerSelection(api, { onPick })
    handlers['select-file']({})
    expect(onPick).toHaveBeenLastCalledWith(null)
  })
})

describe('loadMountTree', () => {
  it('GETs the listing and maps it to SVAR nodes', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonRes({ files: [], folders: ['Research'] })
    )
    const tree = await loadMountTree('A', fetchMock)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/mount-points/A/files')
    expect(tree).toContainEqual({ id: '/Research', type: 'folder' })
  })
})
