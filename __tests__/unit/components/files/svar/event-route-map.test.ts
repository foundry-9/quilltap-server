/**
 * The translation table is the adapter's swap-out insurance, so it's pinned
 * exhaustively: every SVAR mutating/read event → the exact v1 REST call(s),
 * with cross-mount routing (destMountPointId), file-vs-folder discrimination,
 * the backend gaps surfaced as `unsupported`, and root-level creates falling
 * back to the active mount. Pure — a fake resolver stands in for SVAR runtime.
 */

import {
  mapRename,
  mapCreate,
  mapDelete,
  mapMove,
  mapCopy,
  mapOpen,
  mapDownload,
  mapSvarEvent,
} from '@/components/files/svar/event-route-map'
import type { NodeResolver, ResolvedNode, MapContext } from '@/components/files/svar/event-route-map'

const A = 'mount-a'
const B = 'mount-b'

function ctxFrom(nodes: Record<string, ResolvedNode>, mountId = A): MapContext {
  const resolve: NodeResolver = (id) => nodes[id]
  return { resolve, mountId }
}

describe('mapRename', () => {
  it('PATCHes the item route with the new mount-relative path', () => {
    const ctx = ctxFrom({ n1: { mountId: A, relativePath: 'Research/old.md', type: 'file' } })
    expect(mapRename({ id: 'n1', name: 'new.md' }, ctx)).toEqual([
      {
        op: 'rename',
        method: 'PATCH',
        url: `/api/v1/mount-points/${A}/files/Research/old.md`,
        body: { rename: 'Research/new.md' },
      },
    ])
  })
  it('renames a top-level file into the mount root', () => {
    const ctx = ctxFrom({ n1: { mountId: A, relativePath: 'old.md', type: 'file' } })
    expect(mapRename({ id: 'n1', name: 'new.md' }, ctx)[0].body).toEqual({ rename: 'new.md' })
  })
  it('drops the event for an unresolved id', () => {
    expect(mapRename({ id: 'ghost', name: 'x' }, ctxFrom({}))).toEqual([])
  })
})

describe('mapCreate', () => {
  it('creates a folder under its parent', () => {
    const ctx = ctxFrom({ p: { mountId: A, relativePath: 'Research', type: 'folder' } })
    expect(mapCreate({ file: { name: 'Sub', type: 'folder' }, parent: 'p' }, ctx)).toEqual([
      { op: 'create-folder', method: 'POST', url: `/api/v1/mount-points/${A}/folders`, body: { path: 'Research/Sub' } },
    ])
  })
  it('uploads a file as a multipart write-file action', () => {
    const ctx = ctxFrom({ p: { mountId: A, relativePath: 'Research', type: 'folder' } })
    const out = mapCreate({ file: { name: 'doc.md', type: 'file' }, parent: 'p' }, ctx)
    expect(out).toEqual([
      { op: 'upload', method: 'POST', url: `/api/v1/mount-points/${A}?action=write-file`, multipart: true, body: { path: 'Research/doc.md' } },
    ])
  })
  it('falls back to the active mount + root when the parent is the (unresolved) drive', () => {
    const ctx = ctxFrom({}, B) // active pane is mount B; parent id not in tree
    const out = mapCreate({ file: { name: 'top.md', type: 'file' }, parent: `/${B}` }, ctx)
    expect(out[0].url).toBe(`/api/v1/mount-points/${B}?action=write-file`)
    expect(out[0].body).toEqual({ path: 'top.md' })
  })
})

describe('mapDelete', () => {
  it('routes files to DELETE and folders to delete-folder, skipping unknowns', () => {
    const ctx = ctxFrom({
      f: { mountId: A, relativePath: 'a/b.md', type: 'file' },
      d: { mountId: A, relativePath: 'a', type: 'folder' },
    })
    expect(mapDelete({ ids: ['f', 'd', 'ghost'] }, ctx)).toEqual([
      { op: 'delete-file', method: 'DELETE', url: `/api/v1/mount-points/${A}/files/a/b.md` },
      { op: 'delete-folder', method: 'POST', url: `/api/v1/mount-points/${A}?action=delete-folder`, body: { path: 'a' } },
    ])
  })
})

