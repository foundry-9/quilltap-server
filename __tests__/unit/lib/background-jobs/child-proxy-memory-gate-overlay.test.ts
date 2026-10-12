/**
 * Bug 209 — in a background job the memory gate sees its own earlier writes.
 *
 * In the forked child every repository read hits a readonly snapshot and every
 * write is buffered for the parent. Before the per-job memory overlay in
 * `child-repositories-proxy.ts`, a second candidate in the same job could not
 * see the first's buffered row, links or footnotes:
 *
 *   1. two near-identical candidates inserted two rows;
 *   2. two band candidates each wrote the neighbour's `relatedMemoryIds` from
 *      the same snapshot, and the replay kept only the second;
 *   3. two reinforcements each wrote `content` from the same snapshot, and the
 *      replay kept only the second's footnotes.
 *
 * These tests run the real gate (`createMemoryWithGate`) through the real proxy
 * in one job scope, then replay the buffered batch the way the parent does to
 * read the rows as they will stand after commit.
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

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
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
import { createMemoryWithGate } from '@/lib/memory/memory-service';
import { deleteMemoryWithUnlink } from '@/lib/memory/memory-gate';
import { appendCappedFootnotes } from '@/lib/memory/reinforcement-footnotes';
import { calculateReinforcedImportance } from '@/lib/memory/reinforced-importance';
import type { Memory } from '@/lib/schemas/types';
import type { ChildWritePayload } from '@/lib/background-jobs/ipc-types';

const vectorMock = jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock };
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
    bulkDelete: jest.fn(),
    delete: jest.fn(),
    addRelatedMemoryIds: jest.fn(),
    removeRelatedMemoryIds: jest.fn(),
    removeRelatedMemoryIdsForCharacter: jest.fn(),
    appendReinforcementFootnotes: jest.fn(),
    removeConsolidatedMembers: jest.fn(),
    updateTierBulk: jest.fn(),
    findDigestsContainingMembers: jest.fn(async () => []),
    findIdsSupersededByAny: jest.fn(async () => []),
  };
  mockedRepoSource.mockReturnValue({
    memories,
    chatSettings: { findByUserId: jest.fn(async () => null) },
    characters: { findById: jest.fn(async () => null) },
  } as never);
  return memories;
}

/**
 * A vector store whose search answers from a per-call script: each gate
 * search takes the next entry. The scripted ids may name rows this job
 * created, which only the overlay can hydrate.
 */
function installVectorStore(script: Array<(created: string[]) => Array<{ id: string; score: number }>>) {
  const created: string[] = [];
  const store = {
    search: jest.fn(() => (script.shift() ?? (() => []))(created)),
    addVector: jest.fn(async (id: string) => { created.push(id); }),
    hasVector: jest.fn(() => true),
    updateVector: jest.fn(async () => undefined),
    save: jest.fn(async () => undefined),
  };
  vectorMock.getCharacterVectorStore.mockResolvedValue(store);
  return store;
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
    } else if (method === 'removeRelatedMemoryIdsForCharacter') {
      const removing = new Set(a[1] as string[]);
      for (const target of table.values()) {
        if (target.characterId !== a[0]) continue;
        target.relatedMemoryIds = ((target.relatedMemoryIds as string[]) ?? []).filter(id => !removing.has(id));
      }
    } else if (method === 'appendReinforcementFootnotes') {
      const target = table.get(a[1] as string);
      if (target) target.content = appendCappedFootnotes(target.content as string, a[2] as string[]).content;
    } else if (method === 'bulkDelete') {
      for (const id of a[1] as string[]) table.delete(id);
    } else if (method === 'delete') {
      table.delete(a[0] as string);
    }
  }
  return table;
}

const OPTIONS = { userId: 'user-1' };

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

