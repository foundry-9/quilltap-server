/**
 * Tests for the subprompts storage layer.
 *
 * Pure helpers (id validation, slugging, compose/parse) are tested directly.
 * The I/O helpers run against an in-memory fake of the mount-index
 * database-store, so the frontmatter round-trip and the folder-ensure are
 * exercised without a database. `ensureFolderPath` is a spy.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import {
  SUBPROMPTS_FOLDER,
  isValidSubpromptId,
  slugifySubpromptTitle,
  composeSubpromptContent,
  parseSubpromptContent,
  listCharacterSubprompts,
  readCharacterSubprompt,
  resolveSelectedSubprompts,
  createCharacterSubprompt,
  updateCharacterSubprompt,
  deleteCharacterSubprompt,
  SubpromptNotFoundError,
  SubpromptValidationError,
} from '../subprompts';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import {
  writeDatabaseDocument,
  readDatabaseDocument,
  listDatabaseFiles,
  deleteDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';

jest.mock('@/lib/mount-index/database-store', () => {
  const actual = jest.requireActual('@/lib/mount-index/database-store');
  return {
    ...actual,
    writeDatabaseDocument: jest.fn(),
    readDatabaseDocument: jest.fn(),
    listDatabaseFiles: jest.fn(),
    deleteDatabaseDocument: jest.fn(),
  };
});
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));
jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn(),
}));
jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {
    constructor(id: string) {
      super(`Character ${id} is archived`);
      this.name = 'CharacterArchivedError';
    }
  },
}));

const { DatabaseStoreError } = jest.requireActual('@/lib/mount-index/database-store');

const CHAR = 'char-1';
const VAULT = 'vault-1';

/** vaultId → (relativePath → content) */
let store: Map<string, Map<string, string>>;
let characters: Map<string, { id: string; characterDocumentMountPointId: string | null; archivedAt?: string | null }>;

function vault(id: string): Map<string, string> {
  let v = store.get(id);
  if (!v) {
    v = new Map();
    store.set(id, v);
  }
  return v;
}

beforeEach(() => {
  jest.clearAllMocks();
  store = new Map();
  characters = new Map([[CHAR, { id: CHAR, characterDocumentMountPointId: VAULT }]]);

  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findByIdRaw: jest.fn(async (id: string) => characters.get(id) ?? null),
    },
  } as never);

  jest.mocked(writeDatabaseDocument).mockImplementation(async (vaultId, relativePath, content) => {
    vault(vaultId).set(relativePath, content);
    return { mtime: 1_700_000_000_000 };
  });

  jest.mocked(readDatabaseDocument).mockImplementation(async (vaultId, relativePath) => {
    const content = vault(vaultId).get(relativePath);
    if (content === undefined) {
      throw new DatabaseStoreError(`not found: ${relativePath}`, 'NOT_FOUND');
    }
    return { content, mtime: 1_700_000_000_000, size: content.length };
  });

  jest.mocked(deleteDatabaseDocument).mockImplementation(async (vaultId, relativePath) =>
    vault(vaultId).delete(relativePath),
  );

  jest.mocked(listDatabaseFiles).mockImplementation(async (vaultId, options) => {
    const folder = (options?.folder ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
    const prefix = folder ? `${folder}/` : '';
    const out: Array<{ relativePath: string; kind: 'file' }> = [];
    for (const relativePath of vault(vaultId).keys()) {
      if (!prefix || relativePath.startsWith(prefix)) {
        out.push({ relativePath, kind: 'file' });
      }
    }
    return out as never;
  });
});

describe('isValidSubpromptId', () => {
  it('accepts a plain slug and a spaced name', () => {
    expect(isValidSubpromptId('be-terse')).toBe(true);
    expect(isValidSubpromptId('My Prompt')).toBe(true);
  });
  it('rejects path tricks, reserved characters, and blanks', () => {
    expect(isValidSubpromptId('')).toBe(false);
    expect(isValidSubpromptId('.')).toBe(false);
    expect(isValidSubpromptId('..')).toBe(false);
    expect(isValidSubpromptId('a/b')).toBe(false);
    expect(isValidSubpromptId('a\\b')).toBe(false);
    expect(isValidSubpromptId('a:b')).toBe(false);
    expect(isValidSubpromptId(' padded')).toBe(false);
    expect(isValidSubpromptId('x'.repeat(121))).toBe(false);
    expect(isValidSubpromptId(42)).toBe(false);
  });
});

