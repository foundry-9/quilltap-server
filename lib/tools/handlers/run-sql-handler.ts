/**
 * Run SQL Tool Handler (Brahma Console — read-only SQL access)
 *
 * Executes a single read-only SQL query against one of the three Quilltap
 * databases (main / llm-logs / mount-index) and shapes the rows into a small
 * JSON envelope the model can read.
 *
 * This is the load-bearing safety surface. The server holds all three
 * databases open with **read-write** handles, so read-only is guaranteed here,
 * by defense in depth (any one layer failing closed is enough):
 *
 *   1. A single-statement + write-keyword pre-scan (literals/comments stripped
 *      first so semicolons and keywords inside strings don't trip it).
 *   2. The authoritative `better-sqlite3` `stmt.readonly` check — fail closed
 *      if it is anything but exactly `true`.
 *   3. A `max_rows` cap on materialized results.
 *
 * Errors are returned as data (`{ success: false, error }`), never thrown, so
 * the model can read the message and self-correct via trial and error.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '@/lib/logger';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { runSqlToolInputSchema, type RunSqlOutput } from '../run-sql-tool';

// Deliberately no "Oracle" in the logger context — see the spec naming note.
const sqlLogger = logger.child({ context: 'BrahmaSql' });

/**
 * Context required for run_sql execution. The databases are per-instance
 * (single-user), so `userId` is carried for logging/attribution only — it does
 * not affect which database is reached.
 */
export interface RunSqlToolContext {
  userId: string;
}

/** Discriminated result: success carries the envelope, failure carries a message. */
export type RunSqlResult =
  | ({ success: true } & RunSqlOutput)
  | { success: false; error: string };

/** Hard upper bound on returned rows, regardless of the requested max_rows. */
const MAX_ROWS_HARD_CAP = 1000;
/** Default rows when the model omits max_rows. */
const DEFAULT_MAX_ROWS = 200;
/** How much of the SQL to echo into debug logs (never log full result rows). */
const SQL_LOG_PREVIEW_CHARS = 200;

/**
 * Write-statement keywords that may never lead or stand alone in a read-only
 * query. Matched as whole words, and only when NOT immediately followed by `(`
 * so legitimate scalar functions (e.g. `REPLACE(col,'a','b')`) are not
 * mistaken for the `INSERT OR REPLACE` statement.
 */
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER',
  'TRUNCATE', 'REINDEX', 'VACUUM', 'ATTACH', 'DETACH', 'BEGIN', 'COMMIT',
  'ROLLBACK', 'SAVEPOINT',
];
const FORBIDDEN_KEYWORD_RE = new RegExp(
  `\\b(?:${FORBIDDEN_KEYWORDS.join('|')})\\b(?!\\s*\\()`,
  'i'
);

/** Statement kinds whose leading keyword is allowed (everything else rejected). */
const ALLOWED_LEADING_RE = /^(SELECT|WITH|EXPLAIN|PRAGMA|VALUES)\b/i;

/**
 * Replace every SQL string literal, quoted/bracketed identifier, and comment
 * with a single space, so the structural pre-scan (semicolons, keywords) can
 * never be fooled by a semicolon or a keyword that lives inside a string or an
 * identifier. Length is not preserved (each span collapses to one space), which
 * is fine — we only inspect this stripped form for structure.
 */
function stripSqlLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];

    // Line comment: -- … to end of line
    if (ch === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    // Block comment: /* … */
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // Single-quote string literal (with '' escape)
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    // Double-quote identifier (with "" escape)
    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++; break;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    // Backtick identifier
    if (ch === '`') {
      i++;
      while (i < n && sql[i] !== '`') i++;
      i++;
      out += ' ';
      continue;
    }
    // Bracket identifier: [ … ]
    if (ch === '[') {
      i++;
      while (i < n && sql[i] !== ']') i++;
      i++;
      out += ' ';
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Layer 1: single-statement + write-keyword pre-scan. Returns an error message
 * to reject with, or null if the query passes the structural checks. This is
 * defense in depth — `stmt.readonly` (layer 2) is the authoritative guard.
 */
function preScanRejection(sql: string): string | null {
  const code = stripSqlLiteralsAndComments(sql).trim();

  if (code.length === 0) {
    return 'Empty query.';
  }

  // Reject multiple statements: a semicolon followed by more non-whitespace.
  // A single trailing semicolon is allowed.
  const withoutTrailing = code.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return 'Only a single statement is permitted; multiple statements are not allowed.';
  }

  // Leading keyword must be a read-only statement kind.
  if (!ALLOWED_LEADING_RE.test(withoutTrailing)) {
    return 'Only read-only queries are permitted (SELECT, WITH … SELECT, EXPLAIN, or a read-only PRAGMA).';
  }

  // Reject the mutating PRAGMA assignment form: PRAGMA <name> = <value>.
  if (/^PRAGMA\b/i.test(withoutTrailing) && /^PRAGMA\s+[\w.]+\s*=/i.test(withoutTrailing)) {
    return 'Mutating PRAGMA assignments are not permitted; only read-only PRAGMAs (e.g. PRAGMA table_info(<table>)) are allowed.';
  }

  // Reject any write-statement keyword appearing as a standalone word — catches
  // a CTE that wraps a write, e.g. `WITH t AS (…) DELETE FROM …`.
  if (FORBIDDEN_KEYWORD_RE.test(withoutTrailing)) {
    return 'Only read-only queries are permitted; write statements are rejected.';
  }

  return null;
}

/** Resolve the raw (already-decrypted) database handle for the target. */
function resolveDatabase(
  database: 'main' | 'llm-logs' | 'mount-index'
): DatabaseType | null {
  switch (database) {
    case 'llm-logs':
      return getRawLLMLogsDatabase();
    case 'mount-index':
      return getRawMountIndexDatabase();
    case 'main':
    default:
      return getRawDatabase();
  }
}

/**
 * Replace BLOB values (Node Buffer / Uint8Array) with a compact placeholder so
 * embeddings and binary blobs are never inlined into the model's context. Also
 * down-converts BigInt to a JSON-safe value so JSON.stringify can't throw.
 */
function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (Buffer.isBuffer(value)) {
      out[key] = `<blob: ${value.length} bytes>`;
    } else if (value instanceof Uint8Array) {
      out[key] = `<blob: ${value.byteLength} bytes>`;
    } else if (typeof value === 'bigint') {
      out[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Column names for an (often empty) reader statement, best-effort. */
function safeColumnNames(stmt: import('better-sqlite3').Statement): string[] {
  try {
    return (stmt.columns() as Array<{ name: string }>).map((c) => c.name);
  } catch {
    return [];
  }
}

/**
 * Execute the run_sql tool: validate input, enforce read-only, run the query
 * against the selected database, and shape the rows into the JSON envelope.
 */
export async function executeRunSqlTool(
  input: unknown,
  context: RunSqlToolContext
): Promise<RunSqlResult> {
  const startedAt = Date.now();

  // Validate against the Zod source of truth (also normalizes types).
  const parsed = runSqlToolInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: `Invalid run_sql input: ${issue ? `${issue.path.join('.')} — ${issue.message}` : 'malformed arguments'}.`,
    };
  }

  const sql = parsed.data.sql.trim();
  const database = parsed.data.database ?? 'main';
  const maxRows = Math.min(
    MAX_ROWS_HARD_CAP,
    Math.max(1, parsed.data.max_rows ?? DEFAULT_MAX_ROWS)
  );

  // Layer 1: structural / keyword pre-scan.
  const preScanError = preScanRejection(sql);
  if (preScanError) {
    sqlLogger.debug('run_sql rejected by pre-scan', {
      userId: context.userId,
      database,
      sqlPreview: sql.slice(0, SQL_LOG_PREVIEW_CHARS),
      reason: preScanError,
    });
    return { success: false, error: preScanError };
  }

  // Resolve the raw database handle (already open + decrypted by the server).
  const db = resolveDatabase(database);
  if (!db) {
    return {
      success: false,
      error: `The ${database} database is not available (uninitialized or degraded).`,
    };
  }

  // Prepare the statement (also rejects multi-statement SQL authoritatively).
  let stmt: import('better-sqlite3').Statement;
  try {
    stmt = db.prepare(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sqlLogger.debug('run_sql prepare failed', {
      userId: context.userId,
      database,
      sqlPreview: sql.slice(0, SQL_LOG_PREVIEW_CHARS),
      error: message,
    });
    return { success: false, error: `SQL error: ${message}` };
  }

  // Layer 2: authoritative read-only guard — fail closed unless exactly true.
  if (stmt.readonly !== true) {
    sqlLogger.debug('run_sql rejected: statement is not read-only', {
      userId: context.userId,
      database,
      sqlPreview: sql.slice(0, SQL_LOG_PREVIEW_CHARS),
      readonly: stmt.readonly,
    });
    return { success: false, error: 'Only read-only queries are permitted.' };
  }

  // Execute and shape. Layer 3: cap materialized rows at maxRows.
  let rawRows: Array<Record<string, unknown>>;
  try {
    rawRows = stmt.reader ? (stmt.all() as Array<Record<string, unknown>>) : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sqlLogger.debug('run_sql execution failed', {
      userId: context.userId,
      database,
      sqlPreview: sql.slice(0, SQL_LOG_PREVIEW_CHARS),
      error: message,
    });
    return { success: false, error: `SQL error: ${message}` };
  }

  const truncated = rawRows.length > maxRows;
  const sliced = rawRows.slice(0, maxRows);
  const rows = sliced.map(sanitizeRow);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : safeColumnNames(stmt);

  sqlLogger.debug('run_sql executed', {
    userId: context.userId,
    database,
    sqlPreview: sql.slice(0, SQL_LOG_PREVIEW_CHARS),
    readonly: stmt.readonly,
    rowCount: rows.length,
    truncated,
    durationMs: Date.now() - startedAt,
  });

  return {
    success: true,
    database,
    columns,
    rows,
    rowCount: rows.length,
    truncated,
  };
}
