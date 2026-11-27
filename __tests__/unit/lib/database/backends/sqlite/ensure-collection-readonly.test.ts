/**
 * `ensureCollection` on the job child's read-only connection.
 *
 * Fresh-instance dogfood (4.14.1): the first chat's CONVERSATION_RENDER job
 * ran in the forked child before the parent had touched `conversation_chunks`.
 * The repository's first access runs the schema's idempotent DDL, and one of
 * its indexes (`idx_conversation_chunks_createdAt`) is not made by any
 * migration, so the child tried to create it and failed with "attempt to write
 * a readonly database". The throw also skipped the JSON / array / boolean
 * column registration, leaving the child's later reads of that collection
 * misparsed. A read-only connection now skips the DDL (the parent owns it) and
 * still registers the columns.
 *
 * @jest-environment node
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod'
import { SQLiteBackend } from '@/lib/database/backends/sqlite/backend'
import { generateDDL } from '@/lib/database/schema-translator'

// Real binding by absolute root path — a bare or nested require resolves to
// the jest mock, which returns empty result sets.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const ThingSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  createdAt: z.string(),
})

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-ensure-ro-'))
  file = path.join(dir, 'test.db')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function backendOn(db: unknown): SQLiteBackend {
  const backend = new SQLiteBackend({ path: file } as never)
  Object.assign(backend as unknown as Record<string, unknown>, { db, _state: 'connected' })
  return backend
}

/** The table as a migration would leave it: no schema-generated indexes. */
function seedBareTable() {
  const rw = new Database(file)
  rw.exec('CREATE TABLE "things" ("id" TEXT PRIMARY KEY, "chatId" TEXT, "tags" TEXT, "pinned" INTEGER, "createdAt" TEXT)')
  rw.prepare('INSERT INTO "things" VALUES (?, ?, ?, ?, ?)').run('t1', 'c1', '["a","b"]', 1, '2026-11-26T00:00:00.000Z')
  rw.close()
}

describe('SQLiteBackend.ensureCollection on a read-only connection', () => {
  it('needs DDL the read-only connection cannot run (the precondition)', () => {
    seedBareTable()
    const ro = new Database(file, { readonly: true })
    const statements = generateDDL('things', ThingSchema)
    expect(() => statements.forEach((sql) => ro.exec(sql))).toThrow(/readonly/)
    ro.close()
  })

  it('skips the DDL, does not throw, and still registers the columns', async () => {
    seedBareTable()
    const ro = new Database(file, { readonly: true })
    const backend = backendOn(ro)

    await expect(backend.ensureCollection('things', ThingSchema)).resolves.toBeUndefined()

    const row = (await backend.getCollection<z.infer<typeof ThingSchema>>('things').findOne({ id: 't1' })) as
      | z.infer<typeof ThingSchema>
      | null
    expect(row?.tags).toEqual(['a', 'b'])
    expect(row?.pinned).toBe(true)
    ro.close()
  })

  it('still runs the DDL on a writable connection', async () => {
    seedBareTable()
    const rw = new Database(file)
    const backend = backendOn(rw)

    await backend.ensureCollection('things', ThingSchema)

    const indexes = rw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'things' AND sql IS NOT NULL`).all()
    const expected = generateDDL('things', ThingSchema).filter((s) => /INDEX/.test(s)).length
    expect(indexes).toHaveLength(expected)
    rw.close()
  })
})
