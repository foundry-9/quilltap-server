/**
 * Wardrobe Type Definitions
 *
 * Contains schemas for the modular wardrobe system: wardrobe items,
 * equipped outfit slots, and equipped outfit state per chat.
 *
 * @module schemas/wardrobe.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
} from './common.types';

// ============================================================================
// WARDROBE ITEM TYPES
// ============================================================================

/** Coverage slot types for wardrobe items */
export const WardrobeItemTypeEnum = z.enum(['top', 'bottom', 'footwear', 'accessories']);
export type WardrobeItemType = z.infer<typeof WardrobeItemTypeEnum>;

/** All valid wardrobe slot types */
export const WARDROBE_SLOT_TYPES = ['top', 'bottom', 'footwear', 'accessories'] as const;

// ============================================================================
// WARDROBE ITEM
// ============================================================================

export const WardrobeItemSchema = z.object({
  id: UUIDSchema,
  /** Character this item belongs to. Null = archetype (shared across characters). */
  characterId: UUIDSchema.nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  /** Coverage tags — which slots this item covers (e.g., ["top"], ["top","bottom"] for a dress) */
  types: z.array(WardrobeItemTypeEnum).min(1),
  /** Context tags for when this item is appropriate (e.g., "casual", "formal", "intimate") */
  appropriateness: z.string().nullable().optional(),
  /** Whether this item is part of the character's default outfit */
  isDefault: z.boolean().default(false),
  /** Provenance tracking for items migrated from legacy clothingRecords */
  migratedFromClothingRecordId: UUIDSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type WardrobeItem = z.infer<typeof WardrobeItemSchema>;

// ============================================================================
// EQUIPPED OUTFIT STATE
// ============================================================================

/** Per-character equipped slots — one wardrobe item ID (or null) per slot */
export const EquippedSlotsSchema = z.object({
  top: UUIDSchema.nullable().default(null),
  bottom: UUIDSchema.nullable().default(null),
  footwear: UUIDSchema.nullable().default(null),
  accessories: UUIDSchema.nullable().default(null),
});

export type EquippedSlots = z.infer<typeof EquippedSlotsSchema>;

/** Per-chat equipped outfit state, keyed by characterId */
export type EquippedOutfitState = Record<string, EquippedSlots>;

// ============================================================================
// OUTFIT SELECTION (for new chat creation)
// ============================================================================

export const OutfitSelectionModeEnum = z.enum(['default', 'manual', 'llm_choose', 'none']);
export type OutfitSelectionMode = z.infer<typeof OutfitSelectionModeEnum>;

export const OutfitSelectionSchema = z.object({
  characterId: UUIDSchema,
  mode: OutfitSelectionModeEnum,
  /** Manual slot selections — only used when mode is 'manual' */
  slots: EquippedSlotsSchema.optional(),
});

export type OutfitSelection = z.infer<typeof OutfitSelectionSchema>;

// ============================================================================
// HELPERS
// ============================================================================

/** Empty equipped slots (all null) */
export const EMPTY_EQUIPPED_SLOTS: EquippedSlots = {
  top: null,
  bottom: null,
  footwear: null,
  accessories: null,
};

/**
 * Build a human-readable coverage summary from equipped slots and their item details.
 */
export function buildCoverageSummary(
  slots: EquippedSlots,
  items: Record<string, WardrobeItem | null>
): string {
  const parts: string[] = [];

  if (items.top) {
    parts.push(`wearing ${items.top.title}`);
  }
  if (items.bottom) {
    parts.push(items.bottom.title);
  }

  if (parts.length === 0) {
    parts.push('naked');
  }

  if (!items.footwear) {
    parts.push('barefoot');
  } else {
    parts.push(items.footwear.title);
  }

  if (!items.accessories) {
    parts.push('no accessories');
  } else {
    parts.push(items.accessories.title);
  }

  return parts.join(', ');
}
