/**
 * @jest-environment node
 *
 * Integration tests for the retire-prefill-on-gateway-claude-profiles-v1
 * migration.
 *
 * The setup wizard, given OpenRouter and `anthropic/claude-sonnet-5`, created
 * a profile with the `[Name]` prefill on: the default exempted the ANTHROPIC
 * provider only. Anthropic 4.6+ refuses an assistant tail through any
 * gateway, so every multi-character turn — the opening greeting included —
 * failed with "This model does not support assistant message prefill". This
 * pass clears the stored `1` on non-Anthropic profiles whose model is Claude,
 * and touches nothing else.
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
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      modelName TEXT,
      parameters TEXT,
      multiCharacterPrefill INTEGER DEFAULT 1
    )
  `);
}

function insert(
  db: DatabaseInstance,
  id: string,
  provider: string,
  modelName: string | null,
  prefill: number | null = 1
): void {
  db.prepare(
    `INSERT INTO connection_profiles
       (id, name, provider, modelName, parameters, multiCharacterPrefill)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, `${id} profile`, provider, modelName, '{}', prefill);
}

function prefillOf(db: DatabaseInstance, id: string): number | null {
  const row = db
    .prepare('SELECT multiCharacterPrefill FROM connection_profiles WHERE id = ?')
    .get(id) as { multiCharacterPrefill: number | null } | undefined;
  return row ? row.multiCharacterPrefill : null;
}

describe('retire-prefill-on-gateway-claude-profiles-v1 migration', () => {
  let migration: typeof import('@/migrations/scripts/retire-prefill-on-gateway-claude-profiles');

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    testDb = new Database(':memory:');
    buildSchema(testDb);
    migration = await import('@/migrations/scripts/retire-prefill-on-gateway-claude-profiles');
  });

  afterEach(() => {
    testDb.close();
  });

  it('has the expected id and depends on the column it edits', () => {
    const m = migration.retirePrefillOnGatewayClaudeProfilesMigration;
    expect(m.id).toBe('retire-prefill-on-gateway-claude-profiles-v1');
    expect(m.dependsOn).toContain('add-profile-multi-character-prefill-field-v1');
  });

  it('runs once the column exists', async () => {
    expect(await migration.retirePrefillOnGatewayClaudeProfilesMigration.shouldRun()).toBe(true);
  });

  it('clears the wizard-made OpenRouter Claude profile and other gateway Claude ids', async () => {
    insert(testDb, 'openrouter', 'OPENROUTER', 'anthropic/claude-sonnet-5');
    insert(testDb, 'openrouter-alias', 'OPENROUTER', '~anthropic/claude-sonnet-latest');
    insert(testDb, 'nanogpt', 'NANOGPT', 'claude-sonnet-4-6');
    insert(testDb, 'proxy', 'OPENAI_COMPATIBLE', 'us.anthropic.claude-opus-4-7');

    const result = await migration.retirePrefillOnGatewayClaudeProfilesMigration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(4);
    for (const id of ['openrouter', 'openrouter-alias', 'nanogpt', 'proxy']) {
      expect(prefillOf(testDb, id)).toBe(0);
    }
  });

  it('leaves non-Claude models, unset rows and Anthropic profiles alone', async () => {
    insert(testDb, 'gpt', 'OPENROUTER', 'openai/gpt-5-mini');
    insert(testDb, 'claudette', 'OLLAMA', 'claudette:7b');
    insert(testDb, 'unset', 'OPENROUTER', 'anthropic/claude-sonnet-5', null);
    insert(testDb, 'already-off', 'OPENROUTER', 'anthropic/claude-sonnet-5', 0);
    // A stored 1 on an Anthropic profile is a choice the user made against
    // the default; the gateway pass does not second-guess it.
    insert(testDb, 'anthropic', 'ANTHROPIC', 'claude-sonnet-5');

    const result = await migration.retirePrefillOnGatewayClaudeProfilesMigration.run();

    expect(result.itemsAffected).toBe(0);
    expect(prefillOf(testDb, 'gpt')).toBe(1);
    expect(prefillOf(testDb, 'claudette')).toBe(1);
    expect(prefillOf(testDb, 'unset')).toBeNull();
    expect(prefillOf(testDb, 'already-off')).toBe(0);
    expect(prefillOf(testDb, 'anthropic')).toBe(1);
  });
});
