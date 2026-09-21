/**
 * Compressed text columns, end to end through a real SQLite connection.
 *
 * The codec itself is covered in __tests__/unit/lib/database/text-compression.test.ts.
 * What matters here is the PLUMBING: that documentToRow encodes, that the
 * SQLiteCollection hydration decodes, that a column which is both JSON and
 * compressed survives the double transform, and that legacy plaintext rows
 * written before the column was registered still read correctly.
 *
 * @jest-environment node
 */

import path from 'path'
import { documentToRow } from '@/lib/database/backends/sqlite/json-columns'
import { SQLiteCollection } from '@/lib/database/backends/sqlite/backend'
import { registerTextCodecFunction } from '@/lib/database/backends/sqlite/text-codec-function'
import { isCompressedTextBlob, TEXT_COMPRESSION_MIN_BYTES } from '@/lib/database/text-compression'

// Real binding by absolute root path — a bare or nested require resolves to
// the jest mock, which returns empty result sets.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const LONG = 'the same clause, endlessly repeated, for compression. '.repeat(40)
const SHORT = 'brief'

describe('documentToRow with compressedColumns', () => {
  it('encodes a long plain-text column to a BLOB', () => {
    const row = documentToRow({ id: 'a', body: LONG }, [], new Set(), new Set(['body']))
    expect(isCompressedTextBlob(row.body)).toBe(true)
    expect((row.body as Buffer).length).toBeLessThan(Buffer.byteLength(LONG))
  })

  it('leaves a short value as a plain string', () => {
    const row = documentToRow({ id: 'a', body: SHORT }, [], new Set(), new Set(['body']))
    expect(row.body).toBe(SHORT)
  })

  it('serializes a JSON+compressed column to JSON first, then compresses', () => {
    const payload = { messages: [{ role: 'user', content: LONG }], messageCount: 1 }
    const row = documentToRow({ id: 'a', request: payload }, ['request'], new Set(), new Set(['request']))
    expect(isCompressedTextBlob(row.request)).toBe(true)
  })

  it('stores null for a null or undefined value', () => {
    const row = documentToRow({ a: null, b: undefined }, [], new Set(), new Set(['a', 'b']))
    expect(row.a).toBeNull()
    expect(row.b).toBeNull()
  })
})

