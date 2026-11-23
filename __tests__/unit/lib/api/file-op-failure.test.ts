/**
 * @jest-environment node
 *
 * `fileOpFailure` is the one HTTP answer for a failed document-store file
 * operation: a `FileOpError` / `DatabaseStoreError` keeps its message and code
 * under the mapped status; anything else is logged and answered with a 500
 * that says nothing about the fault. A grep holds the mount-point routes to it.
 */

jest.mock('@/lib/logger', () => {
  const mock: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  mock.child = jest.fn(() => mock)
  return { logger: mock }
})

jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message)
      this.name = 'DatabaseStoreError'
    }
  }
  return { DatabaseStoreError }
})

import fs from 'fs'
import path from 'path'
import { fileOpFailure } from '@/lib/api/file-op-failure'
import { FileOpError } from '@/lib/mount-index/file-op-error'
import { DatabaseStoreError } from '@/lib/mount-index/database-store'
import { logger } from '@/lib/logger'

const ROOT = path.resolve(__dirname, '../../../..')

describe('fileOpFailure', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['SOURCE_NOT_FOUND', 404],
    ['MOUNT_NOT_FOUND', 404],
    ['DEST_EXISTS', 409],
    ['CONFLICT', 409],
    ['INVALID_PATH', 400],
    ['UNSUPPORTED', 400],
    ['VERIFY_FAILED', 500],
  ] as const)('answers a FileOpError %s with %i and its code', async (code, status) => {
    const res = fileOpFailure(new FileOpError('no', code), 'move file', { mountPointId: 'm1' })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'no', code })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it.each([
    ['NOT_FOUND', 404],
    ['NOT_EMPTY', 409],
    ['INVALID', 400],
  ] as const)('answers a DatabaseStoreError %s with %i and its code', async (code, status) => {
    const res = fileOpFailure(new DatabaseStoreError('no', code), 'delete folder', { mountPointId: 'm1' })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'no', code })
  })

  it('logs anything else and answers 500 without the fault text', async () => {
    const fault = new Error('disk on fire at /secret/path')
    const res = fileOpFailure(fault, 'write file', { mountPointId: 'm1' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('write file'),
      { mountPointId: 'm1' },
      fault
    )
  })

  it('is the only place a mount-point route maps a file-op error', () => {
    const dir = path.join(ROOT, 'app/api/v1/mount-points')
    const routes = (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((rel) => rel.endsWith('route.ts'))
    expect(routes.length).toBeGreaterThan(3)
    for (const rel of routes) {
      const src = fs.readFileSync(path.join(dir, rel), 'utf-8')
      expect({ rel, handRolled: /fileOpStatus\(/.test(src) }).toEqual({ rel, handRolled: false })
    }
  })
})
