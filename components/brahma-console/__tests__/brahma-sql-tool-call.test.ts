/**
 * Unit tests for the Brahma Console run_sql tool-card parser/formatter. These
 * lock the shape produced by `saveToolMessages` (the persisted TOOL message
 * envelope) so the console renders queries and results faithfully.
 */

import {
  parseBrahmaSqlToolMessage,
  formatCell,
} from '../brahma-sql-tool-call'

/** Build a persisted TOOL-message content string the way `saveToolMessages` does. */
function persistedToolContent(args: {
  toolName?: string
  success: boolean
  result: unknown
  arguments?: Record<string, unknown>
}): string {
  return JSON.stringify({
    toolName: args.toolName ?? 'run_sql',
    success: args.success,
    // `result` is stored as a string (stringified envelope on success, or an
    // "Error: …" string on failure).
    result: typeof args.result === 'string' ? args.result : JSON.stringify(args.result, null, 2),
    arguments: args.arguments ?? {},
    callId: 'call_1',
  })
}

describe('parseBrahmaSqlToolMessage', () => {
  it('parses a successful query into sql + envelope', () => {
    const envelope = {
      success: true,
      database: 'main',
      columns: ['id', 'name'],
      rows: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
      rowCount: 2,
      truncated: false,
    }
    const content = persistedToolContent({
      success: true,
      result: envelope,
      arguments: { sql: 'SELECT id, name FROM characters', database: 'main' },
    })

    const data = parseBrahmaSqlToolMessage(content)

    expect(data).not.toBeNull()
    expect(data!.success).toBe(true)
    expect(data!.sql).toBe('SELECT id, name FROM characters')
    expect(data!.database).toBe('main')
    expect(data!.errorText).toBeNull()
    expect(data!.envelope?.columns).toEqual(['id', 'name'])
    expect(data!.envelope?.rows).toHaveLength(2)
    expect(data!.envelope?.rowCount).toBe(2)
    expect(data!.envelope?.truncated).toBe(false)
  })

  it('defaults the database to "main" when the argument is absent', () => {
    const content = persistedToolContent({
      success: true,
      result: { success: true, columns: [], rows: [], rowCount: 0, truncated: false },
      arguments: { sql: 'SELECT 1' },
    })

    const data = parseBrahmaSqlToolMessage(content)
    expect(data!.database).toBe('main')
  })

  it('threads the chosen database through', () => {
    const content = persistedToolContent({
      success: true,
      result: { success: true, columns: ['n'], rows: [{ n: 5 }], rowCount: 1, truncated: false },
      arguments: { sql: 'SELECT count(*) AS n FROM llm_logs', database: 'llm-logs' },
    })

    const data = parseBrahmaSqlToolMessage(content)
    expect(data!.database).toBe('llm-logs')
  })

  it('surfaces the error text on a failed query', () => {
    const content = persistedToolContent({
      success: false,
      result: 'Error: Only read-only queries are permitted.',
      arguments: { sql: 'DELETE FROM characters', database: 'main' },
    })

    const data = parseBrahmaSqlToolMessage(content)
    expect(data!.success).toBe(false)
    expect(data!.envelope).toBeNull()
    expect(data!.errorText).toBe('Error: Only read-only queries are permitted.')
    expect(data!.sql).toBe('DELETE FROM characters')
  })

  it('returns null for a non-run_sql tool message', () => {
    const content = JSON.stringify({
      toolName: 'search',
      success: true,
      result: '[]',
      arguments: { query: 'hello' },
    })
    expect(parseBrahmaSqlToolMessage(content)).toBeNull()
  })

  it('returns null for non-JSON content', () => {
    expect(parseBrahmaSqlToolMessage('not json at all')).toBeNull()
  })

  it('tolerates missing sql arguments', () => {
    const content = persistedToolContent({
      success: true,
      result: { success: true, columns: [], rows: [], rowCount: 0, truncated: false },
      arguments: {},
    })
    const data = parseBrahmaSqlToolMessage(content)
    expect(data).not.toBeNull()
    expect(data!.sql).toBeNull()
  })
})

describe('formatCell', () => {
  it('renders NULL for null/undefined and flags it', () => {
    expect(formatCell(null)).toEqual({ text: 'NULL', isNull: true })
    expect(formatCell(undefined)).toEqual({ text: 'NULL', isNull: true })
  })

  it('stringifies objects', () => {
    expect(formatCell({ a: 1 })).toEqual({ text: '{"a":1}', isNull: false })
  })

  it('stringifies primitives', () => {
    expect(formatCell(42)).toEqual({ text: '42', isNull: false })
    expect(formatCell('hi')).toEqual({ text: 'hi', isNull: false })
    expect(formatCell(false)).toEqual({ text: 'false', isNull: false })
  })
})
