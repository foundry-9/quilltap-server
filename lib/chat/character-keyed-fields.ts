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
 * Pure: the caller supplies the remaps and does the logging. A character
 * remap returning `null` drops that character's entry (restore uses it for a
 * character the backup does not carry, rather than minting a phantom id).
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

/** An object, or a JSON string holding one (a column read back raw). */
function asObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export interface CharacterKeyedChatRemap {
  /** The rewritten columns; a column absent here is left as it was. */
  patch: CharacterKeyedChatPatch;
  /** Columns that held a value but not an object (nor a JSON object string), so were left alone. */
  unreadable: CharacterKeyedChatField[];
  /** Character entries dropped because the character remap returned null. */
  droppedEntries: number;
}

/** Replace one string field on an object entry; anything else is kept as given. */
function withMappedId(entry: unknown, field: string, map: (id: string) => string): unknown {
  const obj = asObject(entry);
  if (!obj || typeof obj[field] !== 'string') return entry;
  return { ...obj, [field]: map(obj[field] as string) };
}

/**
 * Remap every character-keyed column present on the chat. A null or missing
 * column is skipped; one that is not an object is reported in `unreadable`.
 */
export function remapCharacterKeyedChatFields(
  chat: Partial<Record<CharacterKeyedChatField, unknown>>,
  remaps: CharacterKeyedRemaps
): CharacterKeyedChatRemap {
  const patch: Record<string, unknown> = {};
  const unreadable: CharacterKeyedChatField[] = [];
  let droppedEntries = 0;

  const rekey = (field: CharacterKeyedChatField, mapValue: (entry: unknown) => unknown) => {
    const value = chat[field];
    if (value == null) return;
    const map = asObject(value);
    if (!map) {
      unreadable.push(field);
      return;
    }
    const next: Record<string, unknown> = {};
    for (const [characterId, entry] of Object.entries(map)) {
      const newId = remaps.characterId(characterId);
      if (newId) next[newId] = mapValue(entry);
      else droppedEntries++;
    }
    patch[field] = next;
  };

  rekey('equippedOutfit', (slots) => {
    // Same shape as the outfit history's remap: a full five-slot bag.
    const normalized = normalizeEquippedSlots(slots);
    return bySlot((slot) => normalized[slot].map(remaps.wardrobeItemId));
  });
  rekey('characterAvatars', (entry) => withMappedId(entry, 'imageId', remaps.fileId));
  rekey('courierCheckpoints', (entry) => withMappedId(entry, 'lastResolvedMessageId', remaps.messageId));
  rekey('pendingOutfitNotifications', (entry) => entry);

  return { patch: patch as CharacterKeyedChatPatch, unreadable, droppedEntries };
}
