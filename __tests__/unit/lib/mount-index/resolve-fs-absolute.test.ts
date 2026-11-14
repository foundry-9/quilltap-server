/**
 * @jest-environment node
 *
 * `resolveFsAbsolute` places a relative path inside a filesystem mount and
 * refuses one whose real location — after symlinks — is outside the mount,
 * including a not-yet-existing file under a linked directory.
 */

jest.mock('@/lib/logger', () => {
  const mock: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  mock.child = jest.fn(() => mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/mount-index/scanner', () => ({ processMountFile: jest.fn() }))
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({ getRawMountIndexDatabase: jest.fn() }))
jest.mock('@/lib/mount-index/realtime', () => ({ publishMountChange: jest.fn() }))
jest.mock('@/lib/mount-index/post-write-reindex', () => ({ reindexAfterDatabaseWrite: jest.fn() }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveFsAbsolute } from '@/lib/mount-index/file-ops'
import type { DocMountPoint } from '@/lib/schemas/mount-index.types'

let root: string
let mount: DocMountPoint

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-mount-')))
  const base = path.join(root, 'store')
  fs.mkdirSync(path.join(base, 'notes'), { recursive: true })
  fs.mkdirSync(path.join(root, 'elsewhere'))
  fs.writeFileSync(path.join(root, 'elsewhere', 'secret.md'), 'x')
  fs.symlinkSync(path.join(root, 'elsewhere'), path.join(base, 'linked'))
  fs.symlinkSync(path.join(base, 'notes'), path.join(base, 'notes-alias'))
  mount = { id: 'mp-1', mountType: 'filesystem', basePath: base } as unknown as DocMountPoint
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveFsAbsolute', () => {
  it('resolves an ordinary path and keeps the mount spelling', () => {
    expect(resolveFsAbsolute(mount, 'notes/a.md')).toBe(path.join(mount.basePath!, 'notes', 'a.md'))
    expect(resolveFsAbsolute(mount, 'notes-alias/a.md')).toBe(path.join(mount.basePath!, 'notes-alias', 'a.md'))
  })

  it('refuses traversal', () => {
    expect(() => resolveFsAbsolute(mount, '../elsewhere/secret.md')).toThrow(/escapes mount boundary/)
  })

  it('refuses a symlink that leads out of the mount, for existing and new files', () => {
    expect(() => resolveFsAbsolute(mount, 'linked/secret.md')).toThrow(/escapes mount boundary/)
    expect(() => resolveFsAbsolute(mount, 'linked/new-file.md')).toThrow(/escapes mount boundary/)
  })
})
