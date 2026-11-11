/**
 * @jest-environment node
 *
 * Refactor 4.13 (queue and query translator), against a real in-memory SQLite
 * database. The repositories' collections are real `SQLiteCollection`s over
 * tables built from the Zod schemas, so every filter here runs as SQL — the
 * mocked-collection suites are how these defects survived.
 *
 *   - #192: memory text search with punctuation, `%` and `_` in the query.
 *   - #194: DEAD jobs are stamped `completedAt` and reaped; a stuck job at its
 *     last attempt goes to DEAD, not FAILED.
 *   - An embedding job's write lands only if the chunk still holds the text
 *     it embedded (a re-render in between must not get the old vector).
 *   - A sort on a field that is not a column throws instead of returning
 *     unsorted rows, and `safeQuery`'s fallback does not hide it.
 */

import path from 'path';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { z } from 'zod';

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

let mockDb: DatabaseType;
const mockSchemas = new Map<string, z.ZodType>();

jest.mock('@/lib/database/manager', () => {
  const { generateDDL, classifySchemaColumns } = jest.requireActual('@/lib/database/schema-translator');
  const { SQLiteCollection } = jest.requireActual('@/lib/database/backends/sqlite/backend');
  return {
    ensureCollection: jest.fn(async (name: string, schema: z.ZodType) => {
      mockSchemas.set(name, schema);
      for (const sql of generateDDL(name, schema)) mockDb.exec(sql);
    }),
    registerBlobColumns: jest.fn(),
    rawQuery: jest.fn(),
    getDatabaseAsync: jest.fn(async () => ({
      getCollection: (name: string) => {
        const { jsonColumns, arrayColumns, booleanColumns } = classifySchemaColumns(name, mockSchemas.get(name));
        return new SQLiteCollection(mockDb, name, jsonColumns, arrayColumns, booleanColumns, ['embedding'], []);
      },
    })),
  };
});

import { BackgroundJobsRepository } from '@/lib/database/repositories/background-jobs.repository';
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository';
import { ConversationChunksRepository } from '@/lib/database/repositories/conversation-chunks.repository';
import { QueryTranslationError } from '@/lib/database/query-translation-error';
import { embeddedTextHash } from '@/lib/embedding/embedded-text-hash';

// The jest moduleNameMapper mocks bare `better-sqlite3`; require the real
// binding by absolute path so this suite runs actual SQL.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const USER = '11111111-1111-4111-8111-111111111111';
const CHARACTER = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  mockDb = new Database(':memory:');
  mockSchemas.clear();
});

afterEach(() => mockDb.close());

function newJob(repo: BackgroundJobsRepository, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return repo.create({
    userId: USER,
    type: 'TITLE_UPDATE',
    status: 'PENDING',
    payload: { chatId: 'c1' },
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    scheduledAt: now,
    startedAt: null,
    completedAt: null,
    ...overrides,
  } as Parameters<BackgroundJobsRepository['create']>[0]);
}

describe('finished jobs are reaped (#194)', () => {
  it('every path to DEAD stamps completedAt, so the reaper takes the row', async () => {
    const repo = new BackgroundJobsRepository();
    const exhausted = await newJob(repo, { attempts: 3 });
    const cancelled = await newJob(repo);
    const superseded = await newJob(repo, { type: 'EMBEDDING_GENERATE', payload: { entityId: 'e1' } });

    await repo.markFailed(exhausted.id, 'boom');
    await repo.cancel(cancelled.id);
    await repo.cancelByType('EMBEDDING_GENERATE');

    for (const id of [exhausted.id, cancelled.id, superseded.id]) {
      const job = await repo.findById(id);
      expect(job?.status).toBe('DEAD');
      expect(job?.completedAt).toEqual(expect.any(String));
    }

    const future = new Date(Date.now() + 60_000);
    const reaped = await repo.cleanupOldJobsByStatus(future, future);
    expect(reaped.dead).toBe(3);
    expect(await repo.findById(exhausted.id)).toBeNull();
  });

  it('a retry is not finished: FAILED with attempts left keeps completedAt null', async () => {
    const repo = new BackgroundJobsRepository();
    const job = await newJob(repo, { attempts: 1 });
    await repo.markFailed(job.id, 'transient');
    const after = await repo.findById(job.id);
    expect(after?.status).toBe('FAILED');
    expect(after?.completedAt ?? null).toBeNull();
  });

  it('resetStuckJobs sends a job at its last attempt to DEAD and the rest to FAILED', async () => {
    const repo = new BackgroundJobsRepository();
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const last = await newJob(repo, { status: 'PROCESSING', attempts: 3, startedAt: longAgo });
    const retry = await newJob(repo, { status: 'PROCESSING', attempts: 1, startedAt: longAgo });

    expect(await repo.resetStuckJobs(10)).toBe(2);
    const lastAfter = await repo.findById(last.id);
    expect(lastAfter?.status).toBe('DEAD');
    expect(lastAfter?.completedAt).toEqual(expect.any(String));
    expect((await repo.findById(retry.id))?.status).toBe('FAILED');
  });

  it('findAbsorbers reads by status and payload field, past any row window', async () => {
    const repo = new BackgroundJobsRepository();
    for (let i = 0; i < 120; i++) await newJob(repo, { payload: { chatId: `other-${i}` } });
    const target = await newJob(repo, { payload: { chatId: 'c1' } });
    await newJob(repo, { status: 'PROCESSING', payload: { chatId: 'c1' } });

    const pending = await repo.findAbsorbers('TITLE_UPDATE', ['PENDING'], { userId: USER, payloadField: 'chatId', payloadValue: 'c1' });
    expect(pending.map(j => j.id)).toEqual([target.id]);
    const active = await repo.findAbsorbers('TITLE_UPDATE', ['PENDING', 'PROCESSING'], { payloadField: 'chatId', payloadValue: 'c1' });
    expect(active).toHaveLength(2);
  });
});

