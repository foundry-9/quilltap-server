/**
 * `LLMLogsRepository.findRecentNativeToolSamples` against a real SQLite
 * connection with compressed `request` / `response` columns: only the given
 * profiles' rows, only requests that sent native tools, newest first, and the
 * response fields observed tool reliability reads.
 *
 * @jest-environment node
 */

import path from 'path'
import { registerTextCodecFunction } from '@/lib/database/backends/sqlite/text-codec-function'
import { textToBlob } from '@/lib/database/text-compression'

// Real binding by absolute root path — a bare or nested require resolves to
// the jest mock, which returns empty result sets.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

jest.mock('@/lib/logger', () => {
  const quiet = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })
  return { logger: { ...quiet(), child: jest.fn(quiet) } }
})

let db: any
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  getRawLLMLogsDatabase: () => db,
  isLLMLogsDegraded: () => false,
}))

import { LLMLogsRepository } from '@/lib/database/repositories/llm-logs.repository'

const PADDING = 'A long system prompt, repeated so the column compresses. '.repeat(30)

function insert(id: string, profileId: string, createdAt: string, toolCount: number, response: Record<string, unknown>) {
  db.prepare('INSERT INTO llm_logs (id, connectionProfileId, request, response, createdAt) VALUES (?, ?, ?, ?, ?)').run(
    id,
    profileId,
    textToBlob(JSON.stringify({ messageCount: 1, messages: [{ role: 'system', content: PADDING }], toolCount })),
    textToBlob(JSON.stringify({ content: PADDING, contentLength: PADDING.length, ...response })),
    createdAt,
  )
}

beforeEach(() => {
  db = new Database(':memory:')
  registerTextCodecFunction(db)
  db.exec('CREATE TABLE llm_logs (id TEXT PRIMARY KEY, connectionProfileId TEXT, request BLOB, response BLOB, createdAt TEXT)')
})

afterEach(() => db?.close())

describe('findRecentNativeToolSamples', () => {
  it("reads the given profiles' native-tool requests, newest first, with their outcome fields", async () => {
    insert('old', 'p-1', '2026-11-01T00:00:00Z', 8, { finishReason: 'tool_calls' })
    insert('text-mode', 'p-1', '2026-11-02T00:00:00Z', 0, { finishReason: 'stop' })
    insert('new', 'p-2', '2026-11-03T00:00:00Z', 8, { finishReason: 'MALFORMED_FUNCTION_CALL', toolCalls: [] })
    insert('called', 'p-1', '2026-11-04T00:00:00Z', 8, { finishReason: 'STOP', toolCalls: [{ name: 'search', arguments: {} }] })
    insert('elsewhere', 'p-9', '2026-11-05T00:00:00Z', 8, { finishReason: 'tool_calls' })

    const rows = await new LLMLogsRepository().findRecentNativeToolSamples(['p-1', 'p-2'], 50)

    expect(rows.map(r => r.finishReason)).toEqual(['STOP', 'MALFORMED_FUNCTION_CALL', 'tool_calls'])
    expect(rows[0].toolCalls).toEqual([{ name: 'search', arguments: {} }])
    expect(rows[1].toolCalls).toEqual([])
    expect(rows[2].toolCalls).toBeUndefined()
    expect(rows[0]).toMatchObject({ toolCount: 8, error: null, content: PADDING })
  })

  it('honours the limit', async () => {
    for (let i = 0; i < 5; i++) insert(`r${i}`, 'p-1', `2026-11-0${i + 1}T00:00:00Z`, 3, { finishReason: 'stop' })

    const rows = await new LLMLogsRepository().findRecentNativeToolSamples(['p-1'], 2)
    expect(rows).toHaveLength(2)
  })

  it('reads nothing for no profiles', async () => {
    expect(await new LLMLogsRepository().findRecentNativeToolSamples([], 50)).toEqual([])
  })
})
