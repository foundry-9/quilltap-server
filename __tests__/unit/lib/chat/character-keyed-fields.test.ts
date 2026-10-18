/**
 * The one pass over a chat's character-keyed JSON columns (bug 252). Restore
 * and .qtap import both call it; here it runs on its own with plain maps.
 */

import {
  CHARACTER_KEYED_CHAT_FIELDS,
  remapCharacterKeyedChatFields,
  type CharacterKeyedRemaps,
} from '@/lib/chat/character-keyed-fields';

const map = (pairs: Record<string, string>) => (id: string) => pairs[id] ?? id;

const remaps: CharacterKeyedRemaps = {
  characterId: (id) => ({ 'char-a': 'char-A', 'char-b': 'char-B' } as Record<string, string>)[id] ?? null,
  wardrobeItemId: map({ 'item-1': 'item-ONE' }),
  fileId: map({ 'file-1': 'file-ONE' }),
  messageId: map({ 'msg-1': 'msg-ONE' }),
};

const empty = { top: [], bottom: [], footwear: [], accessories: [], hair: [] };

const remap = (chat: Parameters<typeof remapCharacterKeyedChatFields>[0]) =>
  remapCharacterKeyedChatFields(chat, remaps).patch;

describe('remapCharacterKeyedChatFields', () => {
  it('lists the five keyed columns', () => {
    expect([...CHARACTER_KEYED_CHAT_FIELDS].sort()).toEqual(
      ['characterAvatars', 'courierCheckpoints', 'equippedInventory', 'equippedOutfit', 'pendingOutfitNotifications'].sort()
    );
  });

  it('re-keys the carried Inventory, keeping the object ids as they are', () => {
    const patch = remap({ equippedInventory: { 'char-a': ['obj-1', 'obj-2'] } });
    expect(patch.equippedInventory).toEqual({ 'char-A': ['obj-1', 'obj-2'] });
  });

  it('re-keys the outfit and moves slot item ids, keeping unknown ones', () => {
    const patch = remap(
      { equippedOutfit: { 'char-a': { ...empty, top: ['item-1', 'item-x'] } } },
    );
    expect(patch.equippedOutfit).toEqual({ 'char-A': { ...empty, top: ['item-ONE', 'item-x'] } });
  });

  it('fills a pre-hair four-slot bag out to five slots, as the history does', () => {
    const { hair: _hair, ...fourSlots } = { ...empty, footwear: ['item-1'] };
    const patch = remap({ equippedOutfit: { 'char-a': fourSlots } });
    expect(patch.equippedOutfit).toEqual({ 'char-A': { ...empty, footwear: ['item-ONE'] } });
  });

  it('repairs a malformed slot instead of copying it', () => {
    const patch = remap(
      { equippedOutfit: { 'char-a': { ...empty, top: 'item-1' } } },
    );
    expect((patch.equippedOutfit as Record<string, unknown>)['char-A']).toEqual(empty);
  });

  it('re-keys outfit avatars and moves their image id', () => {
    const patch = remap(
      { characterAvatars: { 'char-a': { imageId: 'file-1', generatedAt: 't', afterMessageCount: 3 } } },
    );
    expect(patch.characterAvatars).toEqual({
      'char-A': { imageId: 'file-ONE', generatedAt: 't', afterMessageCount: 3 },
    });
  });

  it('re-keys Courier checkpoints and moves their message id', () => {
    const patch = remap(
      { courierCheckpoints: { 'char-b': { lastResolvedMessageId: 'msg-1', resolvedAt: 't' } } },
    );
    expect(patch.courierCheckpoints).toEqual({ 'char-B': { lastResolvedMessageId: 'msg-ONE', resolvedAt: 't' } });
  });

  it('re-keys queued outfit notices and keeps their values', () => {
    const notice = { text: 'changed', at: 't' };
    const patch = remap({ pendingOutfitNotifications: { 'char-a': notice } });
    expect(patch.pendingOutfitNotifications).toEqual({ 'char-A': notice });
  });

  it('drops the entry of a character the remap cannot place, and counts it', () => {
    const result = remapCharacterKeyedChatFields(
      { equippedOutfit: { 'char-a': empty, 'char-gone': empty } },
      remaps
    );
    expect(Object.keys(result.patch.equippedOutfit as object)).toEqual(['char-A']);
    expect(result.droppedEntries).toBe(1);
  });

  it('reads a column stored as a JSON string', () => {
    const patch = remap({ equippedOutfit: JSON.stringify({ 'char-a': { ...empty, top: ['item-1'] } }) });
    expect(patch.equippedOutfit).toEqual({ 'char-A': { ...empty, top: ['item-ONE'] } });
  });

  it('skips null or missing columns and reports unreadable ones', () => {
    const result = remapCharacterKeyedChatFields(
      { equippedOutfit: null, characterAvatars: undefined, courierCheckpoints: [] as unknown, pendingOutfitNotifications: 'not json' },
      remaps
    );
    expect(result.patch).toEqual({});
    expect(result.unreadable).toEqual(['courierCheckpoints', 'pendingOutfitNotifications']);
  });
});
