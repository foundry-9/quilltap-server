/**
 * The one-time vault wardrobe refresh on a database born after the cutover.
 *
 * Fresh-instance dogfood (4.14.1): the first-startup seed imports Lorian's and
 * Riya's wardrobes into their vaults, and then this task — never yet run on the
 * new database — projected the empty legacy `wardrobe_items` table over every
 * vault, deleting them. Every sample character opened its first chat with no
 * clothes. With no legacy rows at all, the refresh now marks itself done and
 * leaves the vaults alone; with rows, it projects them as before.
 *
 * @jest-environment node
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

let db: any
jest.mock('@/lib/database/backends/sqlite/client', () => ({ getRawDatabase: () => db }))
jest.mock('@/lib/wardrobe/vault-sync', () => ({ projectVaultWardrobe: jest.fn(async () => undefined) }))
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    characters: {
      findAllRaw: async () => [{ id: 'lorian', characterDocumentMountPointId: 'vault-lorian' }],
    },
  }),
}))

import { refreshVaultWardrobe } from '@/lib/startup/refresh-vault-wardrobe'
import { projectVaultWardrobe } from '@/lib/wardrobe/vault-sync'

let dir: string

beforeEach(() => {
  jest.clearAllMocks()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-wardrobe-refresh-'))
  db = new Database(path.join(dir, 'main.db'))
  db.exec(`CREATE TABLE "instance_settings" ("key" TEXT PRIMARY KEY, "value" TEXT)`)
  db.exec(`CREATE TABLE "wardrobe_items" (
    "id" TEXT PRIMARY KEY, "characterId" TEXT, "title" TEXT, "description" TEXT, "types" TEXT,
    "componentItemIds" TEXT, "appropriateness" TEXT, "isDefault" INTEGER,
    "migratedFromClothingRecordId" TEXT, "archivedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT)`)
})

afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const flag = () =>
  (db.prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = 'wardrobe_folder_migrated_v1'`).get() as
    | { value: string }
    | undefined)?.value

describe('refreshVaultWardrobe', () => {
  it('leaves the vaults alone and marks itself done when the legacy table is empty', async () => {
    const result = await refreshVaultWardrobe()
    expect(projectVaultWardrobe).not.toHaveBeenCalled()
    expect(result.refreshed).toBe(0)
    expect(flag()).toBe('true')
  })

  it('still projects legacy rows on an upgraded database', async () => {
    db.prepare(`INSERT INTO "wardrobe_items" VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'w1', 'lorian', 'Pale linen shirt', null, '["top"]', '[]', null, 1, null, null,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    )
    const result = await refreshVaultWardrobe()
    expect(projectVaultWardrobe).toHaveBeenCalledWith(
      'vault-lorian',
      'lorian',
      [expect.objectContaining({ id: 'w1', title: 'Pale linen shirt', isDefault: true })],
    )
    expect(result.refreshed).toBe(1)
    expect(flag()).toBe('true')
  })

  it('does nothing once it has run', async () => {
    db.prepare(`INSERT INTO "instance_settings" VALUES ('wardrobe_folder_migrated_v1', 'true')`).run()
    const result = await refreshVaultWardrobe()
    expect(result.alreadyDone).toBe(true)
    expect(projectVaultWardrobe).not.toHaveBeenCalled()
  })
})