describe('slugifySubpromptTitle', () => {
  it('lowercases, strips accents, collapses to hyphens', () => {
    expect(slugifySubpromptTitle('Be Terse!')).toBe('be-terse');
    expect(slugifySubpromptTitle('  Café   au lait ')).toBe('cafe-au-lait');
  });
  it('falls back when nothing survives', () => {
    expect(slugifySubpromptTitle('!!!')).toBe('subprompt');
  });
});

describe('compose + parse round-trip', () => {
  it('keeps the title in frontmatter and the body clean', () => {
    const raw = composeSubpromptContent('Be terse', 'You answer in one line.\n');
    const parsed = parseSubpromptContent('be-terse', raw, '2026-01-01T00:00:00.000Z');
    expect(parsed).toEqual({
      id: 'be-terse',
      path: `${SUBPROMPTS_FOLDER}/be-terse.md`,
      title: 'Be terse',
      content: 'You answer in one line.',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
  it('falls back to the id as title when the frontmatter has none', () => {
    const parsed = parseSubpromptContent('dropped-in', 'Just a body.', 'x');
    expect(parsed.title).toBe('dropped-in');
    expect(parsed.content).toBe('Just a body.');
  });
});

describe('listCharacterSubprompts', () => {
  it('returns [] when the folder does not exist, without touching ensureFolderPath', async () => {
    await expect(listCharacterSubprompts(CHAR)).resolves.toEqual([]);
    expect(ensureFolderPath).not.toHaveBeenCalled();
  });
  it('returns [] for a character with no vault', async () => {
    characters.set(CHAR, { id: CHAR, characterDocumentMountPointId: null });
    await expect(listCharacterSubprompts(CHAR)).resolves.toEqual([]);
  });
  it('lists only root-level .md files, sorted by title', async () => {
    vault(VAULT).set(`${SUBPROMPTS_FOLDER}/zed.md`, composeSubpromptContent('Zed', 'z'));
    vault(VAULT).set(`${SUBPROMPTS_FOLDER}/alpha.md`, composeSubpromptContent('Alpha', 'a'));
    vault(VAULT).set(`${SUBPROMPTS_FOLDER}/nested/x.md`, composeSubpromptContent('Nested', 'n'));
    vault(VAULT).set(`${SUBPROMPTS_FOLDER}/notes.txt`, 'nope');
    vault(VAULT).set('manifesto.md', 'nope');
    const list = await listCharacterSubprompts(CHAR);
    expect(list.map((s) => s.id)).toEqual(['alpha', 'zed']);
  });
});

describe('createCharacterSubprompt', () => {
  it('ensures the folder, slugs the title, and writes frontmatter + body', async () => {
    const created = await createCharacterSubprompt(CHAR, { title: 'Be Terse', content: 'You answer in one line.' });
    expect(ensureFolderPath).toHaveBeenCalledWith(VAULT, SUBPROMPTS_FOLDER);
    expect(created.id).toBe('be-terse');
    expect(vault(VAULT).get(`${SUBPROMPTS_FOLDER}/be-terse.md`)).toContain('title: Be Terse');
    await expect(readCharacterSubprompt(CHAR, 'be-terse')).resolves.toMatchObject({
      title: 'Be Terse',
      content: 'You answer in one line.',
    });
  });
  it('bumps the id on a title collision', async () => {
    await createCharacterSubprompt(CHAR, { title: 'Same', content: 'one' });
    const second = await createCharacterSubprompt(CHAR, { title: 'Same', content: 'two' });
    expect(second.id).toBe('same-2');
  });
  it('rejects a blank title or body', async () => {
    await expect(createCharacterSubprompt(CHAR, { title: '  ', content: 'x' })).rejects.toBeInstanceOf(SubpromptValidationError);
    await expect(createCharacterSubprompt(CHAR, { title: 'x', content: '  ' })).rejects.toBeInstanceOf(SubpromptValidationError);
  });
  it('refuses an archived character', async () => {
    characters.set(CHAR, { id: CHAR, characterDocumentMountPointId: VAULT, archivedAt: '2026-01-01T00:00:00.000Z' });
    await expect(createCharacterSubprompt(CHAR, { title: 'x', content: 'y' })).rejects.toMatchObject({ name: 'CharacterArchivedError' });
    expect(writeDatabaseDocument).not.toHaveBeenCalled();
  });
  it('provisions a vault for a live character without one', async () => {
    characters.set(CHAR, { id: CHAR, characterDocumentMountPointId: null });
    jest.mocked(ensureCharacterVault).mockResolvedValue({ mountPointId: 'fresh', created: true });
    const created = await createCharacterSubprompt(CHAR, { title: 'x', content: 'y' });
    expect(created.id).toBe('x');
    expect(vault('fresh').has(`${SUBPROMPTS_FOLDER}/x.md`)).toBe(true);
  });
});

describe('updateCharacterSubprompt', () => {
  it('rewrites title and content while keeping the id', async () => {
    await createCharacterSubprompt(CHAR, { title: 'Old', content: 'old body' });
    const updated = await updateCharacterSubprompt(CHAR, 'old', { title: 'New title' });
    expect(updated).toMatchObject({ id: 'old', title: 'New title', content: 'old body' });
    const again = await updateCharacterSubprompt(CHAR, 'old', { content: 'new body' });
    expect(again).toMatchObject({ id: 'old', title: 'New title', content: 'new body' });
  });
  it('throws SubpromptNotFoundError for a missing or malformed id', async () => {
    await expect(updateCharacterSubprompt(CHAR, 'ghost', { title: 'x' })).rejects.toBeInstanceOf(SubpromptNotFoundError);
    await expect(updateCharacterSubprompt(CHAR, '../x', { title: 'x' })).rejects.toBeInstanceOf(SubpromptNotFoundError);
  });
});

describe('deleteCharacterSubprompt', () => {
  it('deletes the file and reports whether anything went', async () => {
    await createCharacterSubprompt(CHAR, { title: 'Gone', content: 'x' });
    await expect(deleteCharacterSubprompt(CHAR, 'gone')).resolves.toBe(true);
    await expect(deleteCharacterSubprompt(CHAR, 'gone')).resolves.toBe(false);
    await expect(deleteCharacterSubprompt(CHAR, 'a/b')).resolves.toBe(false);
  });
});

describe('resolveSelectedSubprompts', () => {
  it('returns the selected ones in listing order and drops unknown ids', async () => {
    await createCharacterSubprompt(CHAR, { title: 'Zulu', content: 'z' });
    await createCharacterSubprompt(CHAR, { title: 'Alpha', content: 'a' });
    await createCharacterSubprompt(CHAR, { title: 'Mike', content: 'm' });
    const resolved = await resolveSelectedSubprompts(CHAR, ['zulu', 'ghost', 'alpha']);
    expect(resolved).toEqual([
      { title: 'Alpha', content: 'a' },
      { title: 'Zulu', content: 'z' },
    ]);
  });
  it('is [] for an empty selection and never reads the vault', async () => {
    await expect(resolveSelectedSubprompts(CHAR, [])).resolves.toEqual([]);
    await expect(resolveSelectedSubprompts(CHAR, undefined)).resolves.toEqual([]);
    expect(listDatabaseFiles).not.toHaveBeenCalled();
  });
  it('fails soft to [] when the vault read throws', async () => {
    jest.mocked(listDatabaseFiles).mockRejectedValueOnce(new Error('boom'));
    await expect(resolveSelectedSubprompts(CHAR, ['x'])).resolves.toEqual([]);
  });
});
