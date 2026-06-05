import { beforeEach, describe, expect, it, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/database/manager', () => ({
  getDatabaseAsync: jest.fn(),
}))

jest.mock('@/lib/database/backends/sqlite/backend', () => ({
  SQLiteBackend: class MockSQLiteBackend {
    db?: unknown
  },
}))

const { getDatabaseAsync } = jest.requireMock('@/lib/database/manager') as {
  getDatabaseAsync: jest.Mock
}
const { SQLiteBackend } = jest.requireMock('@/lib/database/backends/sqlite/backend') as {
  SQLiteBackend: new () => { db?: unknown }
}
const mockGetDatabaseAsync = getDatabaseAsync

describe('repairTextEmbeddings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns early when the active backend is not SQLite', async () => {
    mockGetDatabaseAsync.mockResolvedValue({} as any)

    const { repairTextEmbeddings } = await import('@/lib/startup/repair-text-embeddings')
    const result = await repairTextEmbeddings()

    expect(result.vectorEntriesRepaired).toBe(0)
    expect(result.memoriesRepaired).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('repairs JSON text embeddings in both vector_entries and memories tables', async () => {
    // The mock simulates the production WHERE filter:
    // once a row is updated (BLOB or NULL), the next page-select drops it.
    const vectorTable = new Map<string, string | Buffer | null>([
      ['vec-1', '[1, 2, 3]'],
      ['vec-bad', 'not-json'],
    ])
    const memoryTable = new Map<string, string | Buffer | null>([
      ['mem-1', '[4, 5]'],
      ['mem-empty', '[]'],
      ['mem-bad', '{oops'],
    ])

    const updateVectorRun = jest.fn((value: Buffer | null, id: string) => {
      vectorTable.set(id, value)
    })
    const updateMemoryRun = jest.fn((value: Buffer | null, id: string) => {
      memoryTable.set(id, value)
    })

    const textRowsFrom = (table: Map<string, string | Buffer | null>) =>
      [...table.entries()]
        .filter(([, v]) => typeof v === 'string')
        .map(([id, embedding]) => ({ id, embedding: embedding as string }))

    const db = {
      prepare: jest.fn((sql: string) => {
        if (sql.includes("sqlite_master")) {
          return {
            get: (tableName: string) => ({
              count: ['vector_entries', 'memories'].includes(tableName) ? 1 : 0,
            }),
          }
        }

        if (sql.includes("COUNT(*) as count FROM vector_entries")) {
          return { get: () => ({ count: textRowsFrom(vectorTable).length }) }
        }
        if (sql.includes("SELECT id, embedding FROM vector_entries")) {
          return { all: () => textRowsFrom(vectorTable) }
        }
        if (sql.includes("UPDATE vector_entries SET embedding = NULL")) {
          return { run: (id: string) => vectorTable.set(id, null) }
        }
        if (sql.includes("UPDATE vector_entries SET embedding = ?")) {
          return { run: updateVectorRun }
        }

        if (sql.includes("COUNT(*) as count FROM memories")) {
          return { get: () => ({ count: textRowsFrom(memoryTable).length }) }
        }
        if (sql.includes("SELECT id, embedding FROM memories")) {
          return { all: () => textRowsFrom(memoryTable) }
        }
        if (sql.includes("UPDATE memories SET embedding = NULL")) {
          return { run: (id: string) => memoryTable.set(id, null) }
        }
        if (sql.includes("UPDATE memories SET embedding = ? WHERE id = ?")) {
          return { run: updateMemoryRun }
        }

        throw new Error(`Unexpected SQL in test: ${sql}`)
      }),
      transaction: jest.fn((fn: (rows: unknown[]) => void) => (rows: unknown[]) => fn(rows)),
    }

    const backend = new (SQLiteBackend as any)()
    backend.db = db
    mockGetDatabaseAsync.mockResolvedValue(backend)

    const { repairTextEmbeddings } = await import('@/lib/startup/repair-text-embeddings')
    const result = await repairTextEmbeddings()

    expect(result).toMatchObject({
      vectorEntriesRepaired: 1,
      memoriesRepaired: 2,
    })

    const repairedVectorBlob = updateVectorRun.mock.calls[0]?.[0] as Uint8Array
    const repairedMemoryBlob = updateMemoryRun.mock.calls[0]?.[0] as Uint8Array

    expect(repairedVectorBlob.byteLength).toBeGreaterThan(0)
    expect(updateVectorRun.mock.calls[0]?.[1]).toBe('vec-1')
    expect(repairedMemoryBlob.byteLength).toBeGreaterThan(0)
    expect(updateMemoryRun.mock.calls[0]?.[1]).toBe('mem-1')
    expect(updateMemoryRun).toHaveBeenCalledWith(null, 'mem-empty')
  })

  it('repairs help_docs embeddings stored in the index-keyed object shape', async () => {
    // The legacy hot-reload bug wrote some embeddings via JSON.stringify(Float32Array),
    // producing {"0":..,"1":..} rather than an array. The old repair could not parse
    // these and nulled them (data loss); they must now convert to BLOB.
    const objectShape = JSON.stringify(new Float32Array([0.1, 0.2, 0.3, 0.4]))
    expect(objectShape.startsWith('{')).toBe(true)

    const helpTable = new Map<string, string | Buffer | null>([
      ['doc-array', '[0.5, 0.6]'],
      ['doc-object', objectShape],
    ])

    const updateHelpRun = jest.fn((value: Buffer | null, id: string) => {
      helpTable.set(id, value)
    })
    const nullifyHelpRun = jest.fn((id: string) => helpTable.set(id, null))

    const textRowsFrom = (table: Map<string, string | Buffer | null>) =>
      [...table.entries()]
        .filter(([, v]) => typeof v === 'string')
        .map(([id, embedding]) => ({ id, embedding: embedding as string }))

    const db = {
      prepare: jest.fn((sql: string) => {
        if (sql.includes('sqlite_master')) {
          return { get: (tableName: string) => ({ count: tableName === 'help_docs' ? 1 : 0 }) }
        }
        if (sql.includes('COUNT(*) as count FROM help_docs')) {
          return { get: () => ({ count: textRowsFrom(helpTable).length }) }
        }
        if (sql.includes('SELECT id, embedding FROM help_docs')) {
          return { all: () => textRowsFrom(helpTable) }
        }
        if (sql.includes('UPDATE help_docs SET embedding = NULL')) {
          return { run: nullifyHelpRun }
        }
        if (sql.includes('UPDATE help_docs SET embedding = ? WHERE id = ?')) {
          return { run: updateHelpRun }
        }
        throw new Error(`Unexpected SQL in test: ${sql}`)
      }),
      transaction: jest.fn((fn: (rows: unknown[]) => void) => (rows: unknown[]) => fn(rows)),
    }

    const backend = new (SQLiteBackend as any)()
    backend.db = db
    mockGetDatabaseAsync.mockResolvedValue(backend)

    const { repairTextEmbeddings } = await import('@/lib/startup/repair-text-embeddings')
    const result = await repairTextEmbeddings()

    expect(result.helpDocsRepaired).toBe(2)
    // Both rows became BLOBs; neither was nulled.
    expect(nullifyHelpRun).not.toHaveBeenCalled()
    expect(updateHelpRun).toHaveBeenCalledTimes(2)
    const convertedIds = updateHelpRun.mock.calls.map(c => c[1]).sort()
    expect(convertedIds).toEqual(['doc-array', 'doc-object'])
    for (const [blob] of updateHelpRun.mock.calls) {
      expect((blob as Uint8Array).byteLength).toBeGreaterThan(0)
    }
  })
})
