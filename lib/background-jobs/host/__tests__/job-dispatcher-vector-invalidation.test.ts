/**
 * Bug 217: after a child batch commits, the dispatcher drops the cached
 * vector store of every character whose memories or vectors the batch
 * changed — keyed by character id however the write method names it, with
 * memory-id-keyed writes resolved to their owners before commit.
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

const unloadStore = jest.fn();
jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: () => ({ unloadStore }),
}));

describe('vectorStoreKeysForWrites', () => {
  it('keys memories.bulkDelete on its characterId argument', () => {
    const keys = vectorStoreKeysForWrites([{ method: 'memories.bulkDelete', args: ['charA', ['m1', 'm2']] }]);
    expect(Array.from(keys)).toEqual(['charA']);
  });

  it('collects every touched character across shapes', () => {
    const writes: ChildWritePayload[] = [
      { method: 'memories.create', args: [{ characterId: 'charA', content: 'x' }] },
      { method: 'memories.updateForCharacter', args: ['charB', 'm3', {}] },
      { method: 'vectorIndices.addEntries', args: [[{ id: 'm4', characterId: 'charC' }, { id: 'm5', characterId: 'charA' }]] },
      { method: 'memories.updateTierBulk', args: ['charD', ['m6'], 'cold'] },
    ];
    expect(Array.from(vectorStoreKeysForWrites(writes)).sort()).toEqual(['charA', 'charB', 'charC', 'charD']);
  });

  it('resolves memory-id-keyed writes through the owner map, never keying on the memory id', () => {
    const writes: ChildWritePayload[] = [
      { method: 'memories.delete', args: ['m1'] },
      { method: 'vectorIndices.updateEntryEmbedding', args: ['m2', new Float32Array([1])] },
      { method: 'vectorIndices.removeEntries', args: [['m3']] },
    ];
    expect(memoryIdsNeedingOwnerLookup(writes).sort()).toEqual(['m1', 'm2', 'm3']);
    const keys = vectorStoreKeysForWrites(writes, new Map([['m1', 'charA'], ['m2', 'charB'], ['m3', 'charA']]));
    expect(Array.from(keys).sort()).toEqual(['charA', 'charB']);
    // Unresolved: nothing (and in particular not the memory id).
    expect(vectorStoreKeysForWrites(writes).size).toBe(0);
  });

  it('touches nothing for a batch without memory or vector writes', () => {
    const writes: ChildWritePayload[] = [
      { method: 'chats.update', args: ['chat-1', {}] },
      { method: 'memories.updateAccessTimeBulk', args: ['charA', ['m1']] },
    ];
    expect(vectorStoreKeysForWrites(writes).size).toBe(0);
  });
});

describe('applyWritesUnsafe — vector-store invalidation after commit', () => {
  const fakeDb = (ownerRows: Array<{ id: string; characterId: string }> = []) => ({
    exec: jest.fn(),
    prepare: jest.fn(() => ({ all: jest.fn(() => ownerRows) })),
  });

  function repos() {
    const write = () => jest.fn(() => Promise.resolve(1));
    return {
      memories: { bulkDelete: write(), delete: write(), create: write() },
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

  it('a batch of only memories.bulkDelete(charA) drops charA', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    await applyWritesUnsafe('job-1', [{ method: 'memories.bulkDelete', args: ['charA', ['m1']] }], 'MEMORY_HOUSEKEEPING');
    expect(vectorNotifications()).toEqual(['charA']);
    await new Promise((r) => setImmediate(r));
    expect(unloadStore).toHaveBeenCalledWith('charA');
  });

  it('a batch touching charA and charB drops both, resolving memories.delete to its owner', async () => {
    const db = fakeDb([{ id: 'm9', characterId: 'charB' }]);
    jest.mocked(getRawDatabase).mockReturnValue(db as never);
    await applyWritesUnsafe(
      'job-2',
      [
        { method: 'memories.bulkDelete', args: ['charA', ['m1']] },
        { method: 'memories.delete', args: ['m9'] },
      ],
      'MEMORY_HOUSEKEEPING',
    );
    // The owner was read before the batch committed.
    const firstPrepare = db.prepare.mock.invocationCallOrder[0];
    const firstCommit = db.exec.mock.invocationCallOrder[db.exec.mock.calls.findIndex((c) => c[0] === 'COMMIT')];
    expect(firstPrepare).toBeLessThan(firstCommit);
    expect(vectorNotifications()).toEqual(['charA', 'charB']);
  });

  it('a batch with no memories.* write drops none', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    await applyWritesUnsafe('job-3', [{ method: 'chats.update', args: ['chat-1', {}] }], 'TITLE_UPDATE');
    expect(vectorNotifications()).toEqual([]);
  });
});
