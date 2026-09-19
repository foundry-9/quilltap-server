/**
 * Chat Inform Type Definitions
 *
 * Schemas for the Salon's **Inform** action — an out-of-character passage the
 * operator hands to one or more LLM-controlled seats, delivered as its own
 * system block on each target's next generation and consumed once that turn
 * produces a persisted assistant message.
 *
 * One row per (batch × target). The body is duplicated per target on purpose:
 * consumption is then a single-row write with no read-modify-write of a shared
 * array that a buffered job-child write could clobber.
 *
 * @module schemas/chat-inform.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// CHAT INFORM
// ============================================================================

export const ChatInformSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  /** Shared by every row one post produced — the unit the operator cancels. */
  batchId: UUIDSchema,
  /**
   * A chat PARTICIPANT id, never a character id — the same rule
   * `targetParticipantIds` follows on messages.
   */
  participantId: UUIDSchema,
  /** Exactly what the operator typed. Delivered verbatim; never framed. */
  contentMarkdown: z.string(),
  /**
   * The Host transcript message documenting the post. Nullable so a
   * record-write failure (the announcer convention: errors never propagate)
   * cannot orphan the batch.
   */
  recordMessageId: UUIDSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Null while pending. Set when a generation that carried this row landed. */
  consumedAt: TimestampSchema.nullable().optional(),
  /**
   * The assistant message whose generation delivered this row. It is what
   * makes a regenerate/swipe of that message re-apply the same inform.
   */
  consumedByMessageId: UUIDSchema.nullable().optional(),
});

export type ChatInform = z.infer<typeof ChatInformSchema>;

export const ChatInformInputSchema = ChatInformSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ChatInformInput = z.infer<typeof ChatInformInputSchema>;

/**
 * One pending batch, as the composer chip reads it: the body once, plus the
 * seats still owed it.
 */
export interface PendingInformBatch {
  batchId: string;
  contentMarkdown: string;
  createdAt: string;
  recordMessageId: string | null;
  pendingParticipantIds: string[];
}