describe('memory text search is literal (#192)', () => {
  async function seed(repo: MemoriesRepository, content: string, keywords: string[] = []) {
    return repo.create({
      characterId: CHARACTER,
      content,
      summary: content,
      keywords,
      tags: [],
      importance: 0.5,
      source: 'MANUAL',
    } as unknown as Parameters<MemoriesRepository['create']>[0]);
  }

  it('finds punctuation, % and _ as typed', async () => {
    const repo = new MemoriesRepository();
    const darcy = await seed(repo, 'Mr. Darcy (the elder) came to Pemberley');
    const plain = await seed(repo, 'Mrs Darcy stayed home');
    const percent = await seed(repo, 'The wager was 100% certain', ['odds_on']);

    expect((await repo.searchByContent(CHARACTER, 'Mr. Darcy (the elder)')).map(m => m.id)).toEqual([darcy.id]);
    // A `.` used to be a one-character wildcard and match "Mrs".
    expect((await repo.searchByContent(CHARACTER, 'Mr.')).map(m => m.id)).toEqual([darcy.id]);
    expect((await repo.searchByContent(CHARACTER, '100%')).map(m => m.id)).toEqual([percent.id]);
    expect(await repo.countMemoriesWithText(CHARACTER, null, 'odds_on')).toBe(1);
    expect(await repo.countMemoriesWithText(CHARACTER, null, 'odds-on')).toBe(0);
    expect((await repo.findMemoriesWithText(CHARACTER, null, 'darcy')).map(m => m.id).sort())
      .toEqual([darcy.id, plain.id].sort());
  });
});

describe('a sort on a field that is not a column', () => {
  it('throws through a safeQuery fallback instead of looking like "no rows"', async () => {
    const repo = new MemoriesRepository();
    await expect(
      repo.findByCharacterIdPaginated(CHARACTER, { limit: 10, offset: 0, sortBy: 'notAColumn' })
    ).rejects.toThrow(QueryTranslationError);
  });
});

describe('an embedding write is conditional on the text it embedded', () => {
  it('applies to unchanged text, skips rewritten or deleted chunks', async () => {
    const repo = new ConversationChunksRepository();
    const chunk = await repo.create({
      chatId: '66666666-6666-4666-8666-666666666666',
      interchangeIndex: 0,
      content: 'old text',
      participantNames: [],
      messageIds: [],
      embedding: null,
    });
    const embeddedHash = embeddedTextHash('old text');

    // A re-render rewrites the chunk while the job is out at the provider.
    await repo.update(chunk.id, { content: 'new text' });
    expect(await repo.updateEmbedding(chunk.id, new Float32Array([1, 0]), { expectedTextHash: embeddedHash })).toBe(false);
    expect((await repo.findById(chunk.id))?.embedding ?? null).toBeNull();

    // The job the rewrite enqueued embeds the new text and lands.
    expect(await repo.updateEmbedding(chunk.id, new Float32Array([0, 1]), { expectedTextHash: embeddedTextHash('new text') })).toBe(true);
    expect(Array.from((await repo.findById(chunk.id))!.embedding!)).toEqual([0, 1]);

    // A chunk deleted in the meantime is skipped, not an apply failure.
    await repo.delete(chunk.id);
    await expect(repo.updateEmbedding(chunk.id, new Float32Array([1, 1]), { expectedTextHash: embeddedHash })).resolves.toBe(false);
  });
});
