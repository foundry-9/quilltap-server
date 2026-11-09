/**
 * Folder changes on a filesystem store keep the scanner's folder rows in
 * step with the disk. Moving a folder renames it on disk and carries its
 * index along: the link rows' paths, and the folder rows (in place, ids
 * kept). Deleting a folder removes its row with the directory. Before
 * either did, the old path lingered in the store's listing.
 */

import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

let base = ''
const mockRepos = {
  docMountPoints: { findById: jest.fn() },
  docMountFileLinks: { findByMountPointId: jest.fn(), update: jest.fn() },
  docMountFolders: { findByMountPointId: jest.fn(), findByMountPointAndPath: jest.fn(), update: jest.fn(), delete: jest.fn() },
}
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: () => mockRepos }))
jest.mock('@/lib/mount-index/file-ops', () => ({
  copyFile: jest.fn(),
  moveFile: jest.fn(),
  deleteFile: jest.fn(),
  resolveFsAbsolute: (_mp: unknown, rel: string) => path.join(base, rel),
}))
jest.mock('@/lib/mount-index/database-store', () => ({
  createDatabaseFolder: jest.fn(),
  deleteDatabaseFolder: jest.fn(),
  moveDatabaseFolder: jest.fn(),
}))
jest.mock('@/lib/mount-index/scanner', () => ({ createFilesystemFolder: jest.fn(), listFilesystemFolders: jest.fn() }))
jest.mock('@/lib/mount-index/db-store-events', () => ({ emitDocumentMoved: jest.fn() }))
jest.mock('@/lib/mount-index/realtime', () => ({ publishMountChange: jest.fn() }))
const mockSweep = jest.fn(async () => 0)
jest.mock('@/lib/documents/core', () => ({
  sweepChatDocumentsAfterFolderMove: (...args: unknown[]) => mockSweep(...(args as [])),
}))
const mockEnsureFolderPath = jest.fn(async (_id: string, p: string) => `row:${p}`)
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (id: string, p: string) => mockEnsureFolderPath(id, p),
}))

import { deleteFolder, moveFolder } from '@/lib/mount-index/folder-ops'

beforeEach(async () => {
  jest.clearAllMocks()
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'qt-fs-move-'))
  await fs.mkdir(path.join(base, 'Notes/Deep'), { recursive: true })
  await fs.writeFile(path.join(base, 'Notes/Deep/readme.txt'), 'x')
  mockRepos.docMountPoints.findById.mockResolvedValue({ id: 'fs', mountType: 'filesystem', basePath: base, name: 'fs' })
  mockRepos.docMountFileLinks.findByMountPointId.mockResolvedValue([{ id: 'l1', relativePath: 'Notes/Deep/readme.txt' }])
  mockRepos.docMountFolders.findByMountPointId.mockResolvedValue([
    { id: 'f-notes', path: 'Notes' },
    { id: 'f-deep', path: 'Notes/Deep' },
  ])
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('moveFolder on a filesystem store', () => {
  it('moves the directory, the link rows and the folder rows', async () => {
    await moveFolder({ mountPointId: 'fs', fromPath: 'Notes', toPath: 'Archive/Notes' })

    await expect(fs.access(path.join(base, 'Archive/Notes/Deep/readme.txt'))).resolves.toBeUndefined()
    expect(mockRepos.docMountFileLinks.update).toHaveBeenCalledWith('l1', {
      relativePath: 'Archive/Notes/Deep/readme.txt',
      fileName: 'readme.txt',
    })
    expect(mockEnsureFolderPath).toHaveBeenCalledWith('fs', 'Archive')
    expect(mockRepos.docMountFolders.update).toHaveBeenCalledWith('f-notes', {
      parentId: 'row:Archive',
      name: 'Notes',
      path: 'Archive/Notes',
    })
    expect(mockRepos.docMountFolders.update).toHaveBeenCalledWith('f-deep', { path: 'Archive/Notes/Deep' })
  })

  it('carries the rows when the source is typed in another casing (#147)', async () => {
    await moveFolder({ mountPointId: 'fs', fromPath: 'notes', toPath: 'archive' })

    expect(mockRepos.docMountFileLinks.update).toHaveBeenCalledWith('l1', {
      relativePath: 'archive/Deep/readme.txt',
      fileName: 'readme.txt',
    })
    expect(mockRepos.docMountFolders.update).toHaveBeenCalledWith('f-notes', { parentId: null, name: 'archive', path: 'archive' })
    expect(mockRepos.docMountFolders.update).toHaveBeenCalledWith('f-deep', { path: 'archive/Deep' })
  })

  it('sweeps the open documents under the folder (#147)', async () => {
    await moveFolder({ mountPointId: 'fs', fromPath: 'Notes', toPath: 'Archive' })

    expect(mockSweep).toHaveBeenCalledWith({
      scope: 'document_store',
      mountPoint: 'fs',
      mountPointId: 'fs',
      oldFolderPath: 'Notes',
      newFolderPath: 'Archive',
    })
  })

  it('moves a nested folder to the top, leaving its old parent row alone', async () => {
    await moveFolder({ mountPointId: 'fs', fromPath: 'Notes/Deep', toPath: 'Deep' })

    expect(mockEnsureFolderPath).not.toHaveBeenCalled()
    expect(mockRepos.docMountFolders.update).toHaveBeenCalledTimes(1)
    expect(mockRepos.docMountFolders.update).toHaveBeenCalledWith('f-deep', { parentId: null, name: 'Deep', path: 'Deep' })
  })
})

describe('deleteFolder on a filesystem store', () => {
  it('removes the directory and its folder row', async () => {
    await fs.mkdir(path.join(base, 'Empty'))
    mockRepos.docMountFolders.findByMountPointAndPath.mockResolvedValue({ id: 'f-empty', path: 'Empty' })

    await deleteFolder({ mountPointId: 'fs', relativePath: 'Empty' })

    await expect(fs.access(path.join(base, 'Empty'))).rejects.toThrow()
    expect(mockRepos.docMountFolders.delete).toHaveBeenCalledWith('f-empty')
  })
})
