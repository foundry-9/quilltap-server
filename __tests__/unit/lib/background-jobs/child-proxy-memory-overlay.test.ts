/**
 * The job child's memory read-your-writes overlay (bug 209).
 *
 * In the forked child every repository read hits a readonly snapshot and every
 * write is buffered for the parent. Admission no longer writes from the child
 * (it runs in the parent over host-RPC since memory refactor Phase C — see
 * admission-host-rpc.test.ts), but consolidation, housekeeping, the fold passes
 * and `retireMemories` still buffer memory writes there, and a later read in
 * the same job must see them. These tests drive the real proxy in one job
 * scope, then replay the buffered batch the way the parent does to read the
 * rows as they will stand after commit.
 */

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));

// The gate reaches the vector cache only through `memoryIndex`, which asks the
// store manager for the character's store.
jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn(),
  isHotVector: jest.fn(() => true),
}));

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  cosineSimilarity: jest.fn(() => 0),
  EmbeddingError: class extends Error {},
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () =>
    require('@/lib/background-jobs/child/child-repositories-proxy').getChildRepositoriesProxy(),
}));

jest.mock('@/lib/background-jobs/host/processor-host', () => ({
  sendToChild: jest.fn(() => true),
  notifyChild: jest.fn(),
}));

import { getRepositories as mockedRealRepositories } from '@/lib/database/repositories';
import {
  runWithJobScope,
  flushPendingWrites,
  getChildRepositoriesProxy,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy';
import { retireMemories } from '@/lib/memory/retire';
import { rawQuery } from '@/lib/database/manager';
import { appendCappedFootnotes } from '@/lib/memory/reinforcement-footnotes';
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance';
import type { Memory } from '@/lib/schemas/types';
import type { ChildWritePayload } from '@/lib/background-jobs/ipc-types';

const vectorMock = jest.requireMock('@/lib/embedding/vector-store') as { getVectorStoreManager: jest.Mock };
const mockedRawQuery = rawQuery as jest.MockedFunction<typeof rawQuery>;

/** Hand the index this store for every character, loaded. */
function installStore(store: Record<string, unknown>) {
  vectorMock.getVectorStoreManager.mockReturnValue({
    getStore: jest.fn(async () => store),
    getLoadedStore: jest.fn(async () => store),
    unloadStore: jest.fn(() => true),
    unloadAll: jest.fn(),
  });
}
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock };
const mockedRepoSource = mockedRealRepositories as jest.MockedFunction<typeof mockedRealRepositories>;

const CHAR = '11111111-1111-4111-8111-111111111111';
const NEIGHBOUR = '22222222-2222-4222-8222-222222222222';
const EXISTING = '33333333-3333-4333-8333-333333333333';
const EMBEDDING = new Float32Array([0.6, 0.8]);

function row(overrides: Partial<Memory>): Memory {
  return {
    id: EXISTING,
    characterId: CHAR,
    content: 'Friday keeps the ledger.',
    summary: 'Friday keeps the ledger.',
    keywords: [],
    tags: [],
    importance: 0.6,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: 0.6,
    tier: 'hot',
    consolidatedFrom: [],
    entities: [],
    kind: 'semantic',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory;
}

/**
 * The committed snapshot the child reads. Reads are real-repo calls the proxy
 * passes through; writes never reach these mocks.
 */
function installSnapshot(rows: Memory[]) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const memories = {
    findByIds: jest.fn(async (ids: string[]) => ids.map(id => byId.get(id)).filter(Boolean)),
    findById: jest.fn(async (id: string) => byId.get(id) ?? null),
    countHotByCharacterId: jest.fn(async () => 0),
    create: jest.fn(),
    updateForCharacter: jest.fn(),
    incrementReinforcement: jest.fn(),
    bulkDeleteUnsafe: jest.fn(),
    addRelatedMemoryIds: jest.fn(),
    removeRelatedMemoryIds: jest.fn(),
    removeRelatedMemoryIdsEverywhere: jest.fn(),
    appendReinforcementFootnotes: jest.fn(),
    removeConsolidatedMembers: jest.fn(),
    updateTierBulk: jest.fn(),
    findDigestsContainingMembers: jest.fn(async () => []),
    findIdsSupersededByAny: jest.fn(async () => []),
  };
  // `retireMemories` resolves the rows it retires with raw SQL against the
  // committed snapshot (not through the overlay).
  mockedRawQuery.mockImplementation((async (_sql: string, params: string[] = []) =>
    params
      .map(id => byId.get(id))
      .filter((r): r is Memory => !!r)
      .map(r => ({
        id: r.id,
        characterId: r.characterId,
        source: r.source,
        tier: r.tier ?? 'hot',
        aboutCharacterId: r.aboutCharacterId ?? null,
        consolidatedFrom: JSON.stringify(r.consolidatedFrom ?? []),
        supersededById: r.supersededById ?? null,
      }))) as never);
  mockedRepoSource.mockReturnValue({
    memories,
    chatSettings: { findByUserId: jest.fn(async () => null) },
    characters: { findById: jest.fn(async () => null) },
  } as never);
  return memories;
}

