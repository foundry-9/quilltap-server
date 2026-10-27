/**
 * @jest-environment node
 *
 * `ptyManager.terminate` / `disposeChatSessions` — an interactive bash ignores
 * SIGTERM, so a session is ended with SIGHUP and escalated to SIGKILL if it is
 * still running after the grace period. A deleted chat's sessions are
 * terminated and dropped from the map.
 */

jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/services/ariel-notifications', () => ({
  postArielSessionClosedAnnouncement: jest.fn(),
  postArielTerminalOutputAnnouncement: jest.fn(),
}));
jest.mock('../screen', () => ({ TerminalScreen: jest.fn() }));

import { ptyManager } from '../pty-manager';

function fakeSession(id: string, chatId: string) {
  return {
    pty: { kill: jest.fn() },
    meta: { id, chatId, exitedAt: null as string | null },
    subscribers: new Set(),
  };
}

const sessions = (ptyManager as any).sessions as Map<string, ReturnType<typeof fakeSession>>;

beforeEach(() => {
  jest.useFakeTimers();
  sessions.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ptyManager.terminate', () => {
  it('sends SIGHUP, then SIGKILL when the session is still running after the grace period', () => {
    const s = fakeSession('a', 'chat-1');
    sessions.set('a', s);

    ptyManager.terminate('a', 1000);
    expect(s.pty.kill).toHaveBeenCalledWith('SIGHUP');
    expect(s.pty.kill).not.toHaveBeenCalledWith('SIGKILL');

    jest.advanceTimersByTime(1000);
    expect(s.pty.kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('does not escalate once the session has exited', () => {
    const s = fakeSession('a', 'chat-1');
    sessions.set('a', s);

    ptyManager.terminate('a', 1000);
    s.meta.exitedAt = new Date().toISOString();
    jest.advanceTimersByTime(1000);

    expect(s.pty.kill).toHaveBeenCalledTimes(1);
    expect(s.pty.kill).toHaveBeenCalledWith('SIGHUP');
  });

  it('ignores an unknown session', () => {
    expect(() => ptyManager.terminate('nope')).not.toThrow();
  });
});

describe('ptyManager.disposeChatSessions', () => {
  it("terminates only the chat's sessions and drops them from the map", () => {
    const a = fakeSession('a', 'chat-1');
    const b = fakeSession('b', 'chat-1');
    const other = fakeSession('c', 'chat-2');
    sessions.set('a', a);
    sessions.set('b', b);
    sessions.set('c', other);

    expect(ptyManager.disposeChatSessions('chat-1')).toBe(2);

    expect(a.pty.kill).toHaveBeenCalledWith('SIGHUP');
    expect(b.pty.kill).toHaveBeenCalledWith('SIGHUP');
    expect(other.pty.kill).not.toHaveBeenCalled();
    expect(ptyManager.get('a')).toBeUndefined();
    expect(ptyManager.get('b')).toBeUndefined();
    expect(ptyManager.get('c')).toBe(other);

    // Escalation still reaches a dropped session that ignored SIGHUP.
    jest.advanceTimersByTime(3000);
    expect(a.pty.kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('returns 0 for a chat with no live sessions', () => {
    expect(ptyManager.disposeChatSessions('chat-none')).toBe(0);
  });
});
