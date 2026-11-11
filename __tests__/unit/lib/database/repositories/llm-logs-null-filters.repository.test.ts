/**
 * @jest-environment node
 *
 * `LLMLogsRepository` against a real in-memory SQLite database standing in for
 * the LLM logs file, for the reads whose filters compare against null:
 * `findStandalone` (`$eq: null` on three columns) and the token-usage sums
 * (`$exists: true`). The sibling `llm-logs-repository.test.ts` mocks the
 * collection, which is how a filter that matched nothing in SQL survived (#196).
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

import { LLMLogsRepository } from '@/lib/database/repositories/llm-logs.repository';
import type { LLMLog } from '@/lib/schemas/types';

// The jest moduleNameMapper mocks bare `better-sqlite3`; require the real
// binding by absolute path so this suite runs actual SQL.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
const CHAT = '44444444-4444-4444-8444-444444444444';
const CHARACTER = '55555555-5555-4555-8555-555555555555';

type NewLog = Omit<LLMLog, 'id' | 'createdAt' | 'updatedAt'>;

function log(overrides: Partial<NewLog> = {}): NewLog {
  return {
    userId: USER,
    type: 'CHAT_MESSAGE',
    provider: 'openai',
    modelName: 'gpt-4o',
    request: { messageCount: 1, messages: [], temperature: null, maxTokens: null, toolCount: 0 },
    response: { content: 'Hello', contentLength: 5, error: null },
    usage: null,
    ...overrides,
  } as NewLog;
}

describe('LLMLogsRepository null filters (real SQLite)', () => {
  let repo: LLMLogsRepository;

  beforeEach(() => {
    mockDb = new Database(':memory:');
    repo = new LLMLogsRepository();
  });

  afterEach(() => mockDb.close());

  it('findStandalone returns only logs tied to no message, chat or character', async () => {
    const standalone = await repo.create(log());
    await repo.create(log({ messageId: MESSAGE }));
    await repo.create(log({ chatId: CHAT }));
    await repo.create(log({ characterId: CHARACTER }));
    await repo.create(log({ userId: OTHER_USER }));

    const found = await repo.findStandalone(USER);

    expect(found.map(l => l.id)).toEqual([standalone.id]);
  });

  it('sums token usage only over logs that recorded it', async () => {
    await repo.create(log({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }));
    await repo.create(log({ usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } }));
    await repo.create(log());

    await expect(repo.getTotalTokenUsage(USER)).resolves.toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });
});