describe('mapMove', () => {
  it('moves a file within a mount', () => {
    const ctx = ctxFrom({
      s: { mountId: A, relativePath: 'in/doc.md', type: 'file' },
      t: { mountId: A, relativePath: 'out', type: 'folder' },
    })
    expect(mapMove({ ids: ['s'], target: 't' }, ctx)).toEqual([
      { op: 'move-file', method: 'POST', url: `/api/v1/mount-points/${A}?action=move-file`, body: { sourcePath: 'in/doc.md', destMountPointId: A, destPath: 'out/doc.md' } },
    ])
  })
  it('routes a cross-mount file move with the destination mount id', () => {
    const ctx = ctxFrom({
      s: { mountId: A, relativePath: 'doc.md', type: 'file' },
      t: { mountId: B, relativePath: 'incoming', type: 'folder' },
    })
    const out = mapMove({ ids: ['s'], target: 't' }, ctx)
    expect(out[0].url).toBe(`/api/v1/mount-points/${A}?action=move-file`)
    expect(out[0].body).toEqual({ sourcePath: 'doc.md', destMountPointId: B, destPath: 'incoming/doc.md' })
  })
  it('flags a cross-mount folder move as unsupported', () => {
    const ctx = ctxFrom({
      s: { mountId: A, relativePath: 'Folder', type: 'folder' },
      t: { mountId: B, relativePath: 'dest', type: 'folder' },
    })
    const out = mapMove({ ids: ['s'], target: 't' }, ctx)
    expect(out[0].op).toBe('move-folder')
    expect(out[0].unsupported).toBeTruthy()
  })
  it('moves a folder within a mount via move-folder fromPath/toPath', () => {
    const ctx = ctxFrom({
      s: { mountId: A, relativePath: 'Folder', type: 'folder' },
      t: { mountId: A, relativePath: 'dest', type: 'folder' },
    })
    const out = mapMove({ ids: ['s'], target: 't' }, ctx)
    expect(out[0].unsupported).toBeUndefined()
    expect(out[0].body).toEqual({ fromPath: 'Folder', toPath: 'dest/Folder' })
  })
})

describe('mapCopy', () => {
  it('copies a file cross-mount via copy-file', () => {
    const ctx = ctxFrom({
      s: { mountId: A, relativePath: 'doc.pdf', type: 'file' },
      t: { mountId: B, relativePath: '', type: 'folder' },
    })
    expect(mapCopy({ ids: ['s'], target: 't' }, ctx)).toEqual([
      { op: 'copy-file', method: 'POST', url: `/api/v1/mount-points/${A}?action=copy-file`, body: { sourcePath: 'doc.pdf', destMountPointId: B, destPath: 'doc.pdf' } },
    ])
  })
  it('flags a folder copy as unsupported (no copy-folder route)', () => {
    const ctx = ctxFrom({
      s: { mountId: A, relativePath: 'Folder', type: 'folder' },
      t: { mountId: A, relativePath: 'dest', type: 'folder' },
    })
    expect(mapCopy({ ids: ['s'], target: 't' }, ctx)[0].unsupported).toBeTruthy()
  })
})

describe('read ops', () => {
  it('open-file GETs the item route; folders are ignored', () => {
    const ctx = ctxFrom({
      f: { mountId: A, relativePath: 'a/b.md', type: 'file' },
      d: { mountId: A, relativePath: 'a', type: 'folder' },
    })
    expect(mapOpen({ id: 'f' }, ctx)).toEqual([
      { op: 'open', method: 'GET', url: `/api/v1/mount-points/${A}/files/a/b.md` },
    ])
    expect(mapOpen({ id: 'd' }, ctx)).toEqual([])
  })
  it('download-file requests raw bytes', () => {
    const ctx = ctxFrom({ f: { mountId: A, relativePath: 'a/b.bin', type: 'file' } })
    expect(mapDownload({ id: 'f' }, ctx)[0].url).toBe(`/api/v1/mount-points/${A}/files/a/b.bin?raw=1`)
  })
})

describe('mapSvarEvent dispatch', () => {
  const ctx = ctxFrom({ n: { mountId: A, relativePath: 'x.md', type: 'file' } })
  it('routes known actions', () => {
    expect(mapSvarEvent('rename-file', { id: 'n', name: 'y.md' }, ctx)[0].op).toBe('rename')
    expect(mapSvarEvent('delete-files', { ids: ['n'] }, ctx)[0].op).toBe('delete-file')
  })
  it('returns [] for UI-only / unknown actions', () => {
    expect(mapSvarEvent('select-file', { id: 'n' }, ctx)).toEqual([])
    expect(mapSvarEvent('sort-files', { key: 'name', order: 'asc' }, ctx)).toEqual([])
    expect(mapSvarEvent('totally-made-up', {}, ctx)).toEqual([])
  })
})
