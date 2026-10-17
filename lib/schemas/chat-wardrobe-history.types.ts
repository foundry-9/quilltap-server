/**
 * Wardrobe Outfit History Type Definitions
 *
 * Each character in a chat keeps a numbered timeline of the outfits they have
 * worn there, from `0` (what they arrived in) upward. One entry is recorded
 * per Aurora announcement — a tool call, a dialog **Done**, a Pascal run or a
 * whole model turn collapses to one — and a cursor (`isCurrent`) says which
 * entry the character is wearing now. A rollback moves the cursor; the next
 * real change appends at `max + 1`.
 *
 * Rows live in the `chat_wardrobe_history` table and are written at runtime
 * only by `ChatWardrobeHistoryRepository.settle`.
 *
 * Design of record: docs/developer/features/complete/wardrobe-outfit-history.md
 *
 * @module schemas/chat-wardrobe-history.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';
import { EquippedSlotsSchema } from './wardrobe.types';

/** Who (or what) produced an entry. */
export const WardrobeHistorySourceSchema = z.enum([
  'chat-start',        // applyOutfitSelections for a new chat
  'participant-added', // applyOutfitSelections for an added / reactivated seat
  'merge',             // applyOutfitSelections from a merge
  'operator',          // the Wardrobe dialog (?action=equip), or Wear again
  'character',         // a wardrobe_* tool call in a model turn (actorCharacterId = caller)
  'pascal',            // a custom tool's wardrobe effects (actorCharacterId = rolling character)
  'seeded',            // the backfill migration, or a first-touch seed
]);

export type WardrobeHistorySource = z.infer<typeof WardrobeHistorySourceSchema>;

/** One `chat_wardrobe_history` row. */
export const ChatWardrobeHistoryRowSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  /** No FK: characters may be archived tombstones. */
  characterId: z.string().min(1),
  /** 0-based, contiguous per (chatId, characterId); never renumbered. */
  entryIndex: z.number().int().nonnegative(),
  /** Dissolved leaves, the shape `chats.equippedOutfit` stores. */
  slots: EquippedSlotsSchema,
  /** `hashEquippedSlots(slots)`. */
  slotsHash: z.string().length(16),
  source: WardrobeHistorySourceSchema,
  /** The character whose tool call or roll made the change; null otherwise. */
  actorCharacterId: z.string().nullable(),
  /** The cursor: exactly one row per (chatId, characterId) is current. */
  isCurrent: z.boolean(),
  createdAt: TimestampSchema,
});

export type ChatWardrobeHistoryRow = z.infer<typeof ChatWardrobeHistoryRowSchema>;

/** Who is making an outfit change — carried on every OutfitChangeContext. */
export interface WardrobeHistoryProvenance {
  source: Exclude<WardrobeHistorySource, 'seeded'>;
  actorCharacterId?: string;
}

/** What a turn owes the ledger for one character; the last intent in a turn wins. */
export type WardrobeHistoryIntent =
  | { kind: 'append'; provenance: WardrobeHistoryProvenance }
  | { kind: 'cursor'; index: number };