/**
 * Replay a buffered batch the way the parent does — in order, against a
 * read-write store — and return the rows as committed.
 */
function replay(snapshot: Memory[], writes: ChildWritePayload[]): Map<string, Record<string, unknown>> {
  const table = new Map<string, Record<string, unknown>>(snapshot.map(r => [r.id, { ...r }]));
  for (const w of writes) {
    const [, method] = w.method.split('.');
    const a = w.args as unknown[];
    if (method === 'create') {
      const options = a[1] as { id: string };
      table.set(options.id, { relatedMemoryIds: [], reinforcementCount: 1, ...(a[0] as object), id: options.id });
    } else if (method === 'updateForCharacter') {
      const target = table.get(a[1] as string);
      if (target) Object.assign(target, a[2]);
    } else if (method === 'incrementReinforcement') {
      const target = table.get(a[1] as string);
      if (target) {
        target.reinforcementCount = ((target.reinforcementCount as number) ?? 1) + ((a[3] as number) ?? 1);
      }
    } else if (method === 'addRelatedMemoryIds') {
      // The repository's delta: union against the row as it stands now.
      const target = table.get(a[1] as string);
      if (target) {
        const list = [...((target.relatedMemoryIds as string[]) ?? [])];
        for (const id of a[2] as string[]) if (id !== a[1] && !list.includes(id)) list.push(id);
        target.relatedMemoryIds = list;
      }
    } else if (method === 'removeRelatedMemoryIds') {
      const target = table.get(a[1] as string);
      if (target) {
        const removing = new Set(a[2] as string[]);
        target.relatedMemoryIds = ((target.relatedMemoryIds as string[]) ?? []).filter(id => !removing.has(id));
      }
    } else if (method === 'removeRelatedMemoryIdsEverywhere') {
      const removing = new Set(a[0] as string[]);
      for (const target of table.values()) {
        target.relatedMemoryIds = ((target.relatedMemoryIds as string[]) ?? []).filter(id => !removing.has(id));
      }
    } else if (method === 'appendReinforcementFootnotes') {
      const target = table.get(a[1] as string);
      if (target) target.content = appendCappedFootnotes(target.content as string, a[2] as string[]).content;
    } else if (method === 'bulkDeleteUnsafe') {
      for (const id of a[1] as string[]) table.delete(id);
    }
  }
  return table;
}

function candidate(content: string, extra: Record<string, unknown> = {}) {
  return {
    characterId: CHAR,
    content,
    summary: content,
    keywords: [],
    importance: 0.6,
    source: 'AUTO' as const,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
  process.env.QUILLTAP_JOB_CHILD = '1';
  embedMock.generateEmbeddingForUser.mockResolvedValue({ embedding: EMBEDDING, model: 'test', dimensions: 2 });
});

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD;
});

