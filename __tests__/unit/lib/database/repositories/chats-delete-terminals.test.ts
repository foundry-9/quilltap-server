/**
 * @jest-environment node
 *
 * `ChatsRepository.delete` ends the chat's live terminals. The FK cascade
 * removes their `terminal_sessions` rows, so a shell left running would keep
 * writing a transcript nothing names (bug 268).
 */

jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});

const disposeChatSessions = jest.fn();
jest.mock('@/lib/terminal/pty-manager', () => ({
  ptyManager: { disposeChatSessions: (...a: unknown[]) => disposeChatSessions(...a) },
}));
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ conversationAnnotations: { deleteAllForChat: jest.fn() } }),
}));

import { ChatsRepository } from '@/lib/database/repositories/chats.repository';

function repoWith(deleted: boolean) {
  const repo = new ChatsRepository();
  (repo as any)._delete = jest.fn().mockResolvedValue(deleted);
  (repo as any).getMessagesCollection = jest.fn().mockResolvedValue({
    deleteMany: jest.fn(),
    deleteOne: jest.fn(),
  });
  return repo;
}

beforeEach(() => disposeChatSessions.mockReset());

describe('ChatsRepository.delete — terminal sessions', () => {
  it("terminates the chat's live terminals after the row is gone", async () => {
    const repo = repoWith(true);
    await expect(repo.delete('chat-1', { syncVaults: false })).resolves.toBe(true);
    expect(disposeChatSessions).toHaveBeenCalledWith('chat-1');
  });

  it('leaves terminals alone when no chat was deleted', async () => {
    const repo = repoWith(false);
    await expect(repo.delete('chat-1', { syncVaults: false })).resolves.toBe(false);
    expect(disposeChatSessions).not.toHaveBeenCalled();
  });

  it('still deletes the chat when terminating the terminals throws', async () => {
    disposeChatSessions.mockImplementation(() => { throw new Error('boom'); });
    const repo = repoWith(true);
    await expect(repo.delete('chat-1', { syncVaults: false })).resolves.toBe(true);
  });
});
