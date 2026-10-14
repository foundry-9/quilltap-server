/**
 * Bug 217: after a child batch commits, the dispatcher drops the cached
 * memory index (`memoryIndex.reload`) of every character whose memory rows,
 * vectors or tiers the batch changed — keyed by character id however the
 * write method names it, with memory-id-keyed writes resolved to their owners
 * before commit. Since Phase B of the memory refactor the rows are the index:
 * only `memories.*` writes count (the `vectorIndices.*` mirror is retired).
 */

import { applyWritesUnsafe } from '../job-dispatcher';
import {
  memoryIdsNeedingOwnerLookup,
  vectorStoreKeysForWrites,
} from '../vector-store-invalidation';
import { notifyChild } from '../processor-host';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import type { ChildWritePayload } from '../../ipc-types';

jest.mock('@/lib/database/backends/sqlite/client', () => ({ getRawDatabase: jest.fn() }));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({ getRawMountIndexDatabase: jest.fn() }));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({ getRawLLMLogsDatabase: jest.fn() }));
jest.mock('../processor-host', () => ({ sendToChild: jest.fn(() => true), notifyChild: jest.fn() }));

const reload = jest.fn();
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { reload: (characterId: string) => reload(characterId) },
}));

describe('vectorStoreKeysForWrites', () => {
  it('keys memories.bulkDeleteUnsafe on its characterId argument', () => {
    const keys = vectorStoreKeysForWrites([{ method: 'memories.bulkDeleteUnsafe', args: ['charA', ['m1', 'm2']] }]);
    expect(Array.from(keys)).toEqual(['charA']);
  });

  it('collects every touched character across shapes', () => {
    const writes: ChildWritePayload[] = [
      { method: 'memories.create', args: [{ characterId: 'charA', content: 'x' }] },
      { method: 'memories.updateForCharacter', args: ['charB', 'm3', {}] },
      { method: 'memories.upsert', args: [{ id: 'm4', characterId: 'charC' }] },
      { method: 'memories.updateTierBulk', args: ['charD', ['m6'], 'cold'] },
      { method: 'memories.bulkDeleteUnsafe', args: ['charE', ['m7']] },
    ];
    expect(Array.from(vectorStoreKeysForWrites(writes)).sort()).toEqual(['charA', 'charB', 'charC', 'charD', 'charE']);
  });

  it('resolves memory-id-keyed writes through the owner map, never keying on the memory id', () => {
    const writes: ChildWritePayload[] = [
      { method: 'memories.update', args: ['m1', { embedding: [1] }] },
      { method: 'memories.update', args: ['m2', { tier: 'cold' }] },
    ];
    expect(memoryIdsNeedingOwnerLookup(writes).sort()).toEqual(['m1', 'm2']);
    const keys = vectorStoreKeysForWrites(writes, new Map([['m1', 'charA'], ['m2', 'charB']]));
    expect(Array.from(keys).sort()).toEqual(['charA', 'charB']);
    // Unresolved: nothing (and in particular not the memory id).
    expect(vectorStoreKeysForWrites(writes).size).toBe(0);
  });

  it('no longer keys the retired mirror or the removed delete methods', () => {
    const writes: ChildWritePayload[] = [
      { method: 'vectorIndices.addEntries', args: [[{ id: 'm4', characterId: 'charC' }]] },
      { method: 'vectorIndices.removeEntries', args: [['m3']] },
      { method: 'memories.bulkDelete', args: ['charA', ['m1']] },
      { method: 'memories.delete', args: ['m9'] },
      { method: 'memories.deleteForCharacter', args: ['charB', 'm9'] },
    ];
    expect(vectorStoreKeysForWrites(writes, new Map([['m9', 'charB'], ['m3', 'charC']])).size).toBe(0);
    expect(memoryIdsNeedingOwnerLookup(writes)).toEqual([]);
  });

  it('touches nothing for a batch without memory or vector writes', () => {
    const writes: ChildWritePayload[] = [
      { method: 'chats.update', args: ['chat-1', {}] },
      { method: 'memories.updateAccessTimeBulk', args: ['charA', ['m1']] },
    ];
    expect(vectorStoreKeysForWrites(writes).size).toBe(0);
  });

  it('a reinforcement-only write changes no vector or tier, so it touches nothing', () => {
    // The store caches only memoryId / characterId / tier — reinforcement
    // count and reinforced importance never reach it.
    const writes: ChildWritePayload[] = [
      { method: 'memories.incrementReinforcement', args: ['charA', 'm1', '2026-10-12T00:00:00.000Z', 1] },
    ];
    expect(vectorStoreKeysForWrites(writes).size).toBe(0);
    expect(memoryIdsNeedingOwnerLookup(writes)).toEqual([]);
  });
});

