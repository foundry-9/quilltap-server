/**
 * Wardrobe Type Definitions
 *
 * Contains schemas for the modular wardrobe system: wardrobe items,
 * equipped outfit slots, and per-chat equipped state.
 *
 * Slots hold arrays of wardrobe item IDs — multiple items per slot are allowed
 * (e.g. a t-shirt under a sweater). Wardrobe items can also be composites
 * (referencing other items via `componentItemIds`); composites are stored
 * as their own ID in equipped state and expanded only at read time.
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
  /**
   * Optional plain-text phrase fed to image-generation pipelines (avatar +
   * Lantern scene) IN PLACE OF the title when present; falls back to `title`
   * when absent/empty. Unlike `description` (human prose / Markdown, stripped
   * from image prompts), this is a short, literal visual cue meant for a
   * diffusion model — e.g. "intricate dense burnished-gold circular rank glyph
   * on the shoulder". Keep it terse; it is joined into a comma-separated outfit
   * list. Never Markdown.
   */
  imagePrompt: z.string().nullable().optional(),
  /** Coverage tags — which slots this item covers (e.g., ["top"], ["top","bottom"] for a dress) */
  types: z.array(WardrobeItemTypeEnum).min(1),
  /**
   * Other wardrobe items this item is composed of. Empty = leaf item.
   * Cycles (direct or transitive self-reference) are rejected at save time
   * by `WardrobeRepository.create`/`update` and the vault overlay materializer.
   */
  componentItemIds: z.array(UUIDSchema).default([]),
  /** Context tags for when this item is appropriate (e.g., "casual", "formal", "intimate") */
  appropriateness: z.string().nullable().optional(),
  /** Whether this item is part of the character's default outfit */
  isDefault: z.boolean().default(false),
  /**
   * Composite behaviour on equip. `false`/absent (the default) = additive:
   * the composite's components layer onto whatever already occupies the slots
   * it designates, clearing nothing. `true` = the composite clears every slot
   * it designates (its `types`) and then places only its own components — used
   * for full-outfit swaps and "clear everything" composites like Naked. Has no
   * effect on leaf (non-composite) items, which always replace their slots.
   */
  replace: z.boolean().default(false),
  /** Provenance tracking for items migrated from legacy clothingRecords */
  migratedFromClothingRecordId: UUIDSchema.nullable().optional(),
  /** When the item was archived (null = active) */
  archivedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type WardrobeItem = z.infer<typeof WardrobeItemSchema>;

// ============================================================================
// EQUIPPED OUTFIT STATE
// ============================================================================

/**
 * Per-character equipped slots. Each slot holds an array of wardrobe item IDs;
 * multiple items per slot represent layering (t-shirt + sweater). Composite
 * items appear as a single ID and are expanded at read time.
 */
export const EquippedSlotsSchema = z.object({
  top: z.array(UUIDSchema).default([]),
  bottom: z.array(UUIDSchema).default([]),
  footwear: z.array(UUIDSchema).default([]),
  accessories: z.array(UUIDSchema).default([]),
});

export type EquippedSlots = z.infer<typeof EquippedSlotsSchema>;

/** Per-chat equipped outfit state, keyed by characterId */
export type EquippedOutfitState = Record<string, EquippedSlots>;

// ============================================================================
// OUTFIT SELECTION (for new chat creation)
// ============================================================================

export const OutfitSelectionModeEnum = z.enum(['default', 'manual', 'llm_choose', 'none', 'previous_chat']);
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

/** Empty equipped slots (all empty arrays) */
export const EMPTY_EQUIPPED_SLOTS: EquippedSlots = {
  top: [],
  bottom: [],
  footwear: [],
  accessories: [],
};

