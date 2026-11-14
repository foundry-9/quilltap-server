/**
 * Salon Avatar Timeline Type Definitions
 *
 * Each character in a chat keeps a dated list of the avatars the chat bound
 * for them. A Salon bubble is drawn with the avatar in force when the message
 * was written, so a change of look takes effect from the moment its portrait
 * arrives and earlier bubbles keep the old one.
 *
 * Rows live in the `chat_avatar_timeline` table and are written at runtime
 * only by `ChatAvatarTimelineRepository.record`.
 *
 * Design of record: docs/developer/features/complete/salon-avatar-timeline.md
 *
 * @module schemas/chat-avatar-timeline.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

/** Where a timeline row came from. */
export const AvatarTimelineSourceSchema = z.enum([
  'baseline',          // what the chat showed before its first recorded change
  'generated',         // a freshly drawn avatar from the avatar job
  'cache',             // the avatar job reused an image for the same configuration
  'operator',          // set by hand (?action=set-avatar)
  'operator-removed',  // a hand-set avatar removed (?action=remove-avatar): the character's own avatar from here on
]);

export type AvatarTimelineSource = z.infer<typeof AvatarTimelineSourceSchema>;

/** One `chat_avatar_timeline` row. */
export const ChatAvatarTimelineRowSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  /** No FK: characters may be archived tombstones. */
  characterId: z.string().min(1),
  /**
   * Vault link id (or a legacy `files.id`) of the avatar. NULL means "the
   * character's own avatar from here on" (a baseline with no per-chat
   * avatar, or a removed hand-set one).
   */
  imageId: z.string().min(1).nullable(),
  /** When the avatar took effect: the moment it was bound to the chat. */
  effectiveAt: TimestampSchema,
  source: AvatarTimelineSourceSchema,
  createdAt: TimestampSchema,
});

export type ChatAvatarTimelineRow = z.infer<typeof ChatAvatarTimelineRowSchema>;

/**
 * `effectiveAt` of a baseline row: before any message, so the baseline covers
 * the whole chat up to the first recorded change.
 */
export const AVATAR_TIMELINE_BASELINE_AT = '1970-01-01T00:00:00.000Z';
