/**
 * Tests for the subprompt-change fan-out: an edit recompiles every seat that
 * has the subprompt in play; a delete strips it from those seats first.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { fanOutSubpromptChange } from '../chat-fanout';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { compileIdentityStackForParticipant } from '@/lib/services/system-prompt-compiler/compiler';
import { publishRealtime } from '@/lib/realtime/bus';

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileIdentityStackForParticipant: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }));

const CHAR = 'char-1';

function seat(id: string, ids: string[] | undefined, extra: Record<string, unknown> = {}) {
  return { id, type: 'CHARACTER', characterId: CHAR, controlledBy: 'llm', status: 'active', selectedSubpromptIds: ids, ...extra };
}

let chats: Array<Record<string, unknown>>;
let updateParticipant: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  chats = [
    { id: 'chat-a', participants: [seat('seat-a1', ['terse', 'verse']), seat('seat-a2', ['verse'])] },
    { id: 'chat-b', participants: [seat('seat-b1', ['TERSE'])] },
    { id: 'chat-c', participants: [seat('seat-c1', ['terse'], { controlledBy: 'user' })] },
    { id: 'chat-d', participants: [seat('seat-d1', ['terse'], { status: 'removed' })] },
    { id: 'chat-e', participants: [seat('seat-e1', undefined)] },
  ];
  updateParticipant = jest.fn(async (chatId: string, participantId: string, data: { selectedSubpromptIds: string[] }) => {
    const chat = chats.find((c) => c.id === chatId)!;
    const parts = (chat.participants as Array<Record<string, unknown>>).map((p) =>
      p.id === participantId ? { ...p, ...data } : p,
    );
    return { ...chat, participants: parts };
  });
  jest.mocked(getRepositories).mockReturnValue({
    chats: {
      findByCharacterId: jest.fn(async () => chats),
      updateParticipant,
    },
  } as never);
});

describe('fanOutSubpromptChange', () => {
  it('recompiles only live LLM seats carrying the subprompt (case-insensitive)', async () => {
    const result = await fanOutSubpromptChange(CHAR, 'terse');
    expect(result).toEqual({ chatsTouched: 2, seatsRecompiled: 2 });
    const calls = jest.mocked(compileIdentityStackForParticipant).mock.calls.map(([chat, pid]) => [chat.id, pid]);
    expect(calls).toEqual([['chat-a', 'seat-a1'], ['chat-b', 'seat-b1']]);
    expect(updateParticipant).not.toHaveBeenCalled();
    expect(publishRealtime).toHaveBeenCalledWith('chats', 'chat-a');
    expect(publishRealtime).toHaveBeenCalledWith('chats', 'chat-b');
  });

  it('strips the id from each seat before recompiling on delete', async () => {
    await fanOutSubpromptChange(CHAR, 'terse', { removeSelection: true });
    expect(updateParticipant).toHaveBeenCalledWith('chat-a', 'seat-a1', { selectedSubpromptIds: ['verse'] });
    expect(updateParticipant).toHaveBeenCalledWith('chat-b', 'seat-b1', { selectedSubpromptIds: [] });
    // The recompile sees the post-strip chat.
    const [chatArg] = jest.mocked(compileIdentityStackForParticipant).mock.calls[0];
    const strippedSeat = (chatArg.participants as Array<{ id: string; selectedSubpromptIds?: string[] }>).find((p) => p.id === 'seat-a1');
    expect(strippedSeat?.selectedSubpromptIds).toEqual(['verse']);
  });

  it('keeps going when one seat fails to recompile', async () => {
    jest.mocked(compileIdentityStackForParticipant).mockRejectedValueOnce(new Error('boom'));
    const result = await fanOutSubpromptChange(CHAR, 'terse');
    expect(result).toEqual({ chatsTouched: 2, seatsRecompiled: 1 });
  });

  it('is a no-op when the chat listing fails', async () => {
    jest.mocked(getRepositories).mockReturnValue({
      chats: { findByCharacterId: jest.fn().mockRejectedValue(new Error('db')), updateParticipant },
    } as never);
    await expect(fanOutSubpromptChange(CHAR, 'terse')).resolves.toEqual({ chatsTouched: 0, seatsRecompiled: 0 });
  });
});