describe('bug 209 — a job sees its own buffered memory writes', () => {
  it('applies buffered increments, patches and deletes to later reads', async () => {
    const existing = row({ id: EXISTING, reinforcementCount: 2, importance: 0.6 });
    const neighbour = row({ id: NEIGHBOUR });
    installSnapshot([existing, neighbour]);

    await runWithJobScope('job-overlay', async () => {
      const repos = getChildRepositoriesProxy();
      await repos.memories.incrementReinforcement(CHAR, EXISTING, '2026-06-01T00:00:00.000Z', 3);
      await repos.memories.updateForCharacter(CHAR, EXISTING, { content: 'Patched.' });
      await repos.memories.bulkDeleteUnsafe(CHAR, [NEIGHBOUR]);

      const rows = await repos.memories.findByIds([EXISTING, NEIGHBOUR]);
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe('Patched.');
      expect(rows[0].reinforcementCount).toBe(5);
      expect(rows[0].reinforcedImportance).toBeCloseTo(calculateReinforcedImportance(0.6, 5));
      expect(rows[0].lastReinforcedAt).toBe('2026-06-01T00:00:00.000Z');
      expect(await repos.memories.findById(NEIGHBOUR)).toBeNull();
      flushPendingWrites();
    });
  });

  it('the fold pass\'s source-message lookup returns fragments this job created', async () => {
    const snapshot = installSnapshot([]);
    (snapshot as Record<string, unknown>).findByCharacterAndSourceMessageIds = jest.fn(async () => []);

    await runWithJobScope('job-fold', async () => {
      const repos = getChildRepositoriesProxy();
      const created = await repos.memories.create(
        { ...candidate('Friday keeps the ledger.'), sourceMessageId: 'msg-1' } as never,
      );
      const found = await repos.memories.findByCharacterAndSourceMessageIds(CHAR, ['msg-1']);
      expect(found.map(m => m.id)).toEqual([created.id]);
      expect(await repos.memories.findByCharacterAndSourceMessageIds(CHAR, ['msg-2'])).toEqual([]);
      flushPendingWrites();
    });
  });
});

describe('bug 234 — two deletes in one job scrub a shared neighbour of both', () => {
  const A = '44444444-4444-4444-8444-444444444444';
  const B = '55555555-5555-4555-8555-555555555555';

  it('the neighbour lists neither deleted id after replay, and a later read agrees', async () => {
    const neighbour = row({ id: NEIGHBOUR, relatedMemoryIds: [A, B, EXISTING] });
    const a = row({ id: A, relatedMemoryIds: [NEIGHBOUR] });
    const b = row({ id: B, relatedMemoryIds: [NEIGHBOUR] });
    const kept = row({ id: EXISTING, relatedMemoryIds: [NEIGHBOUR] });
    installSnapshot([neighbour, a, b, kept]);
    const removeVector = jest.fn(async () => true);
    installStore({ removeVector });

    const writes = await runWithJobScope('job-delete', async () => {
      // In the child the delete is buffered; the replay below is the commit.
      await retireMemories([A], { reason: 'item-delete' });
      await retireMemories([B], { reason: 'item-delete' });
      const [seen] = await getChildRepositoriesProxy().memories.findByIds([NEIGHBOUR]);
      expect(seen.relatedMemoryIds).toEqual([EXISTING]);
      return flushPendingWrites();
    });

    // No whole-list write of the neighbour: only deltas.
    expect(writes.some(w => w.method === 'memories.updateForCharacter'
      && (w.args[1] === NEIGHBOUR))).toBe(false);
    // Each row went through the one sanctioned delete, and its vector left the cache.
    expect(writes.filter(w => w.method === 'memories.bulkDeleteUnsafe').map(w => w.args))
      .toEqual([[CHAR, [A]], [CHAR, [B]]]);
    expect(removeVector.mock.calls.map(c => (c as unknown[])[0])).toEqual([A, B]);
    const table = replay([neighbour, a, b, kept], writes);
    expect(table.has(A)).toBe(false);
    expect(table.has(B)).toBe(false);
    expect(table.get(NEIGHBOUR)!.relatedMemoryIds).toEqual([EXISTING]);
  });
});
