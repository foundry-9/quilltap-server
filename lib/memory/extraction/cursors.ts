/**
 * Extraction cursors (memory refactor §3.7): where a fold-grain pass has read
 * a chat to.
 *
 * A pass reads through a {@link CursorStore}. The live store reads and writes
 * `memory_extraction_cursors` (buffered with the job's writes in the job
 * child); the dry run's store holds them in memory, starting where a
 * regenerate would (no cursors), so a preview reads the whole history and
 * never moves a real cursor.
 *
 * @module memory/extraction/cursors
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { ExtractionCursorMap, ExtractionCursorPass } from '@/lib/schemas/memory-extraction-cursor.types'
import { logger } from '@/lib/logger'

/** Where one pass has read one chat to; `afterMessageId: null` means from the start. */
export interface ExtractionCursor {
  chatId: string
  pass: ExtractionCursorPass
  afterMessageId: string | null
}

export interface CursorStore {
  read(pass: ExtractionCursorPass): Promise<ExtractionCursor>
  /** Move the cursor to `messageId` — only ever past messages the pass's window covered. */
  advance(pass: ExtractionCursorPass, messageId: string): Promise<void>
  clear(pass: ExtractionCursorPass): Promise<void>
}

/** The chat's real cursors. */
export function liveCursorStore(chatId: string): CursorStore {
  const repo = () => getRepositories().memoryExtractionCursors
  return {
    async read(pass) {
      return { chatId, pass, afterMessageId: await repo().findCursor(chatId, pass) }
    },
    async advance(pass, messageId) {
      await repo().setCursor(chatId, pass, messageId)
      logger.debug('[ExtractionCursors] Advanced', { chatId, pass, messageId })
    },
    async clear(pass) {
      await repo().clearCursor(chatId, pass)
    },
  }
}

/** Cursors held in memory (the dry run). Starts at `initial`, empty by default. */
export function memoryCursorStore(chatId: string, initial: ExtractionCursorMap = {}): CursorStore & {
  snapshot(): ExtractionCursorMap
} {
  const cursors: ExtractionCursorMap = { ...initial }
  return {
    async read(pass) {
      return { chatId, pass, afterMessageId: cursors[pass] ?? null }
    },
    async advance(pass, messageId) {
      cursors[pass] = messageId
    },
    async clear(pass) {
      delete cursors[pass]
    },
    snapshot: () => ({ ...cursors }),
  }
}
