/**
 * @jest-environment node
 *
 * #207 — the find-then-create upserts behind `embedding_status` and
 * `chat_settings`, against a real in-memory SQLite database:
 *
 *   - concurrent upserts for one key leave one row and no error, whether or not
 *     the table carries its unique constraint (tables built from the Zod schema
 *     by generateDDL do not);
 *   - a lost race on the constraint resolves to the winning row;
 *   - a failed read throws instead of reading as "no row" and inserting.
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
          return new SQLiteCollection(mockDb, name, jsonColumns, arrayColumns, booleanColumns, [], []);
        },
      };
    }),
  };
});

import { EmbeddingStatusRepository } from '@/lib/database/repositories/embedding-status.repository';
import { ChatSettingsRepository } from '@/lib/database/repositories/chat-settings.repository';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const USER = '11111111-1111-4111-8111-111111111111';
const ENTITY = '22222222-2222-4222-8222-222222222222';
const PROFILE = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  mockDb = new Database(':memory:');
  mockSchemas.clear();
  failReads = false;
});

afterEach(() => mockDb.close());

const rowCount = (table: string) =>
  (mockDb.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;

describe('embedding_status upserts (#207)', () => {
  it('interleaved marks for one entity leave one row and no error (no constraint)', async () => {
    const repo = new EmbeddingStatusRepository();
    await Promise.all([
      repo.markAsEmbedded('MEMORY', ENTITY, PROFILE, USER),
      repo.markAsEmbedded('MEMORY', ENTITY, PROFILE, USER),
      repo.markAsFailed('MEMORY', ENTITY, PROFILE, 'boom', USER),
    ]);

    expect(rowCount('embedding_status')).toBe(1);
    expect((await repo.findByEntity('MEMORY', ENTITY, PROFILE))?.status).toBe('FAILED');
  });

  it('a lost race on the unique constraint resolves to the winning row', async () => {
    const repo = new EmbeddingStatusRepository();
    await repo.markAsFailed('MEMORY', ENTITY, PROFILE, 'first', USER);
    mockDb.exec(
      'CREATE UNIQUE INDEX "ux_embedding_status_entity" ON "embedding_status" ("entityType", "entityId", "profileId")'
    );
    // The read misses the row another writer committed a moment ago.
    jest.spyOn(repo as any, 'findByEntityStrict').mockResolvedValueOnce(null);

    const result = await repo.markAsEmbedded('MEMORY', ENTITY, PROFILE, USER);

    expect(result?.status).toBe('EMBEDDED');
    expect(rowCount('embedding_status')).toBe(1);
  });

  it('a failed read throws instead of inserting', async () => {
    const repo = new EmbeddingStatusRepository();
    await repo.markAsFailed('MEMORY', ENTITY, PROFILE, 'first', USER);
    failReads = true;

    await expect(repo.markAsEmbedded('MEMORY', ENTITY, PROFILE, USER)).rejects.toThrow(/database is locked/);

    failReads = false;
    expect(rowCount('embedding_status')).toBe(1);
  });
});

describe('chat_settings upserts (#207)', () => {
  it('concurrent first saves on a table without the constraint leave one row', async () => {
    const repo = new ChatSettingsRepository();
    await Promise.all([
      repo.updateForUser(USER, { avatarDisplayMode: 'NEVER' }),
      repo.updateForUser(USER, { avatarDisplayStyle: 'RECTANGULAR' }),
    ]);

    expect(rowCount('chat_settings')).toBe(1);
    const settings = await repo.findByUserId(USER);
    expect(settings?.avatarDisplayMode).toBe('NEVER');
    expect(settings?.avatarDisplayStyle).toBe('RECTANGULAR');
  });

  it('a failed read throws instead of minting a second row', async () => {
    const repo = new ChatSettingsRepository();
    await repo.updateForUser(USER, { avatarDisplayMode: 'NEVER' });
    failReads = true;

    await expect(repo.updateForUser(USER, { avatarDisplayMode: 'ALWAYS' })).rejects.toThrow(/database is locked/);

    failReads = false;
    expect(rowCount('chat_settings')).toBe(1);
  });
});
