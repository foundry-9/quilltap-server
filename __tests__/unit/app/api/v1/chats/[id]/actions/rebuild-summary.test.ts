/**
 * Tests for the rebuild-summary action
 * (POST /api/v1/chats/[id]?action=rebuild-summary).
 *
 * The action's whole job is three columns and one job, so these pin exactly
 * that: what it clears, what it deliberately leaves alone (`lastFullRebuildTurn`
 * — zeroing it would route the rebuild into the single-shot path this action
 * exists to avoid), that it enqueues once, and that it refuses a room whose own
 * turn loop is running.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueContextSummary: jest.fn(),
}));

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}));

import { handleRebuildSummary } from '@/app/api/v1/chats/[id]/actions/rebuild-summary';
import { enqueueContextSummary } from '@/lib/background-jobs/queue-service';
import { publishRealtime } from '@/lib/realtime/bus';

const enqueue = enqueueContextSummary as jest.MockedFunction<typeof enqueueContextSummary>;
const publish = publishRealtime as jest.MockedFunction<typeof publishRealtime>;

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROFILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type AnyRecord = Record<string, unknown>;

function makeChat(over: AnyRecord = {}) {
  return {
    id: CHAT_ID,
    chatType: 'roleplay',
    contextSummary: 'Vivienne and Charlie are on their first real date.',
    lastSummaryTurn: 15,
    lastFullRebuildTurn: 50,
    compactionGeneration: 3,
    participants: [
      { id: 'p-1', type: 'CHARACTER', connectionProfileId: PROFILE_B },
    ],
    ...over,
  } as never;
}

function makeCtx(options: { profiles?: AnyRecord[] } = {}) {
  const update = jest.fn(async () => undefined);
  const findByUserId = jest.fn(async () => options.profiles ?? [{ id: PROFILE_A }, { id: PROFILE_B }]);

  const ctx = {
    user: { id: 'user-1' },
    repos: { chats: { update }, connections: { findByUserId } },
  } as never;

  return { ctx, update, findByUserId };
}

beforeEach(() => {
  jest.clearAllMocks();
  enqueue.mockResolvedValue('job-1');
});

describe('handleRebuildSummary', () => {
  it('clears the summary, its anchors and the fold cursor in one update', async () => {
    const { ctx, update } = makeCtx();

    const res = await handleRebuildSummary(CHAT_ID, makeChat(), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, jobId: 'job-1' });

    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0] as unknown as [string, AnyRecord];
    expect(id).toBe(CHAT_ID);
    expect(patch.contextSummary).toBeNull();
    expect(patch.summaryAnchorMessageIds).toEqual([]);
    expect(patch.lastSummaryTurn).toBe(0);
  });

  it('leaves lastFullRebuildTurn alone so the rebuild stays on the bounded fold path', async () => {
    const { ctx, update } = makeCtx();

    await handleRebuildSummary(CHAT_ID, makeChat(), ctx);

    const [, patch] = update.mock.calls[0] as unknown as [string, AnyRecord];
    expect(patch).not.toHaveProperty('lastFullRebuildTurn');
  });

  it('enqueues exactly one summary job, and not the single-shot path', async () => {
    const { ctx } = makeCtx();

    await handleRebuildSummary(CHAT_ID, makeChat(), ctx);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith('user-1', {
      chatId: CHAT_ID,
      connectionProfileId: PROFILE_B,
      forceRegenerate: false,
    });
  });

  it('falls back to the first profile when the cast has none of its own', async () => {
    const { ctx } = makeCtx();

    await handleRebuildSummary(
      CHAT_ID,
      makeChat({ participants: [{ id: 'p-1', type: 'CHARACTER', connectionProfileId: null }] }),
      ctx
    );

    expect(enqueue).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ connectionProfileId: PROFILE_A })
    );
  });

  it('publishes the chats topic so the summary panel re-reads', async () => {
    const { ctx } = makeCtx();

    await handleRebuildSummary(CHAT_ID, makeChat(), ctx);

    expect(publish).toHaveBeenCalledWith('chats', CHAT_ID);
  });

  it('refuses an autonomous room that is currently running', async () => {
    const { ctx, update } = makeCtx();

    const res = await handleRebuildSummary(
      CHAT_ID,
      makeChat({ chatType: 'autonomous', runState: 'running' }),
      ctx
    );

    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('allows a paused autonomous room', async () => {
    const { ctx, update } = makeCtx();

    const res = await handleRebuildSummary(
      CHAT_ID,
      makeChat({ chatType: 'autonomous', runState: 'paused' }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('refuses when there is no connection profile to source a summariser from', async () => {
    const { ctx, update } = makeCtx({ profiles: [] });

    const res = await handleRebuildSummary(CHAT_ID, makeChat(), ctx);

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue when the clearing update fails', async () => {
    const { ctx, update } = makeCtx();
    update.mockRejectedValueOnce(new Error('database on fire') as never);

    const res = await handleRebuildSummary(CHAT_ID, makeChat(), ctx);

    expect(res.status).toBe(500);
    expect(enqueue).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
