/**
 * A prompt or scenario save never sweeps a file that is not an item (D6).
 *
 * The whole-folder projection deletes every `.md` in the folder that is not in
 * the array it writes. A `Prompts/draft.md` written by hand with no frontmatter
 * parses to nothing, so it was never in the array — and the next prompt save
 * deleted it. Same for a `Scenarios/*.md` whose body is still empty. The
 * projections now pass `ownsFile`, which sweeps only files that parse as items.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

const vault = new Map<string, string>();

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(async (_mp: string, relativePath: string, content: string) => {
    vault.set(relativePath, content);
    return { mtime: 0 };
  }),
  readDatabaseDocumentIfExists: jest.fn(async (_mp: string, p: string) => vault.get(p) ?? null),
  deleteDatabaseDocument: jest.fn(async (_mp: string, relativePath: string) => {
    vault.delete(relativePath);
  }),
  DatabaseStoreError: class extends Error {},
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

import { applyDocumentStoreWriteOverlay } from '@/lib/characters/vault/write';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const MOUNT_POINT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-09T00:00:00.000Z';

function docsIn(folder: string) {
  return Array.from(vault.entries())
    .filter(([p]) => p.startsWith(`${folder}/`))
    .map(([relativePath, content]) => ({
      id: relativePath,
      mountPointId: MOUNT_POINT_ID,
      relativePath,
      fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
      content,
    }));
}

beforeEach(() => {
  jest.clearAllMocks();
  vault.clear();
  getRepositoriesMock.mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue({
        id: CHARACTER_ID, name: 'Tess', characterDocumentMountPointId: MOUNT_POINT_ID,
      }),
    },
    docMountDocuments: {
      findManyByMountPointsInFolder: jest.fn(async (_ids: string[], folder: string) => docsIn(folder)),
    },
  });
});

it('keeps a frontmatter-less prompt draft through a prompt save', async () => {
  vault.set('Prompts/draft.md', 'Notes to self: try a sterner voice.');
  vault.set('Prompts/Old.md', '---\nname: Old\n---\n\nRetired prompt.');

  await applyDocumentStoreWriteOverlay(CHARACTER_ID, {
    systemPrompts: [{
      id: '33333333-3333-4333-8333-333333333333', name: 'Formal', content: 'Be formal.',
      isDefault: true, createdAt: NOW, updatedAt: NOW,
    }],
  });

  expect(vault.get('Prompts/draft.md')).toBe('Notes to self: try a sterner voice.');
  expect(vault.has('Prompts/Old.md')).toBe(false);
  expect(vault.has('Prompts/Formal.md')).toBe(true);
});

it('keeps an empty-bodied scenario through a scenario save', async () => {
  vault.set('Scenarios/Unfinished.md', '# Unfinished\n');
  vault.set('Scenarios/Stale.md', '# Stale\n\nGone soon.');

  await applyDocumentStoreWriteOverlay(CHARACTER_ID, {
    scenarios: [{
      id: '44444444-4444-4444-8444-444444444444', title: 'Harbour', content: 'Fog.',
      createdAt: NOW, updatedAt: NOW,
    }],
  });

  expect(vault.get('Scenarios/Unfinished.md')).toBe('# Unfinished\n');
  expect(vault.has('Scenarios/Stale.md')).toBe(false);
  expect(vault.has('Scenarios/Harbour.md')).toBe(true);
});
