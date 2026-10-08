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
import { equipItem, removeFromSlot } from '@/lib/wardrobe/outfit-displacement';
import { makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';

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

describe('child proxy — equipped outfits are read-your-writes within a job (bug 179)', () => {
  function realRepos(baseline: EquippedSlots = makeEmptyEquippedSlots()) {
    return {
      chats: {
        getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(baseline),
        setEquippedOutfit: jest.fn(),
      },
      wardrobeWear: {
        commitEquippedOutfit: jest.fn(),
        incrementWears: jest.fn(),
      },
    };
  }

  /** Replay buffered commits whole-slot, as the parent does, against an in-memory store. */
  function replay(writes: Array<{ method: string; args: unknown[] }>, start: EquippedSlots) {
    let slots = start;
    for (const w of writes) {
      if (w.method === 'wardrobeWear.commitEquippedOutfit') {
        slots = (w.args[0] as { nextSlots: EquippedSlots }).nextSlots;
      }
    }
    return slots;
  }

  it('keeps both garments when two are put on in one job', async () => {
    const real = realRepos();
    mockedRepoSource.mockReturnValue(real as never);

    const writes = await runWithJobScope('job-two-wears', async () => {
      const repos = getChildRepositoriesProxy();
      await equipItem(repos as never, 'chat-1', 'char-1', { id: 'shirt', types: ['top'] }, undefined, 'tool');
      await equipItem(repos as never, 'chat-1', 'char-1', { id: 'coat', types: ['top'] }, undefined, 'tool');
      return flushPendingWrites();
    });

    expect(writes).toHaveLength(2);
    expect(replay(writes, makeEmptyEquippedSlots()).top).toEqual(['shirt', 'coat']);
    // The snapshot is read once; the second op reads the job's own write.
    expect(real.chats.getEquippedOutfitForCharacter).toHaveBeenCalledTimes(1);
  });

  it('a take-off after a put-on in the same job sees the put-on', async () => {
    const baseline = { ...makeEmptyEquippedSlots(), bottom: ['trousers'] };
    const real = realRepos(baseline);
    mockedRepoSource.mockReturnValue(real as never);

    const writes = await runWithJobScope('job-wear-then-remove', async () => {
      const repos = getChildRepositoriesProxy();
      await equipItem(repos as never, 'chat-1', 'char-1', { id: 'coat', types: ['top'] }, undefined, 'tool');
      await removeFromSlot(repos as never, 'chat-1', 'char-1', 'bottom', 'trousers');
      return flushPendingWrites();
    });

    const final = replay(writes, baseline);
    expect(final.top).toEqual(['coat']);
    expect(final.bottom).toEqual([]);
  });

  it('keeps characters, chats and jobs apart', async () => {
    const real = realRepos();
    mockedRepoSource.mockReturnValue(real as never);

    await runWithJobScope('job-a', async () => {
      const repos = getChildRepositoriesProxy();
      await equipItem(repos as never, 'chat-1', 'char-1', { id: 'shirt', types: ['top'] }, undefined, 'tool');
      // A different character in the same chat still reads the snapshot.
      const other = await repos.chats.getEquippedOutfitForCharacter('chat-1', 'char-2');
      expect(other?.top).toEqual([]);
      flushPendingWrites();
    });

    await runWithJobScope('job-b', async () => {
      const repos = getChildRepositoriesProxy();
      // A later job starts from the snapshot, not job-a's buffer.
      const slots = await repos.chats.getEquippedOutfitForCharacter('chat-1', 'char-1');
      expect(slots?.top).toEqual([]);
      flushPendingWrites();
    });
  });

  it('hands out copies, so a caller mutating the result cannot corrupt the overlay', async () => {
    const real = realRepos();
    mockedRepoSource.mockReturnValue(real as never);

    await runWithJobScope('job-copy', async () => {
      const repos = getChildRepositoriesProxy();
      await equipItem(repos as never, 'chat-1', 'char-1', { id: 'shirt', types: ['top'] }, undefined, 'tool');
      const first = await repos.chats.getEquippedOutfitForCharacter('chat-1', 'char-1');
      first!.top.push('vandal');
      const second = await repos.chats.getEquippedOutfitForCharacter('chat-1', 'char-1');
      expect(second?.top).toEqual(['shirt']);
      flushPendingWrites();
    });
  });
});
