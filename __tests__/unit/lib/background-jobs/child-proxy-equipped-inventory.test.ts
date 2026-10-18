/**
 * The job child's read-your-writes overlay for carried Inventory objects
 * (inventory-tools-and-pascal §5.1): a buffered `setEquippedInventory` is seen
 * by a later `findById` / `getEquippedInventory` in the same job, and a
 * buffered `removeEquippedInventoryId` strikes the id from every chat the
 * character carried it in — but not from a set written after it.
 */

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() };
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

const mockedRepoSource = mockedRealRepositories as jest.MockedFunction<typeof mockedRealRepositories>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
  process.env.QUILLTAP_JOB_CHILD = '1';
});

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD;
});

function realRepos(equippedInventory: Record<string, string[]>) {
  return {
    chats: {
      findById: jest.fn(async (id: string) => ({ id, equippedInventory })),
      getEquippedInventory: jest.fn(async () => equippedInventory),
      setEquippedInventory: jest.fn(),
      removeEquippedInventoryId: jest.fn(),
    },
  };
}

it('a second gesture in one job sees the first', async () => {
  mockedRepoSource.mockReturnValue(realRepos({ viv: ['old'] }) as never);
  const seen = await runWithJobScope('job-equip', async () => {
    const repos = getChildRepositoriesProxy();
    await repos.chats.setEquippedInventory('chat-1', 'viv', ['old', 'sword']);
    const chat = (await repos.chats.findById('chat-1')) as { equippedInventory: Record<string, string[]> };
    const map = await repos.chats.getEquippedInventory('chat-1');
    await flushPendingWrites();
    return { chat: chat.equippedInventory, map };
  });
  expect(seen.chat.viv).toEqual(['old', 'sword']);
  expect(seen.map.viv).toEqual(['old', 'sword']);
});

it('a removal strikes earlier sets and the snapshot, but not a later set', async () => {
  mockedRepoSource.mockReturnValue(realRepos({ viv: ['lantern', 'rope'], marcus: ['lantern'] }) as never);
  const seen = await runWithJobScope('job-give', async () => {
    const repos = getChildRepositoriesProxy();
    await repos.chats.removeEquippedInventoryId('viv', 'lantern');
    const afterRemoval = ((await repos.chats.findById('chat-1')) as { equippedInventory: Record<string, string[]> }).equippedInventory;
    await repos.chats.setEquippedInventory('chat-1', 'viv', ['lantern']);
    const afterSet = await repos.chats.getEquippedInventory('chat-1');
    const writes = await flushPendingWrites();
    return { afterRemoval, afterSet, writes: writes.map((w) => w.method) };
  });
  expect(seen.afterRemoval).toEqual({ viv: ['rope'], marcus: ['lantern'] });
  expect(seen.afterSet.viv).toEqual(['lantern']);
  expect(seen.writes).toEqual(['chats.removeEquippedInventoryId', 'chats.setEquippedInventory']);
});
