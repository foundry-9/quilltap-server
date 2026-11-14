/**
 * The own-vault core guard: a character without `systemTransparency` may work
 * in her own vault's non-core folders (Scenarios, Knowledge, Tools, lore, and
 * any folder she makes) but may neither read nor change its root-level files
 * or the core folders (Prompts, Wardrobe, Outfits, Inventory, Mail, images).
 *
 * Built like its siblings (`path-resolver-opacity-*.test.ts`): against the REAL
 * tiered-mount-pool, mocking only the repositories, instance settings and the
 * database-store reader.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { resolveDocEditPath, PathResolutionError, SELF_VAULT_TOKEN } from '../path-resolver';
import {
  CHARACTER_VAULT_CORE_FOLDERS,
  isOwnVaultCorePath,
  isOwnVaultEntryHidden,
} from '@/lib/characters/vault/core-guard';
import { handleGrep, handleListFiles } from '@/lib/tools/handlers/doc-edit/text-handlers';
import { handleReadBlob, handleListBlobs } from '@/lib/tools/handlers/doc-edit/blob-handlers';
import {
  assertCharacterMayRead,
  assertCharacterMayWrite,
  buildReadResolutionContext,
  buildWriteResolutionContext,
} from '@/lib/tools/handlers/doc-edit/shared';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { listDatabaseFiles } from '@/lib/mount-index/database-store';

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  listDatabaseBlobTexts: jest.fn().mockResolvedValue([]),
  readDatabaseBlobText: jest.fn().mockResolvedValue(null),
}));

const ACTING = 'char-leilani';

const OWN_VAULT = {
  id: 'mp-own-vault',
  name: 'Leilani Character Vault',
  enabled: true,
  mountType: 'database',
  storeType: 'character',
  basePath: '',
};
const PROJECT_STORE = {
  id: 'mp-project',
  name: 'Project Papers',
  enabled: true,
  mountType: 'database',
  storeType: 'documents',
  basePath: '',
};
const ALL_STORES = [OWN_VAULT, PROJECT_STORE];

/** What the vault holds: the core, plus the open folders. */
const VAULT_FILES: Array<{ relativePath: string; kind: 'file' | 'folder' }> = [
  { relativePath: 'identity.md', kind: 'file' },
  { relativePath: 'properties.json', kind: 'file' },
  { relativePath: 'Prompts', kind: 'folder' },
  { relativePath: 'Prompts/default.md', kind: 'file' },
  { relativePath: 'Wardrobe', kind: 'folder' },
  { relativePath: 'Wardrobe/coat.md', kind: 'file' },
  { relativePath: 'Scenarios', kind: 'folder' },
  { relativePath: 'Scenarios/harbour.md', kind: 'file' },
  { relativePath: 'Knowledge', kind: 'folder' },
  { relativePath: 'Knowledge/tides.md', kind: 'file' },
  { relativePath: 'Diary', kind: 'folder' },
  { relativePath: 'Diary/monday.md', kind: 'file' },
];

const toolContext = { chatId: 'chat-1', userId: 'u1', projectId: 'proj-1', characterId: ACTING };