describe('applyWritesUnsafe — memory-index invalidation after commit', () => {
  const fakeDb = (ownerRows: Array<{ id: string; characterId: string }> = []) => ({
    exec: jest.fn(),
    prepare: jest.fn(() => ({ all: jest.fn(() => ownerRows) })),
  });

  function repos() {
    const write = () => jest.fn(() => Promise.resolve(1));
    return {
      memories: {
        bulkDeleteUnsafe: write(),
        update: write(),
        create: write(),
        updateTierBulk: write(),
        incrementReinforcement: write(),
      },
      chats: { update: write() },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getRawMountIndexDatabase).mockReturnValue(fakeDb() as never);
    jest.mocked(getRawLLMLogsDatabase).mockReturnValue(fakeDb() as never);
    jest.mocked(getRepositories).mockReturnValue(repos() as never);
  });

  function vectorNotifications(): string[] {
    return jest
      .mocked(notifyChild)
      .mock.calls.filter((c) => c[0] === 'vectorStore')
      .map((c) => c[1] as string)
      .sort();
  }

  it('a batch of only memories.bulkDeleteUnsafe(charA) reloads charA', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    await applyWritesUnsafe('job-1', [{ method: 'memories.bulkDeleteUnsafe', args: ['charA', ['m1']] }], 'MEMORY_MAINTENANCE');
    expect(vectorNotifications()).toEqual(['charA']);
    await new Promise((r) => setImmediate(r));
    expect(reload).toHaveBeenCalledWith('charA');
  });

  it('a batch touching two characters\' memories reloads exactly those two', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    await applyWritesUnsafe(
      'job-5',
      [
        { method: 'memories.create', args: [{ characterId: 'charA', content: 'x' }] },
        { method: 'memories.updateTierBulk', args: ['charB', ['m2'], 'cold'] },
        { method: 'memories.bulkDeleteUnsafe', args: ['charA', ['m3']] },
        { method: 'chats.update', args: ['chat-1', {}] },
      ],
      'MEMORY_MAINTENANCE',
    );
    await new Promise((r) => setImmediate(r));
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload.mock.calls.map((c) => c[0]).sort()).toEqual(['charA', 'charB']);
    expect(vectorNotifications()).toEqual(['charA', 'charB']);
  });

  it('a batch touching charA and charB drops both, resolving memories.update to its owner', async () => {
    const db = fakeDb([{ id: 'm9', characterId: 'charB' }]);
    jest.mocked(getRawDatabase).mockReturnValue(db as never);
    await applyWritesUnsafe(
      'job-2',
      [
        { method: 'memories.bulkDeleteUnsafe', args: ['charA', ['m1']] },
        { method: 'memories.update', args: ['m9', { tier: 'cold' }] },
      ],
      'MEMORY_MAINTENANCE',
    );
    // The owner was read before the batch committed.
    const firstPrepare = db.prepare.mock.invocationCallOrder[0];
    const firstCommit = db.exec.mock.invocationCallOrder[db.exec.mock.calls.findIndex((c) => c[0] === 'COMMIT')];
    expect(firstPrepare).toBeLessThan(firstCommit);
    expect(vectorNotifications()).toEqual(['charA', 'charB']);
    await new Promise((r) => setImmediate(r));
    expect(reload.mock.calls.map((c) => c[0]).sort()).toEqual(['charA', 'charB']);
  });

  it('resolves memories.update owners on a migrated database with no vector_entries table', async () => {
    // Real binding by absolute root path — a bare require resolves to the suite-wide mock.
    const Database = require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'));
    const db = new Database(':memory:');
    db.exec('CREATE TABLE memories (id TEXT PRIMARY KEY, characterId TEXT)');
    db.prepare('INSERT INTO memories (id, characterId) VALUES (?, ?)').run('m9', 'charB');
    jest.mocked(getRawDatabase).mockReturnValue(db as never);
    try {
      await applyWritesUnsafe('job-6', [{ method: 'memories.update', args: ['m9', { tier: 'cold' }] }], 'MEMORY_MAINTENANCE');
      expect(vectorNotifications()).toEqual(['charB']);
      await new Promise((r) => setImmediate(r));
      expect(reload).toHaveBeenCalledWith('charB');
    } finally {
      db.close();
    }
  });

  it('a reinforcement-only batch leaves the store loaded', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    await applyWritesUnsafe(
      'job-4',
      [{ method: 'memories.incrementReinforcement', args: ['charA', 'm1', '2026-10-12T00:00:00.000Z', 1] }],
      'MEMORY_EXTRACTION',
    );
    expect(vectorNotifications()).toEqual([]);
    await new Promise((r) => setImmediate(r));
    expect(reload).not.toHaveBeenCalled();
  });

  it('a batch with no memories.* write drops none', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    await applyWritesUnsafe('job-3', [{ method: 'chats.update', args: ['chat-1', {}] }], 'TITLE_UPDATE');
    expect(vectorNotifications()).toEqual([]);
    await new Promise((r) => setImmediate(r));
    expect(reload).not.toHaveBeenCalled();
  });
});
