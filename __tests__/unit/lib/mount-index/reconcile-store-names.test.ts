/**
 * @jest-environment node
 *
 * reconcileStoreNames applies the naming plan to the mount-index database in
 * one transaction, under the unique name index — including a swap of names
 * between two stores, which a one-pass rename would trip over (bug 186).
 */

import path from 'path'

jest.mock('@/lib/logger', () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  l.child.mockReturnValue(l)
  return { logger: l }
})
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(),
  isMountIndexDegraded: jest.fn(() => false),
}))

import { reconcileStoreNames } from '@/lib/mount-index/reconcile-store-names'
import { ensureMountPointNameUniqueIndex } from '@/lib/database/repositories/mount-index-case-repair'

const { getRepositories } = jest.requireMock('@/lib/repositories/factory')
const { getRawMountIndexDatabase } = jest.requireMock('@/lib/database/backends/sqlite/mount-index-client')
const { publishRealtime } = jest.requireMock('@/lib/realtime/bus')

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

let db: any
let characters: Array<{ id: string; name: string; characterDocumentMountPointId: string | null; createdAt: string }>

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.QUILLTAP_JOB_CHILD
  db = new Database(':memory:')
  db.exec(`CREATE TABLE doc_mount_points (id TEXT PRIMARY KEY, name TEXT NOT NULL, storeType TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`)
  ensureMountPointNameUniqueIndex(db)
  characters = []
  getRawMountIndexDatabase.mockReturnValue(db)
  getRepositories.mockReturnValue({
    docMountPoints: { findAll: async () => db.prepare('SELECT * FROM doc_mount_points').all() },
    characters: { findAllRaw: async () => characters },
  })
})
afterEach(() => db.close())

const insert = (id: string, name: string, createdAt: string) =>
  db.prepare(`INSERT INTO doc_mount_points VALUES (?, ?, 'character', ?, ?)`).run(id, name, createdAt, createdAt)
const names = () =>
  Object.fromEntries(db.prepare('SELECT id, name FROM doc_mount_points').all().map((r: any) => [r.id, r.name]))

it('swaps the plain name from an orphan to the live vault without tripping the index', async () => {
  insert('orphan', 'Tester Character Vault', '2026-09-01T10:00:00.000Z')
  insert('live', 'Tester Character Vault (2)', '2026-10-01T10:00:00.000Z')
  characters = [{ id: 't', name: 'Tester', characterDocumentMountPointId: 'live', createdAt: '2026-01-01T00:00:00.000Z' }]

  const result = await reconcileStoreNames('test')

  expect(result.renamed).toHaveLength(2)
  expect(names()).toEqual({ orphan: 'Tester Version 2026-09-01T100000Z Store', live: 'Tester Character Vault' })
  expect(publishRealtime).toHaveBeenCalledWith('mountPoints')
  expect((await reconcileStoreNames('again')).renamed).toEqual([])
})

it('does nothing in the job child', async () => {
  insert('orphan', 'Tester Character Vault', '2026-09-01T10:00:00.000Z')
  process.env.QUILLTAP_JOB_CHILD = '1'
  expect(await reconcileStoreNames('test')).toEqual({ renamed: [], skippedReason: 'job-child' })
  expect(names().orphan).toBe('Tester Character Vault')
})
