/**
 * Database Abstraction Layer - Memory Extraction Cursors Repository
 *
 * One row per (chat, fold-grain extraction pass): the last message that pass
 * has read (memory refactor §3.7). The passes read and advance cursors only
 * through `lib/memory/extraction/cursors.ts`; bundles carry them through
 * `lib/memory/extraction/cursor-bundle.ts`.
 *
 * Reads throw on failure rather than answering "no cursor": a pass that took a
 * failed read for an empty cursor would re-read history it has covered, and the
 * catch-up sweep would enqueue a job for every idle chat (review of PR 94).
 *
 * Method names follow the job child's proxy rules: reads start with `find`,
 * writes with `set` / `clear` (see
 * `lib/background-jobs/child/child-repositories-proxy.ts`), so a cursor moved
 * inside a job is buffered and committed with the job's other writes.
 */

import { getRawDatabase } from '../backends/sqlite/client'
import {
  MemoryExtractionCursorSchema,
  extractionCursorId,
  type ExtractionCursorMap,
  type ExtractionCursorPass,
  type MemoryExtractionCursor,
} from '@/lib/schemas/memory-extraction-cursor.types'
import { AbstractBaseRepository } from './base.repository'
import { logger } from '@/lib/logger'
import type { TypedQueryFilter } from '../interfaces'

export class MemoryExtractionCursorsRepository extends AbstractBaseRepository<MemoryExtractionCursor> {
  constructor() {
    super('memory_extraction_cursors', MemoryExtractionCursorSchema)
  }

  async create(
    data: Omit<MemoryExtractionCursor, 'id' | 'createdAt' | 'updatedAt'>,
    options?: import('./base.repository').CreateOptions,
  ): Promise<MemoryExtractionCursor> {
    return this._create(data, { ...options, id: options?.id ?? extractionCursorId(data.chatId, data.pass) })
  }

  async update(id: string, data: Partial<MemoryExtractionCursor>): Promise<MemoryExtractionCursor | null> {
    return this._update(id, data)
  }

  async delete(id: string): Promise<boolean> {
    return this._delete(id)
  }

  // ============================================================================
  // Reads
  // ============================================================================

  /** A chat's cursors, keyed by pass. Empty when no pass has read the chat. */
  async findByChatId(chatId: string): Promise<ExtractionCursorMap> {
    return this.safeQuery(
      async () => {
        const rows = await this.findByFilter({ chatId } as TypedQueryFilter<MemoryExtractionCursor>)
        return toMap(rows)
      },
      'Error finding extraction cursors for chat',
      { chatId },
    )
  }

  /** One pass's cursor for a chat, or null. */
  async findCursor(chatId: string, pass: ExtractionCursorPass): Promise<string | null> {
    return this.safeQuery(
      async () => (await this._findById(extractionCursorId(chatId, pass)))?.messageId ?? null,
      'Error finding extraction cursor',
      { chatId, pass },
    )
  }

  /** Every chat's cursors (the daily catch-up sweep reads them in one pass). */
  async findAllByChat(): Promise<Map<string, ExtractionCursorMap>> {
    return this.safeQuery(
      async () => {
        const byChat = new Map<string, ExtractionCursorMap>()
        for (const row of await this._findAll()) {
          const map = byChat.get(row.chatId) ?? {}
          map[row.pass] = row.messageId
          byChat.set(row.chatId, map)
        }
        return byChat
      },
      'Error listing extraction cursors',
      {},
    )
  }

  // ============================================================================
  // Writes
  // ============================================================================

  /**
   * Move a chat's cursor for one pass to `messageId` (insert or replace). An
   * upsert in one statement, so two jobs advancing the same cursor cannot
   * collide on the primary key.
   */
  async setCursor(chatId: string, pass: ExtractionCursorPass, messageId: string): Promise<void> {
    await this.safeQuery(
      async () => {
        // Ensures the table exists (and validates the shape) before the raw write.
        await this.getCollection()
        const db = getRawDatabase()
        if (!db) throw new Error('Extraction cursor: the main database is not initialized')
        const now = this.getCurrentTimestamp()
        db.prepare(
          `INSERT INTO "memory_extraction_cursors" ("id", "chatId", "pass", "messageId", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT("id") DO UPDATE SET "messageId" = excluded."messageId", "updatedAt" = excluded."updatedAt"`,
        ).run(extractionCursorId(chatId, pass), chatId, pass, messageId, now, now)
        logger.debug('[ExtractionCursors] Cursor set', { chatId, pass, messageId })
      },
      'Error setting extraction cursor',
      { chatId, pass },
    )
  }

  /** Forget one pass's cursor for a chat: the pass reads the chat from the start again. */
  async clearCursor(chatId: string, pass: ExtractionCursorPass): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const removed = await this.deleteMany({ id: extractionCursorId(chatId, pass) } as TypedQueryFilter<MemoryExtractionCursor>)
        logger.debug('[ExtractionCursors] Cursor cleared', { chatId, pass, removed })
        return removed > 0
      },
      'Error clearing extraction cursor',
      { chatId, pass },
      false,
    )
  }

  /** Forget every cursor of a chat. */
  async clearForChat(chatId: string): Promise<number> {
    return this.safeQuery(
      async () => this.deleteMany({ chatId } as TypedQueryFilter<MemoryExtractionCursor>),
      'Error clearing extraction cursors for chat',
      { chatId },
      0,
    )
  }
}

function toMap(rows: MemoryExtractionCursor[]): ExtractionCursorMap {
  const map: ExtractionCursorMap = {}
  for (const row of rows) map[row.pass] = row.messageId
  return map
}
