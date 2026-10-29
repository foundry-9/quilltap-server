/**
 * The job child's read-your-writes overlay for carried Inventory objects
 * (inventory-tools-and-pascal §5.1): a buffered `setEquippedInventory` is seen
 * by a later `findById` / `getEquippedInventory` in the same job, and a
 * buffered `removeEquippedInventoryId` strikes the id from the chat it names —
 * but not from a set written after it. Beside it, the document overlay: a
 * folder read later in the job sees the files the job wrote (the Inventory
 * pool after a pick-up or a create).
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

function realRepos(equippedInventory: Record<string, string[]>, documents: unknown[] = []) {
  return {
    docMountDocuments: {
      findManyByMountPointsInFolder: jest.fn(async () => documents),
    },
    docMountFileLinks: {
      linkDocumentContent: jest.fn(),
      deleteWithGC: jest.fn(),
    },
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
    await repos.chats.removeEquippedInventoryId('chat-1', 'viv', 'lantern');
    await repos.chats.removeEquippedInventoryId('chat-2', 'marcus', 'lantern');
    const afterRemoval = ((await repos.chats.findById('chat-1')) as { equippedInventory: Record<string, string[]> }).equippedInventory;
    await repos.chats.setEquippedInventory('chat-1', 'viv', ['lantern']);
    const afterSet = await repos.chats.getEquippedInventory('chat-1');
    const writes = await flushPendingWrites();
    return { afterRemoval, afterSet, writes: writes.map((w) => w.method) };
  });
  expect(seen.afterRemoval).toEqual({ viv: ['rope'], marcus: ['lantern'] });
  expect(seen.afterSet.viv).toEqual(['lantern']);
  expect(seen.writes).toEqual([
    'chats.removeEquippedInventoryId',
    'chats.removeEquippedInventoryId',
    'chats.setEquippedInventory',
  ]);
});

const existingDoc = {
  id: 'doc-rope',
  fileId: 'file-rope',
  linkId: 'link-rope',
  mountPointId: 'mp-viv',
  relativePath: 'Inventory/rope.json',
  fileName: 'rope.json',
  folderId: null,
  fileType: 'json',
  content: '{"id":"rope"}',
  contentSha256: 'a'.repeat(64),
  plainTextLength: 13,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-01T00:00:00.000Z',
  linkGroupId: null,
};

function linkInput(relativePath: string, content: string, mountPointId = 'mp-viv') {
  return {
    mountPointId,
    relativePath,
    fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    folderId: null,
    fileType: 'json',
    content,
    contentSha256: 'b'.repeat(64),
    plainTextLength: content.length,
    fileSizeBytes: content.length,
  };
}

it('a folder read sees documents this job created and rewrote', async () => {
  mockedRepoSource.mockReturnValue(realRepos({}, [existingDoc]) as never);
  const rows = await runWithJobScope('job-pick-up', async () => {
    const repos = getChildRepositoriesProxy();
    await repos.docMountFileLinks.linkDocumentContent(linkInput('Inventory/torch.json', '{"id":"torch"}') as never);
    await repos.docMountFileLinks.linkDocumentContent(linkInput('Inventory/rope.json', '{"id":"rope","v":2}') as never);
    // Outside the folder, the mount or the extension asked for: not added.
    await repos.docMountFileLinks.linkDocumentContent(linkInput('Wardrobe/hat.json', '{}') as never);
    await repos.docMountFileLinks.linkDocumentContent(linkInput('Inventory/lamp.json', '{}', 'mp-other') as never);
    await repos.docMountFileLinks.linkDocumentContent(linkInput('Inventory/notes.md', '# notes') as never);
    const found = await repos.docMountDocuments.findManyByMountPointsInFolder(['mp-viv'], 'Inventory', '.json', { recursive: true });
    await flushPendingWrites();
    return found as Array<{ relativePath: string; content: string; linkId: string }>;
  });
  const byPath = new Map(rows.map((row) => [row.relativePath, row]));
  expect(Array.from(byPath.keys()).sort()).toEqual(['Inventory/rope.json', 'Inventory/torch.json']);
  expect(byPath.get('Inventory/rope.json')).toMatchObject({ content: '{"id":"rope","v":2}', linkId: 'link-rope' });
  expect(byPath.get('Inventory/torch.json')?.content).toBe('{"id":"torch"}');
});

it('a folder read drops a link this job deleted', async () => {
  mockedRepoSource.mockReturnValue(realRepos({}, [existingDoc]) as never);
  const rows = await runWithJobScope('job-delete', async () => {
    const repos = getChildRepositoriesProxy();
    await repos.docMountFileLinks.deleteWithGC('link-rope');
    const found = await repos.docMountDocuments.findManyByMountPointsInFolder(['mp-viv'], 'Inventory', '.json', { recursive: true });
    await flushPendingWrites();
    return found as unknown[];
  });
  expect(rows).toEqual([]);
});

it('a non-recursive read leaves out a document written in a subfolder', async () => {
  mockedRepoSource.mockReturnValue(realRepos({}, []) as never);
  const rows = await runWithJobScope('job-flat', async () => {
    const repos = getChildRepositoriesProxy();
    await repos.docMountFileLinks.linkDocumentContent(linkInput('Inventory/Tools/saw.json', '{}') as never);
    const found = await repos.docMountDocuments.findManyByMountPointsInFolder(['mp-viv'], 'Inventory', '.json');
    await flushPendingWrites();
    return found as unknown[];
  });
  expect(rows).toEqual([]);
});
