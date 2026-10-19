/**
 * @jest-environment node
 *
 * `LogEntriesRepository` and the `regexp()` SQL function, against a real
 * in-memory SQLite database standing in for the LLM logs file: the generated
 * table and its extra indexes, the filtered newest-first read, the regex
 * search (and its flags), and retention pruning.
 */

import path from 'path';
import type { Database as DatabaseType } from 'better-sqlite3';

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

let mockDb: DatabaseType;
jest.mock('@/lib/database/backends/sqlite/llm-logs-guard', () => ({
  requireLLMLogsDb: () => mockDb,
}));

import { LogEntriesRepository } from '@/lib/database/repositories/log-entries.repository';
import { compileSqlRegexp, registerRegexpFunction } from '@/lib/database/backends/sqlite/regexp-function';

// The jest moduleNameMapper mocks bare `better-sqlite3`; require the real
// binding by absolute path so this suite runs actual SQL.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const CHAT_A = '11111111-1111-4111-8111-111111111111';
const CHAT_B = '22222222-2222-4222-8222-222222222222';
const ALICE = '33333333-3333-4333-8333-333333333333';
const BOB = '44444444-4444-4444-8444-444444444444';

describe('regexp() SQL function', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = new Database(':memory:');
    registerRegexpFunction(db);
  });
  afterEach(() => db.close());

  it('backs the REGEXP operator', () => {
    expect(db.prepare(`SELECT 'lockpick' REGEXP 'lock(pick|smith)' AS m`).get()).toEqual({ m: 1 });
    expect(db.prepare(`SELECT 'padlock' REGEXP '^lock' AS m`).get()).toEqual({ m: 0 });
  });

  it('takes flags as a third argument', () => {
    expect(db.prepare(`SELECT regexp('^the', 'The vault', 'i') AS m`).get()).toEqual({ m: 1 });
    expect(db.prepare(`SELECT regexp('^the', 'The vault', '') AS m`).get()).toEqual({ m: 0 });
  });

  it('answers NULL for a NULL operand', () => {
    expect(db.prepare(`SELECT regexp('x', NULL) AS m`).get()).toEqual({ m: null });
  });

  it('fails the statement on a pattern that does not compile', () => {
    expect(() => db.prepare(`SELECT regexp('(', 'x') AS m`).get()).toThrow(/Invalid regular expression/);
  });
});

describe('compileSqlRegexp', () => {
  it('refuses stateful or unknown flags', () => {
    expect(compileSqlRegexp('x', 'g')).toEqual({ ok: false, reason: expect.stringContaining('unsupported flags') });
    expect(compileSqlRegexp('x', 'imsu').ok).toBe(true);
  });

  it('names the reason a pattern does not compile', () => {
    const result = compileSqlRegexp('[');
    expect(result.ok).toBe(false);
  });
});

describe('LogEntriesRepository', () => {
  let repo: LogEntriesRepository;

  const seed = async (message: string, chatId: string, characterId: string | null, createdAt: string) =>
    repo.create({ message, chatId, characterId }, { createdAt, updatedAt: createdAt });

  beforeEach(async () => {
    mockDb = new Database(':memory:');
    registerRegexpFunction(mockDb);
    repo = new LogEntriesRepository();
    await seed('Picked the lock on the north door', CHAT_A, ALICE, '2026-10-01T10:00:00.000Z');
    await seed('The vault is empty', CHAT_A, BOB, '2026-10-02T10:00:00.000Z');
    await seed('Lockpick broke', CHAT_B, ALICE, '2026-10-03T10:00:00.000Z');
    await seed('The operator noted the hour', CHAT_B, null, '2026-10-04T10:00:00.000Z');
  });
  afterEach(() => mockDb.close());

  it('creates its table with the chat and character indexes', () => {
    const indexes = (mockDb.prepare(`PRAGMA index_list('log_entries')`).all() as Array<{ name: string }>).map(
      (row) => row.name
    );
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_log_entries_chatId', 'idx_log_entries_characterId', 'idx_log_entries_createdAt'])
    );
  });

  it('reads everything newest first under the limit', async () => {
    const rows = await repo.findEntries({ limit: 3 });
    expect(rows.map((row) => row.message)).toEqual([
      'The operator noted the hour',
      'Lockpick broke',
      'The vault is empty',
    ]);
    expect(rows[0].characterId).toBeNull();
  });

  it('ANDs the chat, character and time filters', async () => {
    expect((await repo.findEntries({ chatId: CHAT_A, limit: 50 })).map((row) => row.message)).toEqual([
      'The vault is empty',
      'Picked the lock on the north door',
    ]);
    expect((await repo.findEntries({ characterId: ALICE, chatId: CHAT_B, limit: 50 })).map((row) => row.message)).toEqual([
      'Lockpick broke',
    ]);
    expect(
      (
        await repo.findEntries({
          from: '2026-10-02T00:00:00.000Z',
          to: '2026-10-03T10:00:00.000Z',
          limit: 50,
        })
      ).map((row) => row.message)
    ).toEqual(['Lockpick broke', 'The vault is empty']);
  });

  it('searches messages by regular expression, with and without case', async () => {
    expect((await repo.searchMessages('lock', '', 50)).map((row) => row.message)).toEqual([
      'Picked the lock on the north door',
    ]);
    expect((await repo.searchMessages('lock', 'i', 50)).map((row) => row.message)).toEqual([
      'Lockpick broke',
      'Picked the lock on the north door',
    ]);
    expect(await repo.searchMessages('^The (vault|operator)', '', 1)).toHaveLength(1);
  });

  it('prunes entries older than the retention window, and nothing at zero', async () => {
    const recent = new Date().toISOString();
    await seed('Fresh', CHAT_A, ALICE, recent);

    expect(await repo.cleanupOldEntries(0)).toBe(0);
    expect(await repo.cleanupOldEntries(7)).toBe(4);
    expect((await repo.findEntries({ limit: 50 })).map((row) => row.message)).toEqual(['Fresh']);
  });
});
