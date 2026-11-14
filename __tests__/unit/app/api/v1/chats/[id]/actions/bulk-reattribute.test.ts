/**
 * Tests for the bulk-reattribute action
 * (POST /api/v1/chats/[id]?action=bulk-reattribute).
 *
 * #164: the action used to clear the transcript and replay every row through
 * addMessage. These pin that it touches only the affected rows, through
 * updateMessage, and that one row's failure leaves the rest in place.
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

jest.mock('@/lib/memory/retire', () => ({
  retireMemories: jest.fn(async (ids: string[]) => ({ retired: ids.length })),
}));

import { handleBulkReattribute } from '@/app/api/v1/chats/[id]/actions/bulk';
import { retireMemories } from '@/lib/memory/retire';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';

function msg(id: string, participantId: string | null, role = 'ASSISTANT') {
  return { type: 'message', id, role, participantId, content: id, createdAt: '2026-11-01T00:00:00.000Z' };
}

function makeChat() {
  return {
    id: CHAT_ID,
    participants: [{ id: SOURCE }, { id: TARGET }],
  } as never;
}

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

function makeCtx(messages: unknown[], failIds: string[] = []) {
  const chats = {
    getMessages: jest.fn(async () => messages),
    updateMessage: jest.fn(async (_chatId: string, id: string, updates: Record<string, unknown>) =>
      failIds.includes(id) ? null : { ...(messages.find((m) => (m as { id: string }).id === id) as object), ...updates }
    ),
    update: jest.fn(async () => undefined),
    addMessage: jest.fn(),
    clearMessages: jest.fn(),
  };
  const memories = {
    findBySourceMessageId: jest.fn(async (id: string) => (id === 'm1' ? [{ id: 'mem-1' }] : [])),
  };
  return { ctx: { repos: { chats, memories } } as never, chats, memories };
}

beforeEach(() => jest.clearAllMocks());

describe('handleBulkReattribute', () => {
  it('updates only the affected rows and never clears or replays the transcript', async () => {
    const messages = [msg('m1', SOURCE), msg('m2', TARGET), msg('m3', SOURCE), msg('m4', SOURCE, 'USER')];
    const { ctx, chats } = makeCtx(messages);

    const res = await handleBulkReattribute(
      makeReq({ sourceParticipantId: SOURCE, targetParticipantId: TARGET, roleFilter: 'ASSISTANT' }),
      CHAT_ID,
      makeChat(),
      ctx
    );
    const body = await res.json();

    expect(body).toEqual({ success: true, messagesUpdated: 2, memoriesDeleted: 1 });
    expect(chats.clearMessages).not.toHaveBeenCalled();
    expect(chats.addMessage).not.toHaveBeenCalled();
    expect(chats.updateMessage).toHaveBeenCalledTimes(2);
    expect(chats.updateMessage).toHaveBeenCalledWith(CHAT_ID, 'm1', { participantId: TARGET });
    expect(chats.updateMessage).toHaveBeenCalledWith(CHAT_ID, 'm3', { participantId: TARGET });
    // The chat-row write carries no turn-state or lastMessageAt bookkeeping.
    expect(chats.update).toHaveBeenCalledWith(CHAT_ID, {});
    expect(retireMemories).toHaveBeenCalledWith(['mem-1'], { reason: 'message-reattribution' });
  });

  it('leaves every other row in place when one update fails', async () => {
    const messages = [msg('m1', SOURCE), msg('m2', SOURCE), msg('m3', SOURCE)];
    const { ctx, chats } = makeCtx(messages, ['m2']);

    const res = await handleBulkReattribute(
      makeReq({ sourceParticipantId: SOURCE, targetParticipantId: TARGET, roleFilter: 'both' }),
      CHAT_ID,
      makeChat(),
      ctx
    );
    const body = await res.json();

    expect(chats.updateMessage).toHaveBeenCalledTimes(3);
    expect(body.messagesUpdated).toBe(2);
    expect(chats.clearMessages).not.toHaveBeenCalled();
  });
});
