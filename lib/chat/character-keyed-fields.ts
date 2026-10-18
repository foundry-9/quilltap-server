/**
 * The chat-row JSON columns keyed by character id, and the one pass that
 * carries them across an id change.
 *
 * A new-account restore (`lib/backup/restore/uuid-remap.ts`) gives every
 * character a fresh id, and a `.qtap` import (`reconcile.ts`) can map a
 * bundled character onto another id. Each column below is
 * `{ [characterId]: … }`, so left alone it names characters that no longer
 * exist (bug 252):
 *
 * - `equippedOutfit` — `{ top, bottom, footwear, accessories, hair }` per
 *   character; slot item ids follow the wardrobe item remap.
 * - `characterAvatars` — `{ imageId, generatedAt, afterMessageCount }`;
 *   `imageId` follows the file remap.
 * - `courierCheckpoints` — `{ lastResolvedMessageId, resolvedAt }`;
 *   the message id follows the message remap.
 * - `pendingOutfitNotifications` — legacy, keyed only; values are kept.
 *
 * Two keyed caches are deliberately left out: `compiledIdentityStacks`
 * (keyed by participant, rebuilt on a miss) and `commonplaceSceneCache`
 * (a miss only re-emits the scene block).
 *
 * Pure: the caller supplies the remaps. A character remap returning `null`
 * drops that character's entry.
 *
 * @module chat/character-keyed-fields
 */

import { bySlot, normalizeEquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { ChatMetadata } from '@/lib/schemas/types';

export const CHARACTER_KEYED_CHAT_FIELDS = [
  'equippedOutfit',
  'characterAvatars',
  'courierCheckpoints',
  'pendingOutfitNotifications',
] as const;

export type CharacterKeyedChatField = (typeof CHARACTER_KEYED_CHAT_FIELDS)[number];

export type CharacterKeyedChatPatch = Partial<Pick<ChatMetadata, CharacterKeyedChatField>>;

export interface CharacterKeyedRemaps {
  characterId: (id: string) => string | null;
  wardrobeItemId: (id: string) => string;
  fileId: (id: string) => string;
  messageId: (id: string) => string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Re-key one map by character, rewriting each value with `mapValue`. */
function rekey(
  value: unknown,
  remaps: CharacterKeyedRemaps,
  mapValue: (entry: unknown) => unknown
): Record<string, unknown> | null {
  const map = asObject(value);
  if (!map) return null;
  const next: Record<string, unknown> = {};
  for (const [characterId, entry] of Object.entries(map)) {
    const newId = remaps.characterId(characterId);
    if (newId) next[newId] = mapValue(entry);
  }
  return next;
}

/** Replace one string field on an object entry; anything else is kept as given. */
function withMappedId(entry: unknown, field: string, map: (id: string) => string): unknown {
  const obj = asObject(entry);
  if (!obj || typeof obj[field] !== 'string') return entry;
  return { ...obj, [field]: map(obj[field] as string) };
}

/**
 * Remap every character-keyed column present (non-null, an object) on the
 * chat. The patch carries only the columns it rewrote; a column that is not
 * an object is left out and so left alone.
 */
export function remapCharacterKeyedChatFields(
  chat: Partial<Record<CharacterKeyedChatField, unknown>>,
  remaps: CharacterKeyedRemaps
): CharacterKeyedChatPatch {
  const patch: Record<string, unknown> = {};
  const set = (field: CharacterKeyedChatField, value: Record<string, unknown> | null) => {
    if (value) patch[field] = value;
  };

  set('equippedOutfit', rekey(chat.equippedOutfit, remaps, (slots) => {
    // Same shape as the outfit history's remap: a full five-slot bag.
    const normalized = normalizeEquippedSlots(slots);
    return bySlot((slot) => normalized[slot].map(remaps.wardrobeItemId));
  }));
  set('characterAvatars', rekey(chat.characterAvatars, remaps, (entry) =>
    withMappedId(entry, 'imageId', remaps.fileId)
  ));
  set('courierCheckpoints', rekey(chat.courierCheckpoints, remaps, (entry) =>
    withMappedId(entry, 'lastResolvedMessageId', remaps.messageId)
  ));
  set('pendingOutfitNotifications', rekey(chat.pendingOutfitNotifications, remaps, (entry) => entry));

  return patch as CharacterKeyedChatPatch;
}
