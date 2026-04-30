/**
 * The legacy INTER_CHARACTER_MEMORY job type no longer ships new work — its
 * extraction has folded into the per-turn MEMORY_EXTRACTION job. The handler
 * remains as a no-op drain so any rows that were enqueued before the cutover
 * complete cleanly. This test pins that contract.
 */

import { handleInterCharacterMemory } from '@/lib/background-jobs/handlers/inter-character-memory';
import type { BackgroundJob } from '@/lib/schemas/types';

jest.mock('@/lib/logger', () => {
  const childLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: {
      ...childLogger,
      child: jest.fn(() => childLogger),
    },
  };
});

const buildJob = (): BackgroundJob => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'INTER_CHARACTER_MEMORY',
  status: 'PENDING',
  payload: {} as unknown as Record<string, unknown>,
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: '2026-04-30T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
});

describe('handleInterCharacterMemory (legacy drain stub)', () => {
  it('completes silently for any payload', async () => {
    await expect(handleInterCharacterMemory(buildJob())).resolves.toBeUndefined();
  });
});
