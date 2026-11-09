/**
 * Whole-folder walks in lib/mount-index/folder-ops.ts, over database stores
 * (the per-file ops, folder rows and repositories mocked):
 *
 *  - copyFolder makes the destination tree, copies every file to its rebased
 *    path, refuses an existing destination or a folder into itself, and
 *    undoes the copies when one fails;
 *  - moveFolder within one store is the single folder move; into another
 *    store it moves file by file, removes the emptied source folders, and
 *    moves files back when one fails;
 *  - deleteFolder({ recursive }) deletes every file, then the folders deepest
 *    first; without `recursive` it is the empty-folder delete;
 *  - every change publishes the stores it touched.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const mockRepos = {
  docMountPoints: { findById: jest.fn() },
  docMountFileLinks: { findByMountPointId: jest.fn(), update: jest.fn() },
  docMountFolders: { findByMountPointId: jest.fn(), findByMountPointAndPath: jest.fn() },
}
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: () => mockRepos }))

const mockCopyFile = jest.fn()
const mockMoveFile = jest.fn()
const mockDeleteFile = jest.fn()
jest.mock('@/lib/mount-index/file-ops', () => ({
  copyFile: (...a: unknown[]) => mockCopyFile(...a),
  moveFile: (...a: unknown[]) => mockMoveFile(...a),
  deleteFile: (...a: unknown[]) => mockDeleteFile(...a),
  resolveFsAbsolute: jest.fn(),
}))

const mockCreateDbFolder = jest.fn()
const mockDeleteDbFolder = jest.fn()
const mockMoveDbFolder = jest.fn()
jest.mock('@/lib/mount-index/database-store', () => ({
  createDatabaseFolder: (...a: unknown[]) => mockCreateDbFolder(...a),
  deleteDatabaseFolder: (...a: unknown[]) => mockDeleteDbFolder(...a),
  moveDatabaseFolder: (...a: unknown[]) => mockMoveDbFolder(...a),
}))
jest.mock('@/lib/mount-index/scanner', () => ({ createFilesystemFolder: jest.fn(), listFilesystemFolders: jest.fn() }))
jest.mock('@/lib/mount-index/db-store-events', () => ({ emitDocumentMoved: jest.fn() }))
const mockPublish = jest.fn()
jest.mock('@/lib/mount-index/realtime', () => ({ publishMountChange: (id: string) => mockPublish(id) }))
jest.mock('@/lib/documents/core', () => ({ sweepChatDocumentsAfterFolderMove: jest.fn(async () => 0) }))

import { copyFolder, deleteFolder, moveFolder } from '@/lib/mount-index/folder-ops'
import { FileOpError } from '@/lib/mount-index/file-op-error'

type Store = { files: string[]; folders: string[] }
let stores: Record<string, Store>

beforeEach(() => {
  jest.clearAllMocks()
  stores = {
    a: { files: ['Lore/one.md', 'Lore/Deep/two.md', 'Other/x.md'], folders: ['Lore', 'Lore/Deep', 'Other'] },
    b: { files: [], folders: [] },
  }
  mockRepos.docMountPoints.findById.mockImplementation(async (id: string) =>
    stores[id] ? { id, mountType: 'database', name: id } : null,
  )
  mockRepos.docMountFileLinks.findByMountPointId.mockImplementation(async (id: string) =>
    stores[id].files.map((relativePath) => ({ relativePath })),
  )
  mockRepos.docMountFolders.findByMountPointId.mockImplementation(async (id: string) => stores[id].folders.map((path) => ({ path })))
  mockRepos.docMountFolders.findByMountPointAndPath.mockImplementation(async (id: string, p: string) =>
    stores[id].folders.some((f) => f.toLowerCase() === p.toLowerCase()) ? { id: `${id}:${p}`, path: p } : null,
  )
  mockCreateDbFolder.mockImplementation(async (id: string, p: string) => {
    stores[id].folders.push(p)
    return { folderId: p, path: p }
  })
  mockDeleteDbFolder.mockImplementation(async (id: string, p: string) => {
    stores[id].folders = stores[id].folders.filter((f) => f !== p)
    return { deleted: true }
  })
  mockCopyFile.mockImplementation(async (o: { destMountPointId: string; destPath: string }) => {
    stores[o.destMountPointId].files.push(o.destPath)
    return { destPath: o.destPath }
  })
  mockMoveFile.mockImplementation(async (o: { sourceMountPointId: string; sourcePath: string; destMountPointId: string; destPath: string }) => {
    stores[o.sourceMountPointId].files = stores[o.sourceMountPointId].files.filter((f) => f !== o.sourcePath)
    stores[o.destMountPointId].files.push(o.destPath)
    return { destPath: o.destPath }
  })
  mockDeleteFile.mockImplementation(async (o: { mountPointId: string; relativePath: string }) => {
    stores[o.mountPointId].files = stores[o.mountPointId].files.filter((f) => f !== o.relativePath)
    return { deleted: true }
  })
})

describe('copyFolder', () => {
  it('copies the tree into another store at its rebased paths', async () => {
    const result = await copyFolder({ mountPointId: 'a', fromPath: 'Lore', destMountPointId: 'b', toPath: 'Archive/Lore' })
    expect(stores.b.files.sort()).toEqual(['Archive/Lore/Deep/two.md', 'Archive/Lore/one.md'])
    expect(stores.b.folders).toEqual(['Archive/Lore', 'Archive/Lore/Deep'])
    expect(stores.a.files).toHaveLength(3)
    expect(result).toMatchObject({ files: 2, folders: 2, destMountPointId: 'b' })
    expect(mockPublish).toHaveBeenCalledWith('b')
  })

  it('refuses an existing destination and a folder into itself', async () => {
    await expect(copyFolder({ mountPointId: 'a', fromPath: 'Lore', toPath: 'Other' })).rejects.toMatchObject({ code: 'DEST_EXISTS' })
    await expect(copyFolder({ mountPointId: 'a', fromPath: 'Lore', toPath: 'Lore/Deep/Again' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(copyFolder({ mountPointId: 'a', fromPath: 'Nowhere', destMountPointId: 'b', toPath: 'X' })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
    expect(mockCopyFile).not.toHaveBeenCalled()
  })

  it('undoes the copies when one file fails', async () => {
    mockCopyFile
      .mockImplementationOnce(async (o: { destMountPointId: string; destPath: string }) => {
        stores[o.destMountPointId].files.push(o.destPath)
        return { destPath: o.destPath }
      })
      .mockRejectedValueOnce(new FileOpError('boom', 'VERIFY_FAILED'))
    await expect(copyFolder({ mountPointId: 'a', fromPath: 'Lore', destMountPointId: 'b', toPath: 'Lore' })).rejects.toThrow('boom')
    expect(stores.b.files).toEqual([])
  })
})

describe('moveFolder', () => {
  it('within one store is the single folder move', async () => {
    await moveFolder({ mountPointId: 'a', fromPath: 'Lore', toPath: 'Legends' })
    expect(mockMoveDbFolder).toHaveBeenCalledWith('a', 'Lore', 'Legends')
    expect(mockMoveFile).not.toHaveBeenCalled()
    expect(mockPublish).toHaveBeenCalledWith('a')
  })

  it('into another store moves each file and clears the emptied source folders', async () => {
    const result = await moveFolder({ mountPointId: 'a', fromPath: 'Lore', destMountPointId: 'b', toPath: 'Lore' })
    expect(stores.a.files).toEqual(['Other/x.md'])
    expect(stores.a.folders).toEqual(['Other'])
    expect(stores.b.files.sort()).toEqual(['Lore/Deep/two.md', 'Lore/one.md'])
    expect(result.files).toBe(2)
    expect(mockPublish).toHaveBeenCalledWith('a')
    expect(mockPublish).toHaveBeenCalledWith('b')
  })

  it('moves files back when one fails', async () => {
    let calls = 0
    mockMoveFile.mockImplementation(async (o: { sourceMountPointId: string; sourcePath: string; destMountPointId: string; destPath: string }) => {
      calls++
      if (calls === 2) throw new FileOpError('nope', 'VERIFY_FAILED')
      stores[o.sourceMountPointId].files = stores[o.sourceMountPointId].files.filter((f) => f !== o.sourcePath)
      stores[o.destMountPointId].files.push(o.destPath)
      return { destPath: o.destPath }
    })
    await expect(moveFolder({ mountPointId: 'a', fromPath: 'Lore', destMountPointId: 'b', toPath: 'Lore' })).rejects.toThrow('nope')
    expect(stores.a.files.sort()).toEqual(['Lore/Deep/two.md', 'Lore/one.md', 'Other/x.md'])
    expect(stores.b.files).toEqual([])
  })
})

describe('deleteFolder', () => {
  it('recursive: deletes every file, then the folders deepest first', async () => {
    const result = await deleteFolder({ mountPointId: 'a', relativePath: 'Lore', recursive: true })
    expect(result.deletedFiles).toBe(2)
    expect(stores.a.files).toEqual(['Other/x.md'])
    expect(mockDeleteDbFolder.mock.calls.map((c) => c[1])).toEqual(['Lore/Deep', 'Lore'])
  })

  it('without recursive is the empty-folder delete', async () => {
    await deleteFolder({ mountPointId: 'a', relativePath: 'Other' })
    expect(mockDeleteDbFolder).toHaveBeenCalledWith('a', 'Other')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockPublish).toHaveBeenCalledWith('a')
  })
})
