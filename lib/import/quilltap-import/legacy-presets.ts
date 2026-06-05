/**
 * Folds pre-rework `.qtap` outfit presets into composite wardrobe items at
 * import time. Pure transform with no DB access; the type is otherwise gone
 * from the data model and kept local here.
 *
 * @module import/quilltap-import/legacy-presets
 */

import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';

/**
 * Legacy outfit preset shape — only used to fold pre-rework `.qtap` exports
 * into composite wardrobe items at import time. Kept local since the type is
 * otherwise gone from the data model.
 */
export interface LegacyOutfitPreset {
  id: string;
  characterId: string | null;
  name: string;
  description: string | null;
  slots: {
    top: string | null;
    bottom: string | null;
    footwear: string | null;
    accessories: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

const LEGACY_PRESET_SLOT_ORDER: ReadonlyArray<keyof LegacyOutfitPreset['slots']> = [
  'top',
  'bottom',
  'footwear',
  'accessories',
];

/**
 * Convert a legacy preset into a composite WardrobeItem. Preserves the preset id
 * so any pre-rework reference remains valid. The existing UUID-remap path for
 * wardrobe items rewrites it consistently.
 */
export function legacyPresetToComposite(preset: LegacyOutfitPreset): WardrobeItem {
  const types: WardrobeItemType[] = [];
  const componentItemIds: string[] = [];
  const seenTypes = new Set<WardrobeItemType>();
  for (const slot of LEGACY_PRESET_SLOT_ORDER) {
    const value = preset.slots?.[slot];
    if (value) {
      componentItemIds.push(value);
      if (!seenTypes.has(slot)) {
        seenTypes.add(slot);
        types.push(slot);
      }
    }
  }
  // A composite must always declare at least one type. Fall back to "accessories"
  // for malformed legacy presets where every slot is null.
  if (types.length === 0) types.push('accessories');
  return {
    id: preset.id,
    characterId: preset.characterId,
    title: preset.name,
    description: preset.description,
    types,
    componentItemIds,
    appropriateness: null,
    isDefault: false,
    // Legacy presets were worn as a whole outfit, so preserve replace semantics.
    replace: true,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}
