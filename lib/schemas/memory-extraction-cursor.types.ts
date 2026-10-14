/**
 * Memory extraction cursors (memory refactor §3.7, Phase D).
 *
 * A fold-grain extraction pass reads a chat in stretches and records the last
 * message it has read: one row per (chat, pass) in `memory_extraction_cursors`.
 * A pass advances its cursor only past messages its window actually covered,
 * so nothing is ever marked read unread (bugs 206, 207).
 *
 * The `turn` row is the turn grain's: the last assistant message a committed
 * per-turn extraction covered. A turn is addressed by its opener, but a Skip,
 * nudge or continue closes the same turn again, and an autonomous room's turns
 * have no opener at all; the next job reads only what lies past this cursor,
 * so no line is extracted twice (bug 245).
 *
 * @module schemas/memory-extraction-cursor.types
 */

import { z } from 'zod'
import { UUIDSchema, TimestampSchema } from './common.types'

/** The passes that keep a cursor. */
export const ExtractionCursorPassEnum = z.enum(['other-fold', 'episode-fold', 'turn'])
export type ExtractionCursorPass = z.infer<typeof ExtractionCursorPassEnum>

/** The fold-grain passes: the cursors that read a chat in stretches. */
export type FoldCursorPass = Exclude<ExtractionCursorPass, 'turn'>

export const EXTRACTION_CURSOR_PASSES: readonly ExtractionCursorPass[] = ExtractionCursorPassEnum.options

export const MemoryExtractionCursorSchema = z.object({
  /** `<chatId>:<pass>` — one row per chat and pass. */
  id: z.string().min(1),
  chatId: UUIDSchema,
  pass: ExtractionCursorPassEnum,
  /** The last message the pass has read. */
  messageId: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type MemoryExtractionCursor = z.infer<typeof MemoryExtractionCursorSchema>

/** The row id of a chat's cursor for one pass. */
export function extractionCursorId(chatId: string, pass: ExtractionCursorPass): string {
  return `${chatId}:${pass}`
}

/** A chat's cursors as a map, the shape bundles and the passes read. */
export type ExtractionCursorMap = Partial<Record<ExtractionCursorPass, string>>
