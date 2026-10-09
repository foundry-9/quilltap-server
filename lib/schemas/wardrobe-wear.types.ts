/**
 * Wardrobe Wear Ledger Type Definitions
 *
 * Every wardrobe item keeps a tally of how often it has been worn, when, and
 * by whom. The tally is **not** part of the item: items are markdown files in
 * a `Wardrobe/` folder, and a frontmatter counter would rewrite the whole
 * folder on every wear and turn `updatedAt` into "last worn". It lives in the
 * `wardrobe_wear_stats` SQL table instead, one row per (item × wearer), and is
 * written only through `WardrobeWearRepository.commitEquippedOutfit`.
 *
 * Design of record: docs/developer/features/complete/wardrobe-wear-ledger.md
 *
 * @module schemas/wardrobe-wear.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// STORAGE ROW
// ============================================================================

/** One `wardrobe_wear_stats` row: one wearer's tally for one item. */
export const WardrobeWearStatsRowSchema = z.object({
  id: UUIDSchema,
  /** Wardrobe item id (a vault file's frontmatter id). No FK: items are not rows. */
  itemId: z.string().min(1),
  /** NULL = unattributed (the wearer was deleted, or an import could not resolve them). */
  wearerCharacterId: z.string().nullable(),
  wearCount: z.number().int().nonnegative(),
  firstWornAt: TimestampSchema,
  lastWornAt: TimestampSchema,
  /** No FK: a deleted chat leaves a dangling id the readers treat as "a chat since deleted". */
  lastWornChatId: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type WardrobeWearStatsRow = z.infer<typeof WardrobeWearStatsRowSchema>;

// ============================================================================
// READ SHAPES
// ============================================================================

/** An item's totals across every wearer. `wearCount: 0` with nulls is "never worn". */
export const WardrobeWearSummarySchema = z.object({
  wearCount: z.number().int().nonnegative(),
  firstWornAt: TimestampSchema.nullable(),
  lastWornAt: TimestampSchema.nullable(),
  lastWornChatId: UUIDSchema.nullable(),
});

export type WardrobeWearSummary = z.infer<typeof WardrobeWearSummarySchema>;

/** One wearer's share of an item's tally. */
export const WardrobeWearerSchema = z.object({
  /** null = unattributed */
  characterId: UUIDSchema.nullable(),
  wearCount: z.number().int().positive(),
  firstWornAt: TimestampSchema,
  lastWornAt: TimestampSchema,
  lastWornChatId: UUIDSchema.nullable(),
});

export type WardrobeWearer = z.infer<typeof WardrobeWearerSchema>;

/** Totals plus the per-wearer breakdown, most recent wearer first. */
export const WardrobeWearHistorySchema = WardrobeWearSummarySchema.extend({
  wearers: z.array(WardrobeWearerSchema),
});

export type WardrobeWearHistory = z.infer<typeof WardrobeWearHistorySchema>;

/**
 * An item's wear as one character sees it: its own share beside the
 * household's total. The character-facing tools answer from this, so a
 * shared item's count is never handed to a reader as if it were their own
 * (bug 184).
 */
export interface WardrobeWearPerspective {
  /** Every wearer's rows folded together. */
  household: WardrobeWearSummary;
  /** The reading character's own row, or the zero summary. */
  yours: WardrobeWearSummary;
}

/** The canonical "never worn" summary. Readers return this, never `undefined`. */
export function neverWornSummary(): WardrobeWearSummary {
  return { wearCount: 0, firstWornAt: null, lastWornAt: null, lastWornChatId: null };
}
