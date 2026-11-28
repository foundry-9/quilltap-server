/**
 * @jest-environment node
 */
/**
 * #242: "Re-extract memories" used to delete a chat's memories from the client
 * and only then ask the server to queue extraction, so a refusal (no
 * extraction profile, no turns) left the chat with nothing. The action now
 * refuses before anything is wiped, and the wipe and rebuild are one
 * MEMORY_REGENERATE_CHAT job.
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

jest.mock('@/lib/background-jobs', () => ({
  enqueueMemoryExtractionBatch: jest.fn(),
  enqueueMemoryRegenerateChat: jest.fn(async () => 'job-1'),
  ensureProcessorRunning: jest.fn(),
}));

jest.mock('@/lib/memory/extraction', () => ({
  buildExtractionContext: jest.fn(),
  ExtractionContextError: class extends Error {},
  resolveChatExtractionProfileId: jest.fn(),
  runExtractionDryRun: jest.fn(),
  toExtractedCandidate: jest.fn(),
}));

jest.mock('@/lib/services/chat-message/turn-transcript', () => ({
  ...jest.requireActual('@/lib/services/chat-message/turn-transcript'),
  loadChatMessageEvents: jest.fn(),
}));

jest.mock('@/lib/memory/retire', () => ({
  retireChatMemories: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { handleReextractMemories } from '@/app/api/v1/chats/[id]/actions/memories';
import { enqueueMemoryRegenerateChat, ensureProcessorRunning } from '@/lib/background-jobs';
import { resolveChatExtractionProfileId } from '@/lib/memory/extraction';
import { loadChatMessageEvents } from '@/lib/services/chat-message/turn-transcript';
import { retireChatMemories } from '@/lib/memory/retire';

const enqueueRegenerate = enqueueMemoryRegenerateChat as jest.Mock;
const resolveProfile = resolveChatExtractionProfileId as jest.Mock;
const loadMessages = loadChatMessageEvents as jest.Mock;
const retire = retireChatMemories as jest.Mock;

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const chat = { id: CHAT_ID, chatType: 'roleplay', participants: [] } as any;
const ctx = { user: { id: 'user-1' }, repos: {} } as any;
const req = new NextRequest(`http://localhost/api/v1/chats/${CHAT_ID}?action=reextract-memories`, { method: 'POST' });

const MESSAGES = [
  { id: 'msg-1', type: 'message', role: 'USER', content: 'Where is the map?', createdAt: '2026-10-12T10:00:00.000Z' },
  { id: 'msg-2', type: 'message', role: 'ASSISTANT', content: 'Sewn into my coat.', participantId: 'p-1', createdAt: '2026-10-12T10:00:05.000Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reextract-memories', () => {
  it('refuses with 400 and wipes nothing when there is no extraction profile', async () => {
    resolveProfile.mockResolvedValue(null);
    loadMessages.mockResolvedValue(MESSAGES);

    const res = await handleReextractMemories(req, CHAT_ID, chat, ctx);

    expect(res.status).toBe(400);
    expect(enqueueRegenerate).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
  });

  it('refuses with 400 and wipes nothing when the chat has no turns', async () => {
    resolveProfile.mockResolvedValue(PROFILE_ID);
    loadMessages.mockResolvedValue([]);

    const res = await handleReextractMemories(req, CHAT_ID, chat, ctx);

    expect(res.status).toBe(400);
    expect(enqueueRegenerate).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
  });

  it('queues one wipe-and-rebuild job with the resolved profile', async () => {
    resolveProfile.mockResolvedValue(PROFILE_ID);
    loadMessages.mockResolvedValue(MESSAGES);

    const res = await handleReextractMemories(req, CHAT_ID, chat, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(enqueueRegenerate).toHaveBeenCalledTimes(1);
    expect(enqueueRegenerate).toHaveBeenCalledWith('user-1', { chatId: CHAT_ID, connectionProfileId: PROFILE_ID });
    expect(ensureProcessorRunning).toHaveBeenCalled();
    expect(body).toMatchObject({ success: true, chatId: CHAT_ID, jobId: 'job-1', turnCount: 1 });
    // The wipe belongs to the job, never the request.
    expect(retire).not.toHaveBeenCalled();
  });
});
