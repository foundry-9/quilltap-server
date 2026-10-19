/**
 * Log entries — free-text lines a character (or a custom tool's `log` effect)
 * writes into the instance's ledger, and reads back with `log_grep` /
 * `log_read`.
 *
 * Stored in the LLM logs database (`quilltap-llm-logs.db`, table
 * `log_entries`) and pruned on the same retention schedule as the LLM logs.
 * Entries are written once and never edited; `updatedAt` exists only because
 * every repository entity carries one.
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

/** Longest message an entry may hold. Long enough for a paragraph, short enough to grep. */
export const MAX_LOG_ENTRY_MESSAGE_LENGTH = 4000;

export const LogEntrySchema = z.object({
  id: UUIDSchema,
  /** The line itself, verbatim. */
  message: z.string().min(1).max(MAX_LOG_ENTRY_MESSAGE_LENGTH),
  /** The chat the entry was written from. */
  chatId: UUIDSchema,
  /** The character who wrote it; null when the operator ran a tool with no character seat. */
  characterId: UUIDSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type LogEntry = z.infer<typeof LogEntrySchema>;
