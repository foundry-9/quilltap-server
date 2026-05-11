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
})