function mockWorld(opts: { transparency?: boolean } = {}) {
  const { transparency = false } = opts;
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(listDatabaseFiles).mockImplementation(async (mountPointId: string, o?: { folder?: string }) =>
    VAULT_FILES
      .filter((f) => mountPointId === OWN_VAULT.id)
      .filter((f) => !o?.folder || f.relativePath.startsWith(`${o.folder}/`))
      .map((f) => ({
        relativePath: f.relativePath,
        fileName: f.relativePath.split('/').pop(),
        kind: f.kind,
        fileSizeBytes: 10,
        lastModified: new Date('2026-11-09T00:00:00Z').toISOString(),
        mountPointId,
      })) as never,
  );
  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findById: jest.fn().mockResolvedValue({
        id: ACTING,
        name: 'Leilani',
        systemTransparency: transparency,
        characterDocumentMountPointId: OWN_VAULT.id,
      }),
      findByIdRaw: jest.fn().mockResolvedValue({ id: ACTING, characterDocumentMountPointId: OWN_VAULT.id }),
    },
    groupCharacterMembers: { findByCharacterId: jest.fn().mockResolvedValue([]) },
    groups: { findByIdRaw: jest.fn().mockResolvedValue(null) },
    groupDocMountLinks: { findByGroupId: jest.fn().mockResolvedValue([]) },
    projectDocMountLinks: {
      findByProjectId: jest.fn().mockResolvedValue([{ mountPointId: PROJECT_STORE.id }]),
    },
    projects: {
      findById: jest.fn().mockResolvedValue({ id: 'proj-1', officialMountPointId: PROJECT_STORE.id }),
      canCharacterParticipate: jest.fn().mockResolvedValue(true),
    },
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => ALL_STORES.find((s) => s.id === id) ?? null),
      findEnabled: jest.fn().mockResolvedValue(ALL_STORES),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    docMountDocuments: {
      findByMountPointId: jest.fn().mockImplementation(async (mountPointId: string) =>
        mountPointId === OWN_VAULT.id
          ? VAULT_FILES.filter((f) => f.kind === 'file').map((f) => ({
              relativePath: f.relativePath,
              content: 'the tide turns',
              mountPointId,
            }))
          : [],
      ),
    },
    docMountBlobs: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      listByMountPoint: jest.fn().mockResolvedValue([
        { relativePath: 'images/avatar.webp', storedMimeType: 'image/webp', sizeBytes: 5 },
        { relativePath: 'portrait.webp', storedMimeType: 'image/webp', sizeBytes: 5 },
        { relativePath: 'Diary/sketch.webp', storedMimeType: 'image/webp', sizeBytes: 5 },
      ]),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        allowCrossCharacterVaultReads: false,
        participants: [{ characterId: ACTING, status: 'active' }],
      }),
    },
  } as never);
}

beforeEach(() => jest.clearAllMocks());

describe('the pure rule', () => {
  it('closes root-level files and everything in a core folder to file operations', () => {
    expect(isOwnVaultCorePath('identity.md', 'file')).toBe(true);
    expect(isOwnVaultCorePath('/properties.json', 'file')).toBe(true);
    for (const folder of CHARACTER_VAULT_CORE_FOLDERS) {
      expect(isOwnVaultCorePath(`${folder}/x.md`, 'file')).toBe(true);
      expect(isOwnVaultCorePath(`${folder.toUpperCase()}/deep/x.md`, 'file')).toBe(true);
    }
  });

  it('opens Scenarios, Knowledge, Tools and folders of her own', () => {
    for (const p of ['Scenarios/a.md', 'Knowledge/b.md', 'Tools/roll.json', 'Diary/deep/c.md', 'lore\\d.md']) {
      expect(isOwnVaultCorePath(p, 'file')).toBe(false);
    }
  });

  it('lets her create, move or delete a root folder that is not core, but not the core ones or the root', () => {
    expect(isOwnVaultCorePath('Diary', 'folder')).toBe(false);
    expect(isOwnVaultCorePath('Prompts', 'folder')).toBe(true);
    expect(isOwnVaultCorePath('wardrobe/', 'folder')).toBe(true);
    expect(isOwnVaultCorePath('', 'folder')).toBe(true);
  });

  it('lets her list the root, but not a core folder', () => {
    expect(isOwnVaultCorePath('', 'list')).toBe(false);
    expect(isOwnVaultCorePath('Mail', 'list')).toBe(true);
  });

  it('hides root files and core folders from listings', () => {
    expect(isOwnVaultEntryHidden('identity.md', 'file')).toBe(true);
    expect(isOwnVaultEntryHidden('Inventory', 'folder')).toBe(true);
    expect(isOwnVaultEntryHidden('Diary', 'folder')).toBe(false);
    expect(isOwnVaultEntryHidden('Diary/monday.md', 'file')).toBe(false);
  });
});

