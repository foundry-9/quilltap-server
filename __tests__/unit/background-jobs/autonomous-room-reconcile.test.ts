/**
 * When an AUTONOMOUS_ROOM_TURN job fails terminally, the turn's whole write
 * batch (message, counters, AND the run-state transition) is rolled back, so
 * the chat would otherwise stay `running` forever with no turn in flight.
 * `reconcileFailedAutonomousTurn` flips such a room to a resumable `paused`.
 * These tests pin when it acts and when it must stand down.
 */

import { reconcileFailedAutonomousTurn } from '@/lib/services/chat-message/autonomous-room.service';
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueAutonomousRoomTurn: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const childLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: { ...childLogger, child: jest.fn(() => childLogger) },
  };
});

type AnyChat = Record<string, unknown>;

const buildChat = (overrides: AnyChat = {}): AnyChat => ({
  id: 'chat-1',
  chatType: 'autonomous',
  runState: 'running',
  currentRunId: 'run-1',
  runTurnsConsumed: 2,
  runTokensConsumed: 5000,
  lastMessageAt: '2026-06-05T10:19:39.000Z',
  runStartedAt: '2026-06-05T10:18:32.000Z',
  ...overrides,
});

function wireRepos(chat: AnyChat | null) {
  const findById = jest.fn(async () => chat);
  const update = jest.fn(async () => undefined);
  jest.mocked(getRepositories).mockReturnValue({
    chats: { findById, update },
  } as unknown as ReturnType<typeof getRepositories>);
  return { findById, update };
}

describe('reconcileFailedAutonomousTurn', () => {
  it('pauses a live running room and records the cause', async () => {
    const { update } = wireRepos(buildChat());

    await reconcileFailedAutonomousTurn(
      { chatId: 'chat-1', runId: 'run-1' },
      'UNIQUE constraint failed',
    );

    expect(update).toHaveBeenCalledTimes(1);
    const [chatId, patch] = update.mock.calls[0] as [string, AnyChat];
    expect(chatId).toBe('chat-1');
    expect(patch.runState).toBe('paused');
    expect(String(patch.runStateMessage)).toMatch(/^turn_failed:/);
    expect(patch.runEndedAt).toBeNull();
    // currentRunId is bumped so any zombie/retry turn job exits via the
    // stale-run guard.
    expect(patch.currentRunId).not.toBe('run-1');
    expect(patch.runPausedAt).toBeDefined();
  });

  it('stands down when a newer run has superseded this one', async () => {
    const { update } = wireRepos(buildChat({ currentRunId: 'run-2' }));
    await reconcileFailedAutonomousTurn({ chatId: 'chat-1', runId: 'run-1' }, 'boom');
    expect(update).not.toHaveBeenCalled();
  });

  it('stands down when the run is already in a terminal state', async () => {
    const { update } = wireRepos(buildChat({ runState: 'budgetExhausted' }));
    await reconcileFailedAutonomousTurn({ chatId: 'chat-1', runId: 'run-1' }, 'boom');
    expect(update).not.toHaveBeenCalled();
  });

  it('ignores non-autonomous chats', async () => {
    const { update } = wireRepos(buildChat({ chatType: 'salon' }));
    await reconcileFailedAutonomousTurn({ chatId: 'chat-1', runId: 'run-1' }, 'boom');
    expect(update).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing payload', async () => {
    const { findById, update } = wireRepos(buildChat());
    await reconcileFailedAutonomousTurn(null, 'boom');
    await reconcileFailedAutonomousTurn({}, 'boom');
    expect(findById).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
