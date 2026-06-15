/**
 * Tests for the startup render/embed reconciliation sweep.
 *
 * Uses the global `jest` (no `@jest/globals` import) and imports the subject
 * dynamically after the mocks are registered, per repo test conventions.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueConversationRender: jest.fn(),
}));

// Pin the size cap so the bound parameter is deterministic in assertions.
jest.mock('@/lib/embedding/embedding-service', () => ({
  EMBEDDING_MAX_CHARS: 131072,
}));

const { getRawDatabase } = jest.requireMock('@/lib/database/backends/sqlite/client') as {
  getRawDatabase: jest.Mock;
};
const { enqueueConversationRender } = jest.requireMock('@/lib/background-jobs/queue-service') as {
  enqueueConversationRender: jest.Mock;
};

type IncompleteChatRow = { chatId: string; userId: string };

/** Build a fake better-sqlite3 db whose SELECT returns the given rows. */
function makeDb(rows: IncompleteChatRow[]) {
  const all = jest.fn(() => rows);
  const prepare = jest.fn(() => ({ all }));
  return { db: { prepare }, prepare, all };
}

describe('reconcileConversationRendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a zeroed result and enqueues nothing when no database is available', async () => {
    getRawDatabase.mockReturnValue(null);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({ incompleteChats: 0, enqueued: 0, reused: 0, failed: 0 });
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });

  it('is a no-op when every conversation is already rendered and embedded', async () => {
    const { db, all } = makeDb([]);
    getRawDatabase.mockReturnValue(db);

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result.incompleteChats).toBe(0);
    expect(result.enqueued).toBe(0);
    // The scan still binds the size cap so oversized chunks are excluded.
    expect(all).toHaveBeenCalledWith(131072);
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });

  it('enqueues a render for each incomplete chat and counts new vs reused', async () => {
    const { db } = makeDb([
      { chatId: 'chat-a', userId: 'user-1' },
      { chatId: 'chat-b', userId: 'user-1' },
      { chatId: 'chat-c', userId: 'user-2' },
    ]);
    getRawDatabase.mockReturnValue(db);

    enqueueConversationRender
      .mockResolvedValueOnce({ jobId: 'job-a', isNew: true })
      .mockResolvedValueOnce({ jobId: 'job-b', isNew: false }) // already pending → reused
      .mockResolvedValueOnce({ jobId: 'job-c', isNew: true });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({ incompleteChats: 3, enqueued: 2, reused: 1, failed: 0 });
    expect(enqueueConversationRender).toHaveBeenCalledTimes(3);
    expect(enqueueConversationRender).toHaveBeenNthCalledWith(1, 'user-1', { chatId: 'chat-a' });
    expect(enqueueConversationRender).toHaveBeenNthCalledWith(2, 'user-1', { chatId: 'chat-b' });
    expect(enqueueConversationRender).toHaveBeenNthCalledWith(3, 'user-2', { chatId: 'chat-c' });
  });

  it('continues past a failed enqueue and tallies it', async () => {
    const { db } = makeDb([
      { chatId: 'chat-a', userId: 'user-1' },
      { chatId: 'chat-b', userId: 'user-1' },
    ]);
    getRawDatabase.mockReturnValue(db);

    enqueueConversationRender
      .mockRejectedValueOnce(new Error('queue exploded'))
      .mockResolvedValueOnce({ jobId: 'job-b', isNew: true });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({ incompleteChats: 2, enqueued: 1, reused: 0, failed: 1 });
    expect(enqueueConversationRender).toHaveBeenCalledTimes(2);
  });

  it('swallows a scan failure and returns a zeroed result', async () => {
    const prepare = jest.fn(() => {
      throw new Error('no such table');
    });
    getRawDatabase.mockReturnValue({ prepare });

    const { reconcileConversationRendering } = await import(
      '@/lib/startup/reconcile-conversation-rendering'
    );
    const result = await reconcileConversationRendering();

    expect(result).toEqual({ incompleteChats: 0, enqueued: 0, reused: 0, failed: 0 });
    expect(enqueueConversationRender).not.toHaveBeenCalled();
  });
});
