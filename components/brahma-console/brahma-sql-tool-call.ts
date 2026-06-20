/**
 * Pure parsing/formatting helpers for the Brahma Console's run_sql tool cards.
 *
 * Kept React-free (no JSX, no component imports) so the parsing — the most
 * failure-prone part of surfacing a tool call — can be unit-tested in isolation.
 * The rendering component ({@link BrahmaToolCall}) imports these.
 */

/** Normalized view of a `run_sql` call, independent of its source (persisted vs streamed). */
export interface BrahmaSqlToolCallData {
  /** False for rejected/failed queries. */
  success: boolean
  /** The SQL the engine ran (null only if the arguments were malformed). */
  sql: string | null
  /** Target database: main / llm-logs / mount-index. */
  database: string
  /** Result envelope on success — columns + rows + counts. */
  envelope: {
    columns?: string[]
    rows?: Array<Record<string, unknown>>
    rowCount?: number
    truncated?: boolean
  } | null
  /** Error text when the query failed (settled transcript only). */
  errorText: string | null
  /** True while the query is still executing (live stream). */
  pending?: boolean
}

/**
 * Parse a persisted TOOL message's `content` JSON into normalized `run_sql`
 * data. Returns null for any other tool, so the caller leaves those hidden.
 *
 * The persisted envelope (see `saveToolMessages`) is:
 *   { toolName, success, result, arguments: { sql, database, max_rows }, ... }
 * where `result` is the stringified RunSqlOutput on success, or an "Error: …"
 * string on failure.
 */
export function parseBrahmaSqlToolMessage(content: string): BrahmaSqlToolCallData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>
  if (obj.toolName !== 'run_sql') return null

  const args = (obj.arguments && typeof obj.arguments === 'object')
    ? (obj.arguments as Record<string, unknown>)
    : {}
  const sql = typeof args.sql === 'string' ? args.sql : null
  const database = typeof args.database === 'string' ? args.database : 'main'
  const success = obj.success === true

  let envelope: BrahmaSqlToolCallData['envelope'] = null
  let errorText: string | null = null

  if (success) {
    try {
      const env = typeof obj.result === 'string' ? JSON.parse(obj.result) : obj.result
      if (env && typeof env === 'object') {
        envelope = env as BrahmaSqlToolCallData['envelope']
      }
    } catch {
      // A success row whose result didn't parse — surface the raw text.
      errorText = typeof obj.result === 'string' ? obj.result : null
    }
  } else {
    errorText = typeof obj.result === 'string' ? obj.result : 'The query failed.'
  }

  return { success, sql, database, envelope, errorText }
}

/** Stringify a cell value for the table, flagging SQL NULLs for dimmed styling. */
export function formatCell(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) return { text: 'NULL', isNull: true }
  if (typeof value === 'object') return { text: JSON.stringify(value), isNull: false }
  return { text: String(value), isNull: false }
}
