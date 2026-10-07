/**
 * The wear ledger's chokepoint in the forked job child.
 *
 * An autonomous turn runs `wardrobe_wear` in the child, whose reads are a
 * stale snapshot blind to the job's own buffered writes. So the child must
 * never write slots or credit wears itself: `equipItem` reads the (stale)
 * prior slots, and its `commitEquippedOutfit` is buffered whole for the parent
 * to replay against the true prior state.
 */

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

import { getRepositories as mockedRealRepositories } from '@/lib/database/repositories';
import {
  runWithJobScope,
  flushPendingWrites,
  getChildRepositoriesProxy,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy';
import { classifyWriteTarget } from '@/lib/background-jobs/host/write-partition';
import { equipItem } from '@/lib/wardrobe/outfit-displacement';
import { makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types';

const mockedRepoSource = mockedRealRepositories as jest.MockedFunction<typeof mockedRealRepositories>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
  process.env.QUILLTAP_JOB_CHILD = '1';
});

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD;
});

describe('child proxy — commitEquippedOutfit', () => {
  it('buffers the chokepoint whole and never runs it on the readonly connection', async () => {
    const real = {
      chats: {
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(makeEmptyEquippedSlots()),
        setEquippedOutfit: jest.fn(),
      },
      wardrobeWear: {
        commitEquippedOutfit: jest.fn(),
        incrementWears: jest.fn(),
      },
    };
    mockedRepoSource.mockReturnValue(real as never);

    const writes = await runWithJobScope('job-wear', async () => {
      const repos = getChildRepositoriesProxy();
      const slots = await equipItem(
        repos as never,
        'chat-1',
        'char-1',
        { id: 'coat', types: ['top'] },
        undefined,
        'tool',
      );
      // The primitive returns what it computed, not the synthetic write result.
      expect(slots.top).toEqual(['coat']);
      return flushPendingWrites();
    });

    expect(real.chats.getEquippedOutfitForCharacter).toHaveBeenCalled();
    expect(real.chats.setEquippedOutfit).not.toHaveBeenCalled();
    expect(real.wardrobeWear.commitEquippedOutfit).not.toHaveBeenCalled();
    expect(real.wardrobeWear.incrementWears).not.toHaveBeenCalled();

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('wardrobeWear.commitEquippedOutfit');
    expect(classifyWriteTarget(writes[0].method)).toBe('main');
    expect(writes[0].args[0]).toMatchObject({
      chatId: 'chat-1',
      characterId: 'char-1',
      source: 'tool',
      wornBundles: [],
    });
  });
});