describe('SQLiteCollection round trip', () => {
  let db: any

  beforeEach(() => {
    db = new Database(':memory:')
    registerTextCodecFunction(db)
    db.exec('CREATE TABLE logs (id TEXT PRIMARY KEY, request TEXT, note TEXT, createdAt TEXT)')
  })

  afterEach(() => db?.close())

  const collection = () =>
    new SQLiteCollection<any>(db, 'logs', ['request'], [], [], [], ['request', 'note'])

  it('round-trips a JSON payload through compression', async () => {
    const payload = { messages: [{ role: 'user', content: LONG }], messageCount: 1 }
    const c = collection()
    await c.insertOne({ id: 'log-1', request: payload, note: LONG, createdAt: 'now' })

    // Stored as a BLOB...
    const raw = db.prepare('SELECT request, note FROM logs WHERE id = ?').get('log-1')
    expect(Buffer.isBuffer(raw.request)).toBe(true)
    expect(isCompressedTextBlob(raw.request)).toBe(true)

    // ...and read back as the original object and string.
    const found = await c.findOne({ id: 'log-1' })
    expect(found.request).toEqual(payload)
    expect(found.note).toBe(LONG)
  })

  it('reads a LEGACY plaintext row written before the column was registered', async () => {
    const payload = { messageCount: 7, messages: [] }
    db.prepare('INSERT INTO logs VALUES (?,?,?,?)').run(
      'legacy-1', JSON.stringify(payload), 'plain note', 'now',
    )
    const found = await collection().findOne({ id: 'legacy-1' })
    expect(found.request).toEqual(payload)
    expect(found.note).toBe('plain note')
  })

  it('updates a compressed column through the update path', async () => {
    const c = collection()
    await c.insertOne({ id: 'log-2', request: { messageCount: 1 }, note: SHORT, createdAt: 'now' })

    const next = { messageCount: 2, messages: [{ role: 'assistant', content: LONG }] }
    await c.updateOne({ id: 'log-2' }, { request: next, note: LONG })

    const raw = db.prepare('SELECT request FROM logs WHERE id = ?').get('log-2')
    expect(isCompressedTextBlob(raw.request)).toBe(true)

    const found = await c.findOne({ id: 'log-2' })
    expect(found.request).toEqual(next)
    expect(found.note).toBe(LONG)
  })

  it('exposes the stored text to raw SQL through qt_text()', async () => {
    const payload = { error: 'boom', contentLength: 5 }
    await collection().insertOne({
      id: 'log-3',
      request: { pad: LONG, ...payload },
      note: null,
      createdAt: 'now',
    })

    const viaUdf = db
      .prepare(`SELECT json_extract(qt_text(request), '$.error') AS e FROM logs WHERE id = ?`)
      .get('log-3')
    expect(viaUdf.e).toBe('boom')

    // And without the UDF the JSON functions cannot read it — the loud
    // failure that keeps a missed raw-SQL site from returning wrong answers.
    expect(() =>
      db.prepare(`SELECT json_extract(request, '$.error') AS e FROM logs WHERE id = ?`).get('log-3'),
    ).toThrow()
  })

  it('refuses a JSON-mutating operator on a compressed column', async () => {
    const c = collection()
    await c.insertOne({ id: 'log-4', request: { a: 1 }, note: SHORT, createdAt: 'now' })
    await expect(
      c.updateOne({ id: 'log-4' }, { $push: { request: 'x' } } as any),
    ).rejects.toThrow(/compressed column/)
  })

  it('serializes for BACKUP as clean JSON, never as a Buffer shape', async () => {
    // Backup reads llm_logs and conversation_chunks through the repository
    // (lib/backup/backup-service.ts), then JSON.stringifies the rows. If
    // hydration ever handed back the raw Buffer, the archive would carry
    // {"type":"Buffer","data":[...]} and restore would write that back as the
    // payload. This is the fidelity property the backup path depends on.
    const payload = { messages: [{ role: 'user', content: LONG }], messageCount: 1 }
    const c = collection()
    await c.insertOne({ id: 'b1', request: payload, note: LONG, createdAt: 'now' })

    const row = await c.findOne({ id: 'b1' })
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('"type":"Buffer"')
    expect(JSON.parse(serialized)).toEqual(
      expect.objectContaining({ id: 'b1', request: payload, note: LONG }),
    )

    // And a restore of that serialized form round-trips back to compressed.
    const restored = JSON.parse(serialized)
    await c.insertOne({ ...restored, id: 'b1-restored' })
    const raw = db.prepare('SELECT request FROM logs WHERE id = ?').get('b1-restored')
    expect(isCompressedTextBlob(raw.request)).toBe(true)
    expect((await c.findOne({ id: 'b1-restored' })).request).toEqual(payload)
  })

  it('keeps values at the size floor readable either way', async () => {
    const atFloor = 'y'.repeat(TEXT_COMPRESSION_MIN_BYTES)
    const belowFloor = 'z'.repeat(TEXT_COMPRESSION_MIN_BYTES - 1)
    const c = collection()
    await c.insertOne({ id: 'f1', request: { x: 1 }, note: atFloor, createdAt: 'now' })
    await c.insertOne({ id: 'f2', request: { x: 1 }, note: belowFloor, createdAt: 'now' })

    expect((await c.findOne({ id: 'f1' })).note).toBe(atFloor)
    expect((await c.findOne({ id: 'f2' })).note).toBe(belowFloor)
    expect(typeof db.prepare('SELECT note FROM logs WHERE id = ?').get('f2').note).toBe('string')
  })
})
