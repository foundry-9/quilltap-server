/**
 * @jest-environment node
 *
 * Unit tests for the strip-anthropic-sampling-parameters-v1 migration.
 *
 * Anthropic API version 2026-10-21 refuses temperature / top_p / top_k on
 * every model. The migration removes those keys from stored Anthropic
 * profiles, and nothing else: max_tokens and provider options survive, and
 * other providers' profiles are untouched.
 *
 * A real in-memory SQLite DB exercises the select and the updates end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';

function loadDriver() {
  try {
    return require(path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'packages',
      'quilltap',
      'node_modules',
      'better-sqlite3-multiple-ciphers'
    ));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      // Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3, so
      // in CI (where only the root install runs) the driver lives at
      // <root>/node_modules/better-sqlite3. Require by absolute path so the jest
      // moduleNameMapper that mocks 'better-sqlite3' for the rest of the suite does
      // not intercept this load — we want the real native binding here.
      return require(path.join(__dirname, '..', '..', '..', '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}
const Database = loadDriver();
type DatabaseInstance = ReturnType<typeof Database>;

jest.mock('../../../../../migrations/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('../../../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

let testDb: DatabaseInstance = null as unknown as DatabaseInstance;

jest.mock('../../../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: () => true,
  sqliteTableExists: () => true,
  getSQLiteDatabase: () => testDb,
  getSQLiteTableColumns: (name: string) =>
    testDb.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>,
}));

function buildSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE connection_profiles (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      parameters TEXT
    )
  `);
}

function insert(db: DatabaseInstance, id: string, provider: string, parameters: string | null): void {
  db.prepare('INSERT INTO connection_profiles (id, provider, parameters) VALUES (?, ?, ?)').run(
    id,
    provider,
    parameters
  );
}

function paramsOf(db: DatabaseInstance, id: string): unknown {
  const row = db.prepare('SELECT parameters FROM connection_profiles WHERE id = ?').get(id) as
    | { parameters: string | null }
    | undefined;
  return row?.parameters == null ? row?.parameters : JSON.parse(row.parameters);
}

describe('strip-anthropic-sampling-parameters-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/strip-anthropic-sampling-parameters-v1');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    testDb = new Database(':memory:');
    buildSchema(testDb);
    migration = await import('@/migrations/scripts/strip-anthropic-sampling-parameters-v1');
  });

  afterEach(() => {
    testDb.close();
  });

  it('has the expected id and runs once the parameters column exists', async () => {
    const m = migration.stripAnthropicSamplingParametersMigration;
    expect(m.id).toBe('strip-anthropic-sampling-parameters-v1');
    expect(await m.shouldRun()).toBe(true);
  });

  it('removes sampling keys from Anthropic profiles and keeps everything else', async () => {
    insert(
      testDb,
      'ant',
      'ANTHROPIC',
      JSON.stringify({ temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 8192, enableCacheBreakpoints: true })
    );
    insert(testDb, 'ant-camel', 'anthropic', JSON.stringify({ topP: 0.5, max_tokens: 1000 }));

    const result = await migration.stripAnthropicSamplingParametersMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(2);
    expect(paramsOf(testDb, 'ant')).toEqual({ max_tokens: 8192, enableCacheBreakpoints: true });
    expect(paramsOf(testDb, 'ant-camel')).toEqual({ max_tokens: 1000 });
  });

  it('leaves other providers and already-clean or unreadable rows alone', async () => {
    insert(testDb, 'oai', 'OPENAI', JSON.stringify({ temperature: 0.7, top_p: 0.9 }));
    insert(testDb, 'clean', 'ANTHROPIC', JSON.stringify({ max_tokens: 4096 }));
    insert(testDb, 'null', 'ANTHROPIC', null);
    insert(testDb, 'junk', 'ANTHROPIC', 'not json');

    const result = await migration.stripAnthropicSamplingParametersMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(0);
    expect(paramsOf(testDb, 'oai')).toEqual({ temperature: 0.7, top_p: 0.9 });
    expect(paramsOf(testDb, 'clean')).toEqual({ max_tokens: 4096 });
    expect(paramsOf(testDb, 'null')).toBeNull();
    const junk = testDb.prepare('SELECT parameters FROM connection_profiles WHERE id = ?').get('junk') as {
      parameters: string;
    };
    expect(junk.parameters).toBe('not json');
  });
});
