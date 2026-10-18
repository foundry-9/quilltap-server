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

describe('remapCharacterKeyedChatFields', () => {
  it('lists the four keyed columns', () => {
    expect([...CHARACTER_KEYED_CHAT_FIELDS].sort()).toEqual(
      ['characterAvatars', 'courierCheckpoints', 'equippedOutfit', 'pendingOutfitNotifications'].sort()
    );
  });

  it('re-keys the outfit and moves slot item ids, keeping unknown ones', () => {
    const patch = remapCharacterKeyedChatFields(
      { equippedOutfit: { 'char-a': { ...empty, top: ['item-1', 'item-x'] } } },
      remaps
    );
    expect(patch.equippedOutfit).toEqual({ 'char-A': { ...empty, top: ['item-ONE', 'item-x'] } });
  });

  it('fills a pre-hair four-slot bag out to five slots, as the history does', () => {
    const { hair: _hair, ...fourSlots } = { ...empty, footwear: ['item-1'] };
    const patch = remapCharacterKeyedChatFields({ equippedOutfit: { 'char-a': fourSlots } }, remaps);
    expect(patch.equippedOutfit).toEqual({ 'char-A': { ...empty, footwear: ['item-ONE'] } });
  });

  it('repairs a malformed slot instead of copying it', () => {
    const patch = remapCharacterKeyedChatFields(
      { equippedOutfit: { 'char-a': { ...empty, top: 'item-1' } } },
      remaps
    );
    expect((patch.equippedOutfit as Record<string, unknown>)['char-A']).toEqual(empty);
  });

  it('re-keys outfit avatars and moves their image id', () => {
    const patch = remapCharacterKeyedChatFields(
      { characterAvatars: { 'char-a': { imageId: 'file-1', generatedAt: 't', afterMessageCount: 3 } } },
      remaps
    );
    expect(patch.characterAvatars).toEqual({
      'char-A': { imageId: 'file-ONE', generatedAt: 't', afterMessageCount: 3 },
    });
  });

  it('re-keys Courier checkpoints and moves their message id', () => {
    const patch = remapCharacterKeyedChatFields(
      { courierCheckpoints: { 'char-b': { lastResolvedMessageId: 'msg-1', resolvedAt: 't' } } },
      remaps
    );
    expect(patch.courierCheckpoints).toEqual({ 'char-B': { lastResolvedMessageId: 'msg-ONE', resolvedAt: 't' } });
  });

  it('re-keys queued outfit notices and keeps their values', () => {
    const notice = { text: 'changed', at: 't' };
    const patch = remapCharacterKeyedChatFields({ pendingOutfitNotifications: { 'char-a': notice } }, remaps);
    expect(patch.pendingOutfitNotifications).toEqual({ 'char-A': notice });
  });

  it('drops the entry of a character the remap cannot place', () => {
    const patch = remapCharacterKeyedChatFields(
      { equippedOutfit: { 'char-a': empty, 'char-gone': empty } },
      remaps
    );
    expect(Object.keys(patch.equippedOutfit as object)).toEqual(['char-A']);
  });

  it('leaves out columns that are null, missing or not an object', () => {
    expect(
      remapCharacterKeyedChatFields(
        { equippedOutfit: null, characterAvatars: undefined, courierCheckpoints: [] as unknown },
        remaps
      )
    ).toEqual({});
  });
});
