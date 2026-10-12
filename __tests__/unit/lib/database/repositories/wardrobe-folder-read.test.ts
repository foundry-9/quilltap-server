/**
 * Reading a wardrobe recursively: an item in a subfolder is an item, with its
 * `folder` derived from its path — including one hand-moved there in the
 * Scriptorium. `images/` and every `instructions.md` are not items, and a
 * frontmatter `folder:` key never overrides the path. The one predicate
 * (`isWardrobeItemDocumentPath`) agrees with the reader.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

const findManyByMountPointsInFolderMock = jest.fn();
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    docMountDocuments: {
      findManyByMountPointsInFolder: (...args: unknown[]) =>
        findManyByMountPointsInFolderMock(...args),
    },
  }),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocumentIfExists: jest.fn(async () => null),
  writeDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
}));

import { readCharacterVaultWardrobe } from '@/lib/database/repositories/vault-overlay/vault-readers';
import { isWardrobeItemDocumentPath } from '@/lib/database/repositories/vault-overlay/parsers';

const COAT_ID = '11111111-1111-4111-8111-111111111111';
const GOWN_ID = '22222222-2222-4222-8222-222222222222';
const SET_ID = '33333333-3333-4333-8333-333333333333';

function doc(relativePath: string, content: string) {
  const fileName = relativePath.split('/').pop() as string;
  return {
    id: `doc-${relativePath}`,
    linkId: `link-${relativePath}`,
    mountPointId: 'm-1',
    relativePath,
    fileName,
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
  };
}

const item = (id: string, title: string, extra: string[] = []) =>
  ['---', `id: ${id}`, `title: ${title}`, 'types:', '  - top', ...extra, '---', ''].join('\n');

beforeEach(() => {
  findManyByMountPointsInFolderMock.mockReset();
});

describe('isWardrobeItemDocumentPath', () => {
  it('accepts .md at any depth under Wardrobe/', () => {
    expect(isWardrobeItemDocumentPath('Wardrobe/Coat.md')).toBe(true);
    expect(isWardrobeItemDocumentPath('Wardrobe/Formal/Coat.md')).toBe(true);
    expect(isWardrobeItemDocumentPath('wardrobe/Formal/Evening/Coat.MD')).toBe(true);
  });

  it('refuses images/, instructions.md at any depth, and non-wardrobe paths', () => {
    expect(isWardrobeItemDocumentPath('Wardrobe/images/abc/Coat.md')).toBe(false);
    expect(isWardrobeItemDocumentPath('Wardrobe/Images/abc/Coat.md')).toBe(false);
    expect(isWardrobeItemDocumentPath('Wardrobe/instructions.md')).toBe(false);
    expect(isWardrobeItemDocumentPath('Wardrobe/Formal/Instructions.md')).toBe(false);
    expect(isWardrobeItemDocumentPath('Wardrobe/Formal/notes.txt')).toBe(false);
    expect(isWardrobeItemDocumentPath('Notes/Coat.md')).toBe(false);
    expect(isWardrobeItemDocumentPath('Wardrobe/')).toBe(false);
  });
});

describe('readCharacterVaultWardrobe — folders', () => {
  it('reads recursively and derives each item’s folder from its path', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      doc('Wardrobe/Coat.md', item(COAT_ID, 'Coat')),
      // Hand-moved in the Scriptorium; still carries a stale `folder:` key.
      doc('Wardrobe/Formal/Evening/Gown.md', item(GOWN_ID, 'Gown', ['folder: Casual'])),
      doc('Wardrobe/images/abc/caption.md', item('44444444-4444-4444-8444-444444444444', 'Caption')),
      doc('Wardrobe/Formal/instructions.md', 'Wear tweeds.'),
    ]);

    const vault = await readCharacterVaultWardrobe('m-1', 'char-1');

    expect(findManyByMountPointsInFolderMock).toHaveBeenCalledWith(['m-1'], 'Wardrobe', '.md', {
      recursive: true,
    });
    expect(vault!.items.map((i) => [i.title, i.folder])).toEqual([
      ['Coat', ''],
      ['Gown', 'Formal/Evening'],
    ]);
    expect(vault!.items.find((i) => i.title === 'Gown')!.id).toBe(GOWN_ID);
  });

  it('resolves an outfit’s slug components across folders', async () => {
    findManyByMountPointsInFolderMock.mockResolvedValue([
      doc('Wardrobe/Casual/Coat.md', item(COAT_ID, 'Coat')),
      doc('Wardrobe/Formal/Gown.md', item(GOWN_ID, 'Gown')),
      doc('Wardrobe/Sets/Evening Set.md', item(SET_ID, 'Evening Set', ['componentItems:', '  - coat', '  - gown'])),
    ]);

    const vault = await readCharacterVaultWardrobe('m-1', 'char-1');
    const set = vault!.items.find((i) => i.id === SET_ID)!;

    expect(set.folder).toBe('Sets');
    expect(set.componentItemIds).toEqual([COAT_ID, GOWN_ID]);
  });
});