describe('bug 209 — the gate sees its own buffered writes inside one job', () => {
  it('two near-identical candidates make one row with reinforcement count 2', async () => {
    installSnapshot([]);
    installVectorStore([
      () => [],
      // The second candidate's search finds the first's freshly added vector.
      created => created.map(id => ({ id, score: 0.97 })),
    ]);

    const outcomes: string[] = [];
    const writes = await runWithJobScope('job-dup', async () => {
      for (const text of ['Friday keeps the ledger.', 'Friday keeps the ledger!']) {
        const outcome = await createMemoryWithGate(candidate(text), OPTIONS);
        outcomes.push(outcome.action);
      }
      return flushPendingWrites();
    });

    expect(outcomes).toEqual(['INSERT', 'SKIP_NEAR_DUPLICATE']);
    const creates = writes.filter(w => w.method === 'memories.create');
    expect(creates).toHaveLength(1);
    const table = replay([], writes);
    expect(table.size).toBe(1);
    const [only] = Array.from(table.values());
    expect(only.reinforcementCount).toBe(2);
  });

  it('two band candidates against one neighbour leave both links after replay', async () => {
    const neighbour = row({ id: NEIGHBOUR, content: 'Friday keeps the harbour ledger.' });
    installSnapshot([neighbour]);
    installVectorStore([
      () => [{ id: NEIGHBOUR, score: 0.78 }],
      () => [{ id: NEIGHBOUR, score: 0.76 }],
    ]);

    const newIds: string[] = [];
    const writes = await runWithJobScope('job-band', async () => {
      for (const text of ['Friday audits the ledger at dawn.', 'Friday locks the ledger at dusk.']) {
        const outcome = await createMemoryWithGate(candidate(text), OPTIONS);
        expect(outcome.action).toBe('INSERT_RELATED');
        newIds.push(outcome.memory!.id);
      }
      // A later read in the same job sees both links.
      const [seen] = await getChildRepositoriesProxy().memories.findByIds([NEIGHBOUR]);
      expect(seen.relatedMemoryIds).toEqual(newIds);
      return flushPendingWrites();
    });

    const table = replay([neighbour], writes);
    expect(table.get(NEIGHBOUR)!.relatedMemoryIds).toEqual(newIds);
  });

  it('two reinforcements of one row keep both candidates\' footnotes after replay', async () => {
    const existing = row({ id: EXISTING, content: 'Friday keeps the ledger.' });
    installSnapshot([existing]);
    installVectorStore([
      () => [{ id: EXISTING, score: 0.87 }],
      () => [{ id: EXISTING, score: 0.86 }],
    ]);

    const writes = await runWithJobScope('job-reinforce', async () => {
      for (const text of ['Friday keeps the ledger for Marguerite.', 'Friday keeps the ledger in Valparaiso.']) {
        const outcome = await createMemoryWithGate(candidate(text), OPTIONS);
        expect(outcome.action).toBe('REINFORCE');
      }
      return flushPendingWrites();
    });

    const table = replay([existing], writes);
    const committed = table.get(EXISTING)!;
    expect(committed.content).toContain('[+] Marguerite');
    expect(committed.content).toContain('[+] Valparaiso');
    expect(committed.reinforcementCount).toBe(3);
  });

  it('applies buffered increments, patches and deletes to later reads', async () => {
    const existing = row({ id: EXISTING, reinforcementCount: 2, importance: 0.6 });
    const neighbour = row({ id: NEIGHBOUR });
    installSnapshot([existing, neighbour]);

    await runWithJobScope('job-overlay', async () => {
      const repos = getChildRepositoriesProxy();
      await repos.memories.incrementReinforcement(CHAR, EXISTING, '2026-06-01T00:00:00.000Z', 3);
      await repos.memories.updateForCharacter(CHAR, EXISTING, { content: 'Patched.' });
      await repos.memories.bulkDelete(CHAR, [NEIGHBOUR]);

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

describe('bug 231 — two overlapping jobs keep each other\'s links and footnotes', () => {
  it('two jobs each linking a new memory to one neighbour leave both links', async () => {
    const neighbour = row({ id: NEIGHBOUR, content: 'Friday keeps the harbour ledger.' });

    const newIds: string[] = [];
    const batches: ChildWritePayload[][] = [];
    for (const [jobId, text, score] of [
      ['job-a', 'Friday audits the ledger at dawn.', 0.78],
      ['job-b', 'Friday locks the ledger at dusk.', 0.76],
    ] as const) {
      // Both jobs read the same committed snapshot: neither sees the other.
      installSnapshot([neighbour]);
      installVectorStore([() => [{ id: NEIGHBOUR, score }]]);
      batches.push(await runWithJobScope(jobId, async () => {
        const outcome = await createMemoryWithGate(candidate(text), OPTIONS);
        expect(outcome.action).toBe('INSERT_RELATED');
        newIds.push(outcome.memory!.id);
        return flushPendingWrites();
      }));
    }

    // The parent commits the two batches one after the other.
    const table = replay([neighbour], [...batches[0], ...batches[1]]);
    expect(table.get(NEIGHBOUR)!.relatedMemoryIds).toEqual(newIds);
    expect(table.get(newIds[0])!.relatedMemoryIds).toEqual([NEIGHBOUR]);
    expect(table.get(newIds[1])!.relatedMemoryIds).toEqual([NEIGHBOUR]);
  });

  it('two jobs each reinforcing one row leave both footnotes', async () => {
    const existing = row({ id: EXISTING, content: 'Friday keeps the ledger.' });

    const batches: ChildWritePayload[][] = [];
    for (const [jobId, text] of [
      ['job-a', 'Friday keeps the ledger for Marguerite.'],
      ['job-b', 'Friday keeps the ledger in Valparaiso.'],
    ] as const) {
      installSnapshot([existing]);
      installVectorStore([() => [{ id: EXISTING, score: 0.87 }]]);
      batches.push(await runWithJobScope(jobId, async () => {
        const outcome = await createMemoryWithGate(candidate(text), OPTIONS);
        expect(outcome.action).toBe('REINFORCE');
        return flushPendingWrites();
      }));
    }

    const table = replay([existing], [...batches[0], ...batches[1]]);
    const committed = table.get(EXISTING)!;
    expect(committed.content).toContain('[+] Marguerite');
    expect(committed.content).toContain('[+] Valparaiso');
    expect(committed.reinforcementCount).toBe(3);
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
    vectorMock.getCharacterVectorStore.mockResolvedValue({
      removeVector: jest.fn(async () => true),
      save: jest.fn(async () => undefined),
    });

    const writes = await runWithJobScope('job-delete', async () => {
      // In the child the delete is buffered; the replay below is the commit.
      await deleteMemoryWithUnlink(A);
      await deleteMemoryWithUnlink(B);
      const [seen] = await getChildRepositoriesProxy().memories.findByIds([NEIGHBOUR]);
      expect(seen.relatedMemoryIds).toEqual([EXISTING]);
      return flushPendingWrites();
    });

    // No whole-list write of the neighbour: only deltas.
    expect(writes.some(w => w.method === 'memories.updateForCharacter'
      && (w.args[1] === NEIGHBOUR))).toBe(false);
    const table = replay([neighbour, a, b, kept], writes);
    expect(table.has(A)).toBe(false);
    expect(table.has(B)).toBe(false);
    expect(table.get(NEIGHBOUR)!.relatedMemoryIds).toEqual([EXISTING]);
  });
});
