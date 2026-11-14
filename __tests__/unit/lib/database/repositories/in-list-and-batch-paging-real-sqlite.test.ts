/**
 * @jest-environment node
 *
 * Against a real in-memory SQLite database:
 *
 *   - #205: an `$in` over more ids than SQLite's 32,766-variable limit returns
 *     the matching rows instead of throwing `too many SQL variables` into a
 *     `safeQuery` fallback that reads as "no rows".
 *   - #204: `findByCharacterIdInBatches` walks the whole corpus — past a row
 *     that fails validation, without skipping a row inserted mid-walk — and a
 *     read failure throws rather than ending the walk.
 */

import path from 'path';
import { randomUUID } from 'crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { z } from 'zod';

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

let mockDb: DatabaseType;
const mockSchemas = new Map<string, z.ZodType>();
let failReads = false;

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
    getDatabaseAsync: jest.fn(async () => {
      if (failReads) throw new Error('database is locked');
      return {
        getCollection: (name: string) => {
          const { jsonColumns, arrayColumns, booleanColumns } = classifySchemaColumns(name, mockSchemas.get(name));
          return new SQLiteCollection(mockDb, name, jsonColumns, arrayColumns, booleanColumns, ['embedding'], []);
        },
      };
    }),
  };
});

jest.mock('@/lib/database/backends/sqlite/llm-logs-guard', () => ({
  requireLLMLogsDb: () => mockDb,
}));

import { MemoriesRepository } from '@/lib/database/repositories/memories.repository';
import { LLMLogsRepository } from '@/lib/database/repositories/llm-logs.repository';
import { sqlInList, INLINE_IN_LIST_LIMIT } from '@/lib/database/backends/sqlite/in-list';
import type { Memory, LLMLog } from '@/lib/schemas/types';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const USER = '11111111-1111-4111-8111-111111111111';
const CHARACTER = '55555555-5555-4555-8555-555555555555';
const CHAT = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  mockDb = new Database(':memory:');
  mockSchemas.clear();
  failReads = false;
});

afterEach(() => mockDb.close());

function seedMemory(repo: MemoriesRepository, content: string) {
  return repo.create({
    characterId: CHARACTER,
    content,
    summary: content,
    keywords: [],
    tags: [],
    importance: 0.5,
    source: 'MANUAL',
  } as unknown as Parameters<MemoriesRepository['create']>[0]);
}

const manyIds = (n: number) => Array.from({ length: n }, () => randomUUID());

describe('sqlInList', () => {
  it('keeps placeholders for a short list and binds a long one as one parameter', () => {
    expect(sqlInList(['a', 'b'])).toEqual({ sql: '(?, ?)', params: ['a', 'b'] });
    const long = sqlInList(manyIds(INLINE_IN_LIST_LIMIT + 1));
    expect(long.sql).toBe('(SELECT value FROM json_each(?))');
    expect(long.params).toHaveLength(1);
  });
});

describe('$in past the SQLite variable limit (#205)', () => {
  it('memories.findByIds with 40,000 ids returns every existing one', async () => {
    const repo = new MemoriesRepository();
    const real: Memory[] = [];
    for (let i = 0; i < 5; i++) real.push(await seedMemory(repo, `memory ${i}`));

    const ids = [...manyIds(40_000), ...real.map(m => m.id)];
    const found = await repo.findByIds(ids);

    expect(found.map(m => m.id).sort()).toEqual(real.map(m => m.id).sort());
  });

  it('$nin with 40,000 ids excludes exactly those ids', async () => {
    const repo = new MemoriesRepository();
    const keep = await seedMemory(repo, 'kept');
    const drop = await seedMemory(repo, 'dropped');
    const all = await repo.findByCharacterId(CHARACTER);
    expect(all).toHaveLength(2);

    const collection = await (repo as unknown as { getCollection(): Promise<{ find(f: unknown): Promise<Memory[]> }> }).getCollection();
    const rows = await collection.find({ id: { $nin: [...manyIds(40_000), drop.id] } });
    expect(rows.map(r => r.id)).toEqual([keep.id]);
  });

  it('llmLogs.findAllForChat with 40,000 message ids returns the linked logs', async () => {
    const repo = new LLMLogsRepository();
    const messageId = randomUUID();
    const base = {
      userId: USER,
      type: 'CHAT_MESSAGE',
      provider: 'openai',
      modelName: 'gpt-4o',
      request: { messageCount: 1, messages: [], temperature: null, maxTokens: null, toolCount: 0 },
      response: { content: 'Hello', contentLength: 5, error: null },
      usage: null,
    } as unknown as Omit<LLMLog, 'id' | 'createdAt' | 'updatedAt'>;
    const byMessage = await repo.create({ ...base, messageId });
    const byChat = await repo.create({ ...base, chatId: CHAT });

    const found = await repo.findAllForChat(CHAT, [...manyIds(40_000), messageId]);

    expect(found.map(l => l.id).sort()).toEqual([byMessage.id, byChat.id].sort());
  });
});

describe('findByCharacterIdInBatches walks the whole corpus (#204)', () => {
  async function collect(repo: MemoriesRepository, batchSize: number, between?: () => Promise<void>) {
    const seen: string[] = [];
    for await (const batch of repo.findByCharacterIdInBatches(CHARACTER, batchSize)) {
      seen.push(...batch.map(m => m.id));
      if (between) await between();
    }
    return seen;
  }

  it('an invalid row in the first page does not end the walk', async () => {
    const repo = new MemoriesRepository();
    const valid: string[] = [];
    for (let i = 0; i < 12; i++) valid.push((await seedMemory(repo, `memory ${i}`)).id);
    // Break the lowest-sorting row so it lands in the first page.
    const lowest = [...valid].sort()[0];
    mockDb.prepare('UPDATE memories SET importance = 42 WHERE id = ?').run(lowest);

    const seen = await collect(repo, 5);

    expect(seen.sort()).toEqual(valid.filter(id => id !== lowest).sort());
  });

  it('a row inserted mid-walk below the cursor does not make an existing row skip', async () => {
    const repo = new MemoriesRepository();
    const existing: string[] = [];
    for (let i = 0; i < 12; i++) existing.push((await seedMemory(repo, `memory ${i}`)).id);
    let inserted = false;

    const seen = await collect(repo, 5, async () => {
      if (inserted) return;
      inserted = true;
      // An id that sorts before everything: under OFFSET paging it shifted
      // every later row one place and one was never seen.
      const row = mockDb.prepare('SELECT * FROM memories LIMIT 1').get() as Record<string, unknown>;
      const cols = Object.keys(row);
      mockDb.prepare(
        `INSERT INTO memories (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      ).run(...cols.map(c => (c === 'id' ? '00000000-0000-4000-8000-000000000000' : row[c])));
    });

    for (const id of existing) expect(seen).toContain(id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('a read failure throws instead of ending the walk', async () => {
    const repo = new MemoriesRepository();
    await seedMemory(repo, 'one');
    failReads = true;
    await expect(collect(repo, 5)).rejects.toThrow(/database is locked/);
  });
});
