/**
 * @jest-environment node
 *
 * `split-profile-usage-counters-v1` against real SQLite: the old combined
 * totals become the chat ledger, the automatic ledger is backfilled from the
 * LLM logs (cache writes split out of `promptTokens`, except on Anthropic rows
 * from before the plugin reported them there), the four old columns are
 * dropped, the chats table gains its cache-token totals, and a second run is
 * a no-op that adds nothing twice.
 *
 * Guards:
 *   - migrations/scripts/split-profile-usage-counters-v1.ts
 */

import path from 'path';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/progress', () => ({ reportProgress: jest.fn() }));

jest.mock('../../../migrations/lib/database-utils', () => {
  const main = () => (global as Record<string, unknown>).__testMainDb as any;
  const tableExists = (db: any, table: string) =>
    !!db?.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
  const columnExists = (db: any, table: string, column: string) =>
    (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some((c) => c.name === column);
  return {
    isSQLiteBackend: jest.fn(() => true),
    getSQLiteDatabase: jest.fn(() => main()),
    sqliteTableExists: jest.fn((table: string) => tableExists(main(), table)),
    sqliteColumnExists: jest.fn((table: string, column: string) => columnExists(main(), table, column)),
    // The migration closes the logs connection when done; hand it a fresh
    // wrapper each time whose close() leaves the shared test database open.
    openLlmLogsDbIfPresent: jest.fn(() => {
      const logs = (global as Record<string, unknown>).__testLogsDb as any;
      return logs ? new Proxy(logs, { get: (t, k) => (k === 'close' ? () => undefined : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) }) : null;
    }),
    tableExists: jest.fn(tableExists),
    columnExists: jest.fn(columnExists),
  };
});

jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { splitProfileUsageCountersMigration as migration } from '../../../migrations/scripts/split-profile-usage-counters-v1';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

let main: any;
let logs: any;

function columnsOf(db: any, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
}

function profile(id: string): Record<string, number> {
  return main.prepare(`SELECT * FROM "connection_profiles" WHERE "id" = ?`).get(id);
}

function log(row: { profileId: string | null; type: string; provider?: string; prompt: number; completion: number; read?: number; write?: number }) {
  logs.prepare(
    `INSERT INTO "llm_logs" ("id", "type", "provider", "connectionProfileId", "usage", "cacheUsage") VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `log-${Math.random()}`,
    row.type,
    row.provider ?? 'OPENROUTER',
    row.profileId,
    JSON.stringify({ promptTokens: row.prompt, completionTokens: row.completion, totalTokens: row.prompt + row.completion }),
    row.read !== undefined || row.write !== undefined
      ? JSON.stringify({ cacheReadInputTokens: row.read, cacheCreationInputTokens: row.write })
      : null,
  );
}

beforeEach(() => {
  main = new Database(':memory:');
  logs = new Database(':memory:');
  (global as Record<string, unknown>).__testMainDb = main;
  (global as Record<string, unknown>).__testLogsDb = logs;
  main.exec(`CREATE TABLE "connection_profiles" (
    "id" TEXT PRIMARY KEY, "name" TEXT,
    "totalTokens" INTEGER DEFAULT 0, "totalPromptTokens" INTEGER DEFAULT 0,
    "totalCompletionTokens" INTEGER DEFAULT 0, "messageCount" INTEGER DEFAULT 0
  )`);
  main.exec(`CREATE TABLE "chats" ("id" TEXT PRIMARY KEY, "totalPromptTokens" INTEGER DEFAULT 0)`);
  logs.exec(`CREATE TABLE "llm_logs" (
    "id" TEXT PRIMARY KEY, "type" TEXT, "provider" TEXT, "connectionProfileId" TEXT,
    "usage" TEXT, "cacheUsage" TEXT
  )`);
  main.prepare(`INSERT INTO "connection_profiles" VALUES ('p1', 'Main', 1500, 1000, 500, 12)`).run();
  main.prepare(`INSERT INTO "connection_profiles" VALUES ('p2', 'Cheap', NULL, NULL, NULL, NULL)`).run();
});

afterEach(() => {
  main.close();
  logs.close();
});

describe('split-profile-usage-counters-v1', () => {
  it('is dated 4.14.2 and needs the profile-attribution columns on llm_logs', () => {
    expect(migration.introducedInVersion).toBe('4.14.2');
    expect(migration.dependsOn).toContain('add-llm-logs-profile-columns-v1');
  });

  it('moves the old totals into the chat ledger and drops the old columns', async () => {
    expect(await migration.shouldRun()).toBe(true);
    const result = await migration.run();
    expect(result.success).toBe(true);

    expect(profile('p1')).toMatchObject({ chatCallCount: 12, chatPromptTokens: 1000, chatCompletionTokens: 500 });
    expect(profile('p2')).toMatchObject({ chatCallCount: 0, chatPromptTokens: 0, chatCompletionTokens: 0 });
    const cols = columnsOf(main, 'connection_profiles');
    for (const gone of ['totalTokens', 'totalPromptTokens', 'totalCompletionTokens', 'messageCount']) {
      expect(cols).not.toContain(gone);
    }
    expect(columnsOf(main, 'chats')).toEqual(expect.arrayContaining(['totalCacheReadTokens', 'totalCacheWriteTokens']));
    expect(await migration.shouldRun()).toBe(false);
  });

  it('backfills the automatic ledger from the logs, chat calls left out', async () => {
    log({ profileId: 'p2', type: 'MEMORY_EXTRACTION', prompt: 300, completion: 40, read: 50, write: 100 });
    log({ profileId: 'p2', type: 'TITLE_GENERATION', prompt: 200, completion: 10 });
    // Old Anthropic row: cache writes were left out of promptTokens, so none are subtracted.
    log({ profileId: 'p2', type: 'SUMMARIZATION', provider: 'ANTHROPIC', prompt: 80, completion: 20, write: 60 });
    log({ profileId: 'p1', type: 'CHAT_MESSAGE', prompt: 999, completion: 999 });
    log({ profileId: 'p1', type: 'TOOL_CONTINUATION', prompt: 999, completion: 999 });
    log({ profileId: null, type: 'MEMORY_EXTRACTION', prompt: 999, completion: 999 });

    await migration.run();

    expect(profile('p2')).toMatchObject({
      automaticCallCount: 3,
      automaticPromptTokens: 200 + 200 + 80,
      automaticCompletionTokens: 70,
      automaticCacheReadTokens: 50,
      automaticCacheWriteTokens: 100 + 60,
    });
    expect(profile('p1')).toMatchObject({ automaticCallCount: 0, chatCallCount: 12 });
  });

  it('a second run adds nothing twice', async () => {
    log({ profileId: 'p2', type: 'MEMORY_EXTRACTION', prompt: 300, completion: 40 });
    await migration.run();
    const again = await migration.run();
    expect(again.success).toBe(true);
    expect(profile('p2')).toMatchObject({ automaticCallCount: 1, automaticPromptTokens: 300 });
    expect(profile('p1')).toMatchObject({ chatCallCount: 12, chatPromptTokens: 1000 });
  });

  it('runs without an LLM-logs database', async () => {
    (global as Record<string, unknown>).__testLogsDb = null;
    const result = await migration.run();
    expect(result.success).toBe(true);
    expect(profile('p1')).toMatchObject({ chatCallCount: 12, automaticCallCount: 0 });
  });
});
