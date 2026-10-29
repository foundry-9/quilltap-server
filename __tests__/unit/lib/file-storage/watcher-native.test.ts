/**
 * @jest-environment node
 *
 * The files-directory watcher on Node's recursive fs.watch. fs.watch reports
 * only a path and "rename" / "change", so the watcher resolves each event
 * against the disk — these tests pin that resolution.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/lib/paths', () => ({
  getFilesDir: jest.fn().mockReturnValue('/mock/files'),
}))

jest.mock('@/lib/files/folder-utils', () => ({
  deriveFolderPathFromStorageKey: jest.fn().mockReturnValue('/'),
}))

jest.mock('@/lib/file-storage/scanner', () => ({
  computeSha256: jest.fn(),
  detectMimeType: jest.fn().mockReturnValue('image/png'),
  scanDirectory: jest.fn(),
}))

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
  lstat: jest.fn(),
}))

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/auth/single-user', () => ({
  getOrCreateSingleUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
}))

let watchListener: (eventType: 'rename' | 'change', filename: string | null) => void
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watch: jest.fn((_dir: string, _opts: unknown, listener: typeof watchListener) => {
    watchListener = listener
    return { on: jest.fn(), close: jest.fn() }
  }),
}))

import { startWatcher, stopWatcher } from '@/lib/file-storage/watcher'
import { computeSha256, scanDirectory } from '@/lib/file-storage/scanner'
import { getRepositories } from '@/lib/database/repositories'
import { watch } from 'fs'
import { lstat, stat } from 'fs/promises'

const mockWatch = watch as unknown as jest.Mock
const mockLstat = lstat as unknown as jest.Mock
const mockStat = stat as unknown as jest.Mock
const mockSha = computeSha256 as jest.Mock
const mockScan = scanDirectory as jest.Mock
const mockGetRepositories = getRepositories as jest.Mock

const fileStat = { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false }
const dirStat = { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true }
const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

let filesRepo: Record<string, jest.Mock>
let foldersRepo: Record<string, jest.Mock>

async function fire(eventType: 'rename' | 'change', relativePath: string): Promise<void> {
  watchListener(eventType, relativePath)
  await jest.advanceTimersByTimeAsync(600)
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  filesRepo = {
    findByStorageKey: jest.fn().mockResolvedValue(null),
    findBySha256: jest.fn().mockResolvedValue([]),
    findByUserId: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  }
  foldersRepo = { ensureByPath: jest.fn().mockResolvedValue(undefined) }
  mockGetRepositories.mockReturnValue({ files: filesRepo, folders: foldersRepo })
  mockStat.mockResolvedValue({ size: 100 })
  mockSha.mockResolvedValue('digest')
  startWatcher()
})

afterEach(async () => {
  await stopWatcher()
  jest.useRealTimers()
})

describe('files watcher on native fs.watch', () => {
  it('watches the files directory recursively', () => {
    expect(mockWatch).toHaveBeenCalledWith(
      '/mock/files',
      expect.objectContaining({ recursive: true }),
      expect.any(Function)
    )
  })

  it('records a new file on disk as orphaned', async () => {
    mockLstat.mockResolvedValue(fileStat)

    await fire('rename', 'proj/_general/new.png')

    expect(filesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'proj/_general/new.png', fileStatus: 'orphaned' })
    )
  })

  it('ignores thumbnails', async () => {
    await fire('rename', '_thumbnails/x.webp')

    expect(mockLstat).not.toHaveBeenCalled()
  })

  it('defer-deletes the record of a file that left', async () => {
    mockLstat.mockRejectedValue(enoent)
    filesRepo.findByStorageKey.mockResolvedValue({ id: 'f1', storageKey: 'proj/a.png' })

    await fire('rename', 'proj/a.png')
    expect(filesRepo.delete).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(3000)

    expect(filesRepo.delete).toHaveBeenCalledWith('f1')
  })

  it('defer-deletes every record beneath a folder that left', async () => {
    mockLstat.mockRejectedValue(enoent)
    filesRepo.findByStorageKey.mockImplementation(async (key: string) => ({ id: key, storageKey: key }))
    filesRepo.findByUserId.mockResolvedValue([
      { id: 'proj/Lore/a.png', storageKey: 'proj/Lore/a.png' },
      { id: 'proj/Lore/deep/b.png', storageKey: 'proj/Lore/deep/b.png' },
      { id: 'proj/Lore2/c.png', storageKey: 'proj/Lore2/c.png' },
    ])

    await fire('rename', 'proj/Lore')
    await jest.advanceTimersByTimeAsync(3000)

    const deleted = filesRepo.delete.mock.calls.map(c => c[0])
    expect(deleted).toEqual(expect.arrayContaining(['proj/Lore/a.png', 'proj/Lore/deep/b.png']))
    expect(deleted).not.toContain('proj/Lore2/c.png')
  })

  it('records a folder that arrived, and everything in it', async () => {
    mockLstat.mockResolvedValue(dirStat)
    mockScan.mockResolvedValue([
      { relativePath: 'proj/Imported/sub', isDirectory: true },
      { relativePath: 'proj/Imported/sub/a.png', isDirectory: false },
    ])

    await fire('rename', 'proj/Imported')

    expect(mockScan).toHaveBeenCalledWith('/mock/files', 'proj/Imported')
    expect(foldersRepo.ensureByPath.mock.calls.map(c => c[0].path)).toEqual([
      '/Imported/',
      '/Imported/sub/',
    ])
    expect(filesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'proj/Imported/sub/a.png' })
    )
  })

  it('does not walk a folder whose only event was a change', async () => {
    mockLstat.mockResolvedValue(dirStat)

    await fire('change', 'proj/Notes')

    expect(mockScan).not.toHaveBeenCalled()
  })

  it('keeps a moved record that a sha256 match found, even after its old path\'s delete window', async () => {
    // Old path gone: its record goes into the deferred-delete buffer.
    mockLstat.mockRejectedValueOnce(enoent)
    filesRepo.findByStorageKey.mockResolvedValueOnce({ id: 'f1', storageKey: 'proj/a.png', sha256: 'other' })
    await fire('rename', 'proj/a.png')

    // New path appears with a digest the buffer doesn't match, but the
    // repository's sha256 lookup does.
    mockLstat.mockResolvedValue(fileStat)
    filesRepo.findBySha256.mockResolvedValue([{ id: 'f1', storageKey: 'proj/a.png' }])
    await fire('rename', 'proj/b.png')
    await jest.advanceTimersByTimeAsync(3000)

    expect(filesRepo.update).toHaveBeenCalledWith('f1', expect.objectContaining({ storageKey: 'proj/b.png' }))
    expect(filesRepo.delete).not.toHaveBeenCalled()
  })
})
