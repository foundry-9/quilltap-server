'use client'

/**
 * BrahmaToolCall
 *
 * Renders a single `run_sql` tool call inside the Brahma Console transcript as
 * two collapsible panes:
 *
 *   1. **Query** — the SQL the engine ran, as a pretty-printed, syntax-highlighted
 *      code block (rendered through the shared Markdown renderer, so it picks up
 *      the same Prism theme and copy affordance as any fenced code block).
 *   2. **Result** — the rows the database returned, as a scrollable table; or the
 *      error text when the query was rejected/failed.
 *
 * The console offers other tools too (search, doc_*, web), but only `run_sql`
 * gets this dedicated surfacing — everything else stays a silent intermediate
 * turn, as before. Used both for the settled transcript (parsed from a persisted
 * TOOL message) and for the in-flight turn (built live from streamed events).
 */

import { useMemo } from 'react'
import MessageContent from '@/components/chat/MessageContent'
import { Icon } from '@/components/ui/icon'
import {
  formatCell,
  parseBrahmaSqlToolMessage,
  type BrahmaSqlToolCallData,
} from './brahma-sql-tool-call'

// Re-export the pure helpers so existing call sites can keep importing them from
// the component module.
export { parseBrahmaSqlToolMessage }
export type { BrahmaSqlToolCallData }

/** Shared chevron-led summary for the two collapsible panes. */
function PaneSummary({ label, hint }: { label: string; hint?: string }) {
  return (
    <summary className="flex items-center gap-1 cursor-pointer select-none qt-text-secondary hover:text-foreground text-xs font-medium list-none [&::-webkit-details-marker]:hidden">
      <Icon name="chevron-right" className="w-3 h-3 transition-transform group-open:rotate-90" />
      <span>{label}</span>
      {hint && <span className="qt-text-xs qt-text-secondary font-normal ml-1">{hint}</span>}
    </summary>
  )
}

export function BrahmaToolCall({ data }: { data: BrahmaSqlToolCallData }) {
  const { success, sql, database, envelope, errorText, pending } = data

  const columns = envelope?.columns ?? []
  const rows = envelope?.rows ?? []
  const rowCount = envelope?.rowCount ?? rows.length
  const truncated = envelope?.truncated ?? false

  const sqlMarkdown = useMemo(() => (sql ? '```sql\n' + sql + '\n```' : ''), [sql])

  const statusChip = pending
    ? { text: 'Running…', className: 'qt-text-secondary' }
    : success
      ? { text: `${rowCount} row${rowCount === 1 ? '' : 's'}`, className: 'qt-badge-success' }
      : { text: 'Failed', className: 'qt-badge-destructive' }

  return (
    <div className="qt-bg-muted border qt-border-default rounded-lg p-2.5 text-xs w-full">
      {/* Header: tool identity + target database + status */}
      <div className="flex items-center gap-2 mb-2">
        <Icon name="database" className="w-3.5 h-3.5 qt-text-secondary" />
        <span className="font-semibold text-foreground">Ran SQL</span>
        <span className="px-1.5 py-0.5 rounded qt-bg-default border qt-border-default font-mono qt-text-xs qt-text-secondary">
          {database}
        </span>
        <span className={`ml-auto px-2 py-0.5 rounded qt-text-label-xs ${statusChip.className}`}>
          {statusChip.text}
        </span>
      </div>

      {/* Query pane — pretty-printed, syntax-highlighted SQL */}
      {sql && (
        <details className="group" open>
          <PaneSummary label="Query" />
          <div className="mt-1.5">
            <MessageContent content={sqlMarkdown} />
          </div>
        </details>
      )}

      {/* Result pane — the returned rows as a table, or the error text */}
      <details className="group mt-2" open>
        <PaneSummary label="Result" hint={truncated ? 'truncated' : undefined} />
        <div className="mt-1.5">
          {pending ? (
            <div className="qt-text-secondary italic">Consulting the stacks…</div>
          ) : !success ? (
            <div className="qt-text-destructive whitespace-pre-wrap break-words font-mono">
              {errorText || 'The query failed.'}
            </div>
          ) : rows.length === 0 ? (
            <div className="qt-text-secondary italic">No rows returned.</div>
          ) : (
            <>
              <div className="overflow-auto max-h-80 rounded border qt-border-default bg-background">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 qt-bg-muted">
                    <tr>
                      {columns.map(col => (
                        <th
                          key={col}
                          className="text-left font-semibold px-2 py-1 border-b qt-border-default whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b qt-border-default last:border-0">
                        {columns.map(col => {
                          const cell = formatCell(row[col])
                          return (
                            <td
                              key={col}
                              className={`px-2 py-1 align-top whitespace-pre-wrap break-words font-mono ${cell.isNull ? 'qt-text-secondary italic' : 'text-foreground'}`}
                            >
                              {cell.text}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1 qt-text-xs qt-text-secondary">
                {rowCount} row{rowCount === 1 ? '' : 's'}
                {truncated ? ' · truncated at the row cap' : ''}
              </div>
            </>
          )}
        </div>
      </details>
    </div>
  )
}
