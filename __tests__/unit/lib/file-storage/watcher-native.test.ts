/**
 * @jest-environment node
 *
 * The files-directory watcher's domain on the shared recursive watcher core.
 * The core itself (debounce, lstat dispatch, symlinks, polling) is pinned in
 * lib/files/__tests__/recursive-watcher.test.ts; these tests pin what the
 * files table does with each event, and what the move onto the core gained:
 * the polling fallback, the cloud-placeholder guard, and a plain file delete
 * that no longer reads every record.
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
const watchImpl = (_dir: string, _opts: unknown, listener: typeof watchListener) => {
  watchListener = listener
  return { on: jest.fn(), close: jest.fn() }
}
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watch: jest.fn(),
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
  await jest.advanceTimersByTimeAsync(800)
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  delete process.env.QUILLTAP_WATCHER_POLLING
  mockWatch.mockImplementation(watchImpl)
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
  mockScan.mockResolvedValue([])
  startWatcher()
})

afterEach(async () => {
  await stopWatcher()
  jest.useRealTimers()
})

describe('files watcher domain', () => {
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
    // A folder has no file record of its own; what lies beneath it does.
    filesRepo.findByStorageKey.mockImplementation(async (key: string) =>
      key === 'proj/Lore' ? null : { id: key, storageKey: key })
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

describe('what the files watcher gained from the shared core', () => {
  it('a plain file delete does not read every record', async () => {
    mockLstat.mockRejectedValue(enoent)
    filesRepo.findByStorageKey.mockResolvedValue({ id: 'f1', storageKey: 'proj/a.png' })

    await fire('rename', 'proj/a.png')

    expect(filesRepo.findByUserId).not.toHaveBeenCalled()
  })

  it('falls back to polling when recursive watch is unavailable', async () => {
    await stopWatcher()
    mockWatch.mockImplementation(() => {
      throw Object.assign(new Error('unsupported'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' })
    })
    mockScan.mockResolvedValueOnce([
      { relativePath: 'proj/a.png', isDirectory: false, size: 10, mtime: new Date(1) },
    ])
    startWatcher()
    await jest.advanceTimersByTimeAsync(0)
    expect(mockScan).toHaveBeenCalledWith('/mock/files')

    // A file arrives between walks.
    mockScan.mockResolvedValue([
      { relativePath: 'proj/a.png', isDirectory: false, size: 10, mtime: new Date(1) },
      { relativePath: 'proj/b.png', isDirectory: false, size: 10, mtime: new Date(1) },
    ])
    mockLstat.mockResolvedValue(fileStat)
    await jest.advanceTimersByTimeAsync(2000 + 800)
    for (let i = 0; i < 40; i++) await Promise.resolve()

    expect(filesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ storageKey: 'proj/b.png' }))
    expect(filesRepo.create).toHaveBeenCalledTimes(1)
  })

  describe('on a platform with cloud placeholders', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    beforeEach(() => Object.defineProperty(process, 'platform', { value: 'darwin' }))
    afterEach(() => Object.defineProperty(process, 'platform', platform))

    it('does not hash an evicted placeholder', async () => {
      mockLstat.mockResolvedValue({ ...fileStat, size: 4096, blocks: 0 })
      mockStat.mockResolvedValue({ size: 4096, blocks: 0 })

      await fire('change', 'proj/evicted.png')

      expect(mockSha).not.toHaveBeenCalled()
      expect(filesRepo.create).not.toHaveBeenCalled()
    })

    it('does not hash an evicted placeholder inside a folder that arrived', async () => {
      mockLstat.mockResolvedValue(dirStat)
      mockScan.mockResolvedValue([{ relativePath: 'proj/Imported/evicted.png', isDirectory: false }])
      mockStat.mockResolvedValue({ size: 4096, blocks: 0 })

      await fire('rename', 'proj/Imported')

      expect(mockSha).not.toHaveBeenCalled()
      expect(filesRepo.create).not.toHaveBeenCalled()
    })
  })
})

describe('stopping', () => {
  it('flushes deferred deletes by default', async () => {
    mockLstat.mockRejectedValue(enoent)
    filesRepo.findByStorageKey.mockResolvedValue({ id: 'f1', storageKey: 'proj/a.png' })
    await fire('rename', 'proj/a.png')

    await stopWatcher()

    expect(filesRepo.delete).toHaveBeenCalledWith('f1')
  })

  it('leaves deferred deletes to reconciliation when told not to flush', async () => {
    mockLstat.mockRejectedValue(enoent)
    filesRepo.findByStorageKey.mockResolvedValue({ id: 'f1', storageKey: 'proj/a.png' })
    await fire('rename', 'proj/a.png')

    await stopWatcher({ flushPendingDeletes: false })
    await jest.advanceTimersByTimeAsync(5000)

    expect(filesRepo.delete).not.toHaveBeenCalled()
  })
})