describe('resolution and the per-file gates', () => {
  it('resolves an open folder in her own vault and lets her read and write there', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: SELF_VAULT_TOKEN }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'Knowledge/tides.md', ctx);

    expect(resolved).toMatchObject({ mountPointId: OWN_VAULT.id, ownVaultGuarded: true });
    await expect(assertCharacterMayRead(resolved, toolContext)).resolves.toBeUndefined();
    await expect(assertCharacterMayWrite(resolved, toolContext)).resolves.toBeUndefined();
  });

  it('refuses a root-level file for reading, and for creating', async () => {
    mockWorld();
    const ctx = await buildReadResolutionContext({ mount_point: OWN_VAULT.name }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'identity.md', ctx);
    await expect(assertCharacterMayRead(resolved, toolContext)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });

    const fresh = await resolveDocEditPath('document_store', 'new-at-root.md', ctx);
    await expect(assertCharacterMayWrite(fresh, toolContext)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('refuses the core folders and the vault root at resolution', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: SELF_VAULT_TOKEN }, toolContext);

    for (const p of ['Prompts/default.md', 'Wardrobe/coat.md', 'Inventory', 'Mail/letter.md', 'images/a.webp', '']) {
      await expect(resolveDocEditPath('document_store', p, ctx)).rejects.toBeInstanceOf(PathResolutionError);
    }
  });

  it('admits a new root-level folder name (doc_create_folder resolves it)', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: SELF_VAULT_TOKEN }, toolContext);

    await expect(resolveDocEditPath('document_store', 'Diary', ctx)).resolves.toMatchObject({
      mountPointId: OWN_VAULT.id,
    });
  });

  it('leaves a transparent character unguarded', async () => {
    mockWorld({ transparency: true });
    const ctx = await buildReadResolutionContext({ mount_point: SELF_VAULT_TOKEN }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'Prompts/default.md', ctx);
    expect(resolved.ownVaultGuarded).toBeUndefined();
    await expect(assertCharacterMayRead(
      await resolveDocEditPath('document_store', 'identity.md', ctx), toolContext,
    )).resolves.toBeUndefined();
  });

  it('never guards the operator', async () => {
    mockWorld();
    const resolved = { ...(await resolveDocEditPath(
      'document_store', 'Knowledge/x.md',
      await buildReadResolutionContext({ mount_point: SELF_VAULT_TOKEN }, toolContext),
    )), relativePath: 'identity.md' };

    await expect(assertCharacterMayRead(resolved, { ...toolContext, operatorOverride: true })).resolves.toBeUndefined();
  });
});

describe('enumeration hides the core', () => {
  it('doc_list_files lists her open folders and none of the core', async () => {
    mockWorld();

    const res = await handleListFiles({ scope: 'document_store', mount_point: SELF_VAULT_TOKEN }, toolContext);

    const paths = (res.result?.files ?? []).map((f) => f.path).sort();
    expect(paths).toEqual(
      ['Diary', 'Diary/monday.md', 'Knowledge', 'Knowledge/tides.md', 'Scenarios', 'Scenarios/harbour.md'],
    );
  });

  it('doc_list_files on a core folder lists nothing', async () => {
    mockWorld();

    const res = await handleListFiles({ scope: 'document_store', mount_point: SELF_VAULT_TOKEN, folder: 'Prompts' }, toolContext);

    expect(res.result?.files ?? []).toHaveLength(0);
  });

  it('doc_grep finds matches only outside the core', async () => {
    mockWorld();

    const res = await handleGrep({ query: 'tide', mount_point: SELF_VAULT_TOKEN }, toolContext);

    const paths = (res.result?.matches ?? []).map((m) => m.path).sort();
    expect(paths).toEqual(['Diary/monday.md', 'Knowledge/tides.md', 'Scenarios/harbour.md']);
  });

  it('a transparent character still sees everything', async () => {
    mockWorld({ transparency: true });

    const res = await handleListFiles({ scope: 'document_store', mount_point: SELF_VAULT_TOKEN }, toolContext);

    expect((res.result?.files ?? []).map((f) => f.path)).toEqual(
      expect.arrayContaining(['identity.md', 'Prompts/default.md', 'Wardrobe/coat.md']),
    );
  });
});

describe('the blob tools', () => {
  it('lists only blobs outside the core', async () => {
    mockWorld();

    const res = await handleListBlobs({ mount_point: SELF_VAULT_TOKEN }, toolContext);

    expect(res.result?.blobs.map((b) => b.relative_path)).toEqual(['Diary/sketch.webp']);
  });

  it('refuses a core folder listing and a core blob read', async () => {
    mockWorld();

    await expect(handleListBlobs({ mount_point: SELF_VAULT_TOKEN, folder: 'images' }, toolContext))
      .resolves.toMatchObject({ success: false });
    const read = await handleReadBlob({ mount_point: SELF_VAULT_TOKEN, path: 'images/avatar.webp' }, toolContext);
    expect(read.error).toMatch(/core of your own vault/);
  });

  it('reaches a blob in an open folder', async () => {
    mockWorld();

    const res = await handleReadBlob({ mount_point: SELF_VAULT_TOKEN, path: 'Diary/sketch.webp' }, toolContext);

    // No metadata in the mock — but the guard let it through to the lookup.
    expect(res.error).toMatch(/Blob not found/);
  });
});
