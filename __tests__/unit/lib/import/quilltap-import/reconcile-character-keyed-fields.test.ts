/**
 * Import reconciliation of a chat's character-keyed JSON columns (bug 252).
 * A bundled character can land under another id (an existing match, a
 * duplicate, or any import without preserveIds), so the chat's outfit,
 * outfit avatars, Courier checkpoints and queued outfit notices are re-keyed
 * here, beside the participants.
 */

import { reconcileRelationships } from '@/lib/import/quilltap-import/reconcile';
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}));
jest.mock('@/lib/mount-index/delete-store-cascade', () => ({ deleteStoreCascade: jest.fn() }));
jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

const empty = { top: [], bottom: [], footwear: [], accessories: [], hair: [] };

function makeIdMaps(): any {
  return {
    tags: new Map(),
    characters: new Map([['char-src', 'char-dest']]),
    chats: new Map([['chat-old', 'chat-new']]),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints: new Map(),
    docMountFileLinks: new Map([['link-src', 'link-dest']]),
    characterVaultMounts: new Map(),
    skippedCharacterVaults: new Set(),
    preserveIdsSkips: new Set(),
    wardrobeItems: new Map(),
    messages: new Map(),
  };
}

function setup(chatFields: Record<string, unknown>) {
  const chat = {
    id: 'chat-new',
    participants: [{ id: 'p-1', type: 'CHARACTER', characterId: 'char-src' }],
    tags: [],
    ...chatFields,
  };
  const update = jest.fn().mockResolvedValue(chat);
  const repos = {
    characters: { findById: jest.fn().mockResolvedValue(null), update: jest.fn() },
    chats: { findById: jest.fn().mockResolvedValue(chat), update },
    projects: { findById: jest.fn().mockResolvedValue(null) },
    groups: { findById: jest.fn().mockResolvedValue(null) },
  } as any;
  (getRepositories as jest.Mock).mockReturnValue({
    docMountPoints: { findById: jest.fn(async () => null), findAll: jest.fn(async () => []), update: jest.fn() },
  });
  return { repos, update };
}

beforeEach(() => jest.clearAllMocks());

describe('reconcileRelationships — character-keyed chat columns', () => {
  it('re-keys the outfit to the imported character and moves item ids', async () => {
    const { repos, update } = setup({
      equippedOutfit: { 'char-src': { ...empty, top: ['item-src', 'item-unknown'] } },
    });
    await reconcileRelationships('user-1', repos, makeIdMaps(), [], {
      wardrobeItemIds: new Map([['item-src', 'item-dest']]),
    });
    const [, updates] = update.mock.calls[0];
    expect(updates.equippedOutfit).toEqual({ 'char-dest': { ...empty, top: ['item-dest', 'item-unknown'] } });
    // The seat and the outfit agree on who is wearing it.
    expect(updates.participants[0].characterId).toBe('char-dest');
  });

  it('re-keys outfit avatars and follows the picture through the link map', async () => {
    const { repos, update } = setup({
      characterAvatars: { 'char-src': { imageId: 'link-src', generatedAt: 't', afterMessageCount: 1 } },
    });
    await reconcileRelationships('user-1', repos, makeIdMaps(), []);
    expect(update.mock.calls[0][1].characterAvatars).toEqual({
      'char-dest': { imageId: 'link-dest', generatedAt: 't', afterMessageCount: 1 },
    });
  });

  it('re-keys Courier checkpoints, keeping the already-reminted message id', async () => {
    const { repos, update } = setup({
      courierCheckpoints: { 'char-src': { lastResolvedMessageId: 'msg-new', resolvedAt: 't' } },
      pendingOutfitNotifications: { 'char-src': { text: 'changed' } },
    });
    await reconcileRelationships('user-1', repos, makeIdMaps(), []);
    const [, updates] = update.mock.calls[0];
    expect(updates.courierCheckpoints).toEqual({ 'char-dest': { lastResolvedMessageId: 'msg-new', resolvedAt: 't' } });
    expect(updates.pendingOutfitNotifications).toEqual({ 'char-dest': { text: 'changed' } });
  });

  it('keeps a character the bundle did not carry under its own id', async () => {
    const { repos, update } = setup({ equippedOutfit: { 'char-local': { ...empty, hair: ['bob'] } } });
    await reconcileRelationships('user-1', repos, makeIdMaps(), []);
    expect(update.mock.calls[0][1].equippedOutfit).toEqual({ 'char-local': { ...empty, hair: ['bob'] } });
  });
});
