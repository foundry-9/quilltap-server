/**
 * Import reconciliation of a chat's scenario source. Chats are imported
 * before the document stores, so the source's mount id can only be re-pointed
 * once the stores have landed — here. A source whose store came across follows
 * it; one whose store is already in this instance stays; one whose store is
 * nowhere is dropped to null rather than left dangling.
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

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const SOURCE = { mountPointId: OLD, path: 'Scenarios/tea.md', bodySha256: 'c'.repeat(64) };

function makeIdMaps(mountPoints: Map<string, string>): any {
  return {
    tags: new Map(),
    characters: new Map(),
    chats: new Map([['chat-old', 'chat-new']]),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints,
    docMountFileLinks: new Map(),
    characterVaultMounts: new Map(),
    skippedCharacterVaults: new Set(),
    preserveIdsSkips: new Set(),
    wardrobeItems: new Map(),
    messages: new Map(),
  };
}

function setup(existingMounts: string[]) {
  const chat = { id: 'chat-new', participants: [], tags: [], scenarioSource: SOURCE, scenarioText: 'Tea.' };
  const update = jest.fn().mockResolvedValue(chat);
  const repos = {
    characters: { findById: jest.fn().mockResolvedValue(null), update: jest.fn() },
    chats: { findById: jest.fn().mockResolvedValue(chat), update },
    projects: { findById: jest.fn().mockResolvedValue(null) },
    groups: { findById: jest.fn().mockResolvedValue(null) },
  } as any;
  (getRepositories as jest.Mock).mockReturnValue({
    docMountPoints: {
      findById: jest.fn(async (id: string) => (existingMounts.includes(id) ? { id } : null)),
      findAll: jest.fn(async () => []),
      update: jest.fn(),
    },
  });
  return { repos, update };
}

beforeEach(() => jest.clearAllMocks());

describe('reconcileRelationships — chat scenario source', () => {
  it('follows the store to its imported id', async () => {
    const { repos, update } = setup([NEW]);
    await reconcileRelationships('user-1', repos, makeIdMaps(new Map([[OLD, NEW]])), []);
    expect(update).toHaveBeenCalledWith('chat-new', expect.objectContaining({ scenarioSource: { ...SOURCE, mountPointId: NEW } }));
  });

  it('keeps a source whose store already lives in this instance', async () => {
    const { repos, update } = setup([OLD]);
    await reconcileRelationships('user-1', repos, makeIdMaps(new Map()), []);
    expect(update).not.toHaveBeenCalledWith('chat-new', expect.objectContaining({ scenarioSource: expect.anything() }));
  });

  it('drops a source whose store did not come across', async () => {
    const { repos, update } = setup([]);
    await reconcileRelationships('user-1', repos, makeIdMaps(new Map()), []);
    expect(update).toHaveBeenCalledWith('chat-new', expect.objectContaining({ scenarioSource: null }));
  });
});
