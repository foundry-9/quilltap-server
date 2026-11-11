/**
 * @jest-environment node
 */

/**
 * Backup archive limits and containment: listing caps, symlink refusal,
 * archive-relative reads held inside the extract root, and plugin listing.
 * Archives are built with shell `zip`, matching the backup-parser tests.
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

jest.mock('@/lib/logger', () => {
  const l: any = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  l.child = jest.fn(() => l)
  return { logger: l }
})

import {
  inspectBackupArchive,
  verifyExtractedTree,
  readArchiveFile,
  listNpmPluginsInExtractedBackup,
  BackupArchiveRefusedError,
} from '@/lib/backup/restore/archive-guard'
import { getFileFromExtractedBackup, parseBackupZip } from '@/lib/backup/restore/archive'

let work: string

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-archive-guard-'))
})

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true })
})

function makeZip(name: string, build: (dir: string) => void, zipArgs: string[] = ['-r']): string {
  const src = path.join(work, `${name}-src`)
  fs.mkdirSync(src, { recursive: true })
  build(src)
  const zipPath = path.join(work, `${name}.zip`)
  execFileSync('zip', [...zipArgs, zipPath, '.'], { cwd: src, stdio: 'ignore' })
  return zipPath
}

describe('inspectBackupArchive', () => {
  it('accepts an ordinary archive and reports its size', async () => {
    const zipPath = makeZip('ok', (d) => fs.writeFileSync(path.join(d, 'manifest.json'), '{}'))
    const result = await inspectBackupArchive(zipPath)
    expect(result.entryCount).toBeGreaterThanOrEqual(1)
    expect(result.totalUncompressedBytes).toBe(2)
  })

  it('refuses an archive with more entries than the limit', async () => {
    const zipPath = makeZip('many', (d) => {
      for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, `f${i}.txt`), 'x')
    })
    await expect(
      inspectBackupArchive(zipPath, { maxEntries: 3, maxTotalUncompressedBytes: 1e9 })
    ).rejects.toThrow(BackupArchiveRefusedError)
  })

  it('refuses an archive that expands past the size limit', async () => {
    const zipPath = makeZip('big', (d) => fs.writeFileSync(path.join(d, 'big.bin'), Buffer.alloc(4096)))
    await expect(
      inspectBackupArchive(zipPath, { maxEntries: 100, maxTotalUncompressedBytes: 1024 })
    ).rejects.toThrow(/expands past/)
  })

  it('refuses an archive holding a symbolic link entry', async () => {
    const zipPath = makeZip(
      'link',
      (d) => {
        fs.writeFileSync(path.join(d, 'manifest.json'), '{}')
        fs.symlinkSync('/etc/hosts', path.join(d, 'hosts'))
      },
      ['-r', '--symlinks']
    )
    await expect(inspectBackupArchive(zipPath)).rejects.toThrow(/symbolic link/)
  })

  it('parseBackupZip refuses a symlink archive and leaves no temp directory behind', async () => {
    const zipPath = makeZip(
      'link2',
      (d) => {
        fs.writeFileSync(path.join(d, 'manifest.json'), '{}')
        fs.symlinkSync('/etc', path.join(d, 'files'))
      },
      ['-r', '--symlinks']
    )
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('quilltap-restore-')).length
    await expect(parseBackupZip(zipPath)).rejects.toThrow(/symbolic link/)
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('quilltap-restore-')).length
    expect(after).toBeLessThanOrEqual(before)
  })
})

describe('verifyExtractedTree', () => {
  it('refuses a tree containing a symbolic link', async () => {
    const dir = path.join(work, 'tree')
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true })
    fs.symlinkSync('/etc/hosts', path.join(dir, 'files', 'x'))
    await expect(verifyExtractedTree(dir)).rejects.toThrow(/symbolic link/)
  })

  it('refuses a tree larger than the limit', async () => {
    const dir = path.join(work, 'tree2')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'a'), Buffer.alloc(2048))
    await expect(
      verifyExtractedTree(dir, { maxEntries: 10, maxTotalUncompressedBytes: 1024 })
    ).rejects.toThrow(/expands past/)
  })
})

describe('archive-relative reads', () => {
  it('refuses a path that climbs out of the root', async () => {
    const root = path.join(work, 'root')
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(work, 'secret.txt'), 'nope')
    await expect(readArchiveFile(root, '../secret.txt')).rejects.toThrow(/outside its base/)
    await expect(readArchiveFile(root, path.join(work, 'secret.txt'))).rejects.toThrow(/relative/)
  })

  it('refuses a symlink inside the root', async () => {
    const root = path.join(work, 'root2')
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(work, 'secret.txt'), 'nope')
    fs.symlinkSync(path.join(work, 'secret.txt'), path.join(root, 'link'))
    await expect(readArchiveFile(root, 'link')).rejects.toThrow()
  })

  it('getFileFromExtractedBackup returns null for storageKey and legacy paths outside files/', async () => {
    const root = path.join(work, 'backup')
    fs.mkdirSync(path.join(root, 'files'), { recursive: true })
    fs.writeFileSync(path.join(work, 'outside.txt'), 'nope')
    const viaKey = await getFileFromExtractedBackup(
      root,
      { id: 'f1', category: 'IMAGE', originalFilename: 'x', storageKey: '../../outside.txt' } as any,
      3
    )
    expect(viaKey).toBeNull()
    const viaLegacy = await getFileFromExtractedBackup(
      root,
      { id: 'f1', category: '../..', originalFilename: 'x' } as any,
      1
    )
    expect(viaLegacy).toBeNull()
  })

  it('getFileFromExtractedBackup still reads a file inside files/', async () => {
    const root = path.join(work, 'backup2')
    fs.mkdirSync(path.join(root, 'files', 'u'), { recursive: true })
    fs.writeFileSync(path.join(root, 'files', 'u', 'k.bin'), 'hello')
    const bytes = await getFileFromExtractedBackup(
      root,
      { id: 'f1', category: 'IMAGE', originalFilename: 'x', storageKey: 'u/k.bin' } as any,
      3
    )
    expect(bytes?.toString()).toBe('hello')
  })
})

describe('listNpmPluginsInExtractedBackup', () => {
  it('lists plugin directory names, un-flattening scoped names', async () => {
    const root = path.join(work, 'plugins-root')
    fs.mkdirSync(path.join(root, 'plugins', 'npm', 'qtap-plugin-b'), { recursive: true })
    fs.mkdirSync(path.join(root, 'plugins', 'npm', '@org--qtap-plugin-a'), { recursive: true })
    expect(await listNpmPluginsInExtractedBackup(root)).toEqual(['@org/qtap-plugin-a', 'qtap-plugin-b'])
  })

  it('returns an empty list when the backup holds no plugins', async () => {
    expect(await listNpmPluginsInExtractedBackup(work)).toEqual([])
  })
})
