/**
 * Extraction cursors in bundles (`.qtap` exports and backups).
 *
 * A chat's cursors live in `memory_extraction_cursors`, not on the chat row,
 * but bundles carry them on the chat under the two field names the chat row
 * used before Phase D — `otherExtractionWatermarkMessageId` and
 * `episodeExtractionWatermarkMessageId`. Keeping the names keeps every old
 * bundle readable and lets the existing message-id remapping (import's
 * `remintChatMessageIds`, restore's uuid remapper) carry them unchanged.
 *
 *  - Writers call {@link withBundleCursorFields} on each chat they emit.
 *  - Readers call {@link takeBundleCursors} on the chat they are about to
 *    create (it strips the fields) and {@link restoreBundleCursors} once the
 *    chat exists.
 *
 * @module memory/extraction/cursor-bundle
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import type { ExtractionCursorMap, ExtractionCursorPass } from '@/lib/schemas/memory-extraction-cursor.types'

const log = logger.child({ module: 'memory:extraction:cursor-bundle' })

/** The bundle field each pass's cursor travels under. */
export const BUNDLE_CURSOR_FIELDS = {
  'other-fold': 'otherExtractionWatermarkMessageId',
  'episode-fold': 'episodeExtractionWatermarkMessageId',
} as const satisfies Record<ExtractionCursorPass, string>

export type BundleCursorField = (typeof BUNDLE_CURSOR_FIELDS)[ExtractionCursorPass]

/** The two bundle fields, as they appear on an exported or backed-up chat. */
export type BundleCursorFields = Partial<Record<BundleCursorField, string | null>>

const ENTRIES = Object.entries(BUNDLE_CURSOR_FIELDS) as Array<[ExtractionCursorPass, BundleCursorField]>

/** A cursor map as bundle fields (absent passes are left out). */
export function cursorsToBundleFields(cursors: ExtractionCursorMap): BundleCursorFields {
  const fields: BundleCursorFields = {}
  for (const [pass, field] of ENTRIES) {
    const messageId = cursors[pass]
    if (messageId) fields[field] = messageId
  }
  return fields
}

/**
 * The chat as a writer emits it: its cursors on the bundle fields.
 * Best-effort: a cursor that cannot be read is left out (the pass re-reads
 * after import), never a reason to fail the export or backup.
 */
export async function withBundleCursorFields<T extends { id: string }>(chat: T): Promise<T & BundleCursorFields> {
  try {
    const cursors = await getRepositories().memoryExtractionCursors.findByChatId(chat.id)
    return { ...chat, ...cursorsToBundleFields(cursors) }
  } catch (error) {
    log.warn('[ExtractionCursors] Could not read a chat\'s cursors for a bundle; leaving them out', {
      chatId: chat.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ...chat }
  }
}

/**
 * Split a bundle chat into the chat to create and its cursors. The bundle
 * fields are removed from the returned chat. Blank values are not cursors.
 */
export function takeBundleCursors<T extends object>(chat: T): { chat: Omit<T, BundleCursorField>; cursors: ExtractionCursorMap } {
  const rest = { ...chat } as Record<string, unknown>
  const cursors: ExtractionCursorMap = {}
  for (const [pass, field] of ENTRIES) {
    const value = rest[field]
    delete rest[field]
    if (typeof value === 'string' && value.length > 0) cursors[pass] = value
  }
  return { chat: rest as Omit<T, BundleCursorField>, cursors }
}

/** Write a created chat's cursors. Best-effort: a lost cursor only means a pass re-reads. */
export async function restoreBundleCursors(chatId: string, cursors: ExtractionCursorMap): Promise<number> {
  let written = 0
  for (const [pass, messageId] of Object.entries(cursors) as Array<[ExtractionCursorPass, string | undefined]>) {
    if (!messageId) continue
    try {
      await getRepositories().memoryExtractionCursors.setCursor(chatId, pass, messageId)
      written++
    } catch (error) {
      log.warn('[ExtractionCursors] Could not restore a bundled cursor; the pass will re-read', {
        chatId,
        pass,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (written > 0) log.debug('[ExtractionCursors] Restored bundled cursors', { chatId, written })
  return written
}
