/**
 * Bug 153 — the doc-tool opacity covenant was enforced when a tool RESOLVES a
 * path but not when it ENUMERATES stores.
 *
 * `collectAccessibleMountPointIds` honours `hideCharacterVaults`, so an opaque
 * character cannot OPEN a vault. `getAccessibleMountPoints` took no such flag
 * and its four callers (doc_grep, doc_list_files, and the two blob mount
 * resolvers) passed `characterId` unconditionally — so the listing advertised
 * the very vault names the covenant exists to hide, and the follow-up open then
 * refused them. The listing leaked, and the disagreement read to a model as a
 * broken tool rather than a boundary.
 *
 * Sibling of `path-resolver-opacity-group-stores.test.ts` (bug 152), and built
 * the same way: against the REAL tiered-mount-pool, mocking only the
 * repositories, the instance-settings singleton, and the database-store reader,
 * because the defect lives in the composition of the gate and the pool.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { getAccessibleMountPoints, resolveDocEditPath, SELF_VAULT_TOKEN } from '../path-resolver';
import { handleGrep, handleListFiles } from '@/lib/tools/handlers/doc-edit/text-handlers';
import { handleReadBlob, handleWriteBlob, handleListBlobs } from '@/lib/tools/handlers/doc-edit/blob-handlers';
import {
  actingCharacterIsOpaqueToVaults,
  buildReadResolutionContext,
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
}));

const ACTING = 'char-leilani';
const PEER = 'char-abigail';

const GROUP_STORE = {
  id: 'mp-group',
  name: 'Group Files: Severed',
  enabled: true,
  mountType: 'database',
  storeType: 'documents',
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
const OWN_VAULT = {
  id: 'mp-own-vault',
  name: 'Leilani Character Vault',
  enabled: true,
  mountType: 'database',
  storeType: 'character',
  basePath: '',
};
const PEER_VAULT = {
  id: 'mp-peer-vault',
  name: 'Abigail Character Vault',
  enabled: true,
  mountType: 'database',
  storeType: 'character',
  basePath: '',
};

const ALL_STORES = [GROUP_STORE, PROJECT_STORE, OWN_VAULT, PEER_VAULT];

/**
 * The reported shape: the acting character belongs to one group whose official
 * store is not project-linked, and shares a chat with one present peer whose
 * vault cross-character reads would otherwise admit.
 */
function mockWorld(opts: { transparency?: boolean; crossCharacterReads?: boolean } = {}) {
  const { transparency = false, crossCharacterReads = true } = opts;
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(listDatabaseFiles).mockImplementation(async (mountPointId: string) => [
    {
      relativePath: 'notes.md',
      fileName: 'notes.md',
      kind: 'file',
      fileSizeBytes: 12,
      lastModified: new Date('2026-09-17T00:00:00Z').toISOString(),
      mountPointId,
    },
  ] as never);
  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findById: jest.fn().mockImplementation(async (id: string) =>
        id === ACTING
          ? { id: ACTING, name: 'Leilani', systemTransparency: transparency, characterDocumentMountPointId: OWN_VAULT.id }
          : { id: PEER, name: 'Abigail', systemTransparency: true, characterDocumentMountPointId: PEER_VAULT.id },
      ),
      findByIdRaw: jest.fn().mockImplementation(async (id: string) =>
        id === ACTING
          ? { id: ACTING, characterDocumentMountPointId: OWN_VAULT.id }
          : { id: PEER, characterDocumentMountPointId: PEER_VAULT.id },
      ),
    },
    groupCharacterMembers: {
      findByCharacterId: jest.fn().mockImplementation(async (id: string) =>
        id === ACTING ? [{ groupId: 'grp-severed' }] : [],
      ),
    },
    groups: {
      findByIdRaw: jest.fn().mockResolvedValue({ id: 'grp-severed', officialMountPointId: GROUP_STORE.id }),
    },
    groupDocMountLinks: { findByGroupId: jest.fn().mockResolvedValue([]) },
    projectDocMountLinks: {
      findByProjectId: jest.fn().mockResolvedValue([{ mountPointId: PROJECT_STORE.id }]),
    },
    projects: {
      findById: jest.fn().mockResolvedValue({ id: 'proj-1', officialMountPointId: PROJECT_STORE.id }),
    },
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => ALL_STORES.find((s) => s.id === id) ?? null),
      findEnabled: jest.fn().mockResolvedValue(ALL_STORES),
    },
    docMountFileLinks: { findByMountPointId: jest.fn().mockResolvedValue([]) },
    docMountDocuments: {
      findByMountPointId: jest.fn().mockImplementation(async (mountPointId: string) => [
        { relativePath: 'notes.md', content: 'the quarry stone', mountPointId },
      ]),
    },
    docMountBlobs: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      listByMountPoint: jest.fn().mockResolvedValue([]),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        allowCrossCharacterVaultReads: crossCharacterReads,
        participants: [
          { characterId: ACTING, status: 'active' },
          { characterId: PEER, status: 'active' },
        ],
      }),
    },
  } as never);
}

/** The doc-edit tool context the Salon builds for a character's own turn. */
const toolContext = { chatId: 'chat-1', userId: 'u1', projectId: 'proj-1', characterId: ACTING };

/** The peer ids the read path would admit if the covenant did not apply. */
const PEERS = [PEER];

beforeEach(() => jest.clearAllMocks());

describe('getAccessibleMountPoints honours the covenant', () => {
  it('omits BOTH vault tiers for an opaque character', async () => {
    mockWorld();

    const listed = await getAccessibleMountPoints({
      projectId: 'proj-1',
      characterId: ACTING,
      extraCharacterIds: PEERS,
      hideCharacterVaults: true,
    });

    const ids = listed.map((mp) => mp.id);
    expect(ids).not.toContain(OWN_VAULT.id);
    expect(ids).not.toContain(PEER_VAULT.id);
  });

  it('keeps the group and project tiers (bug 152 must not regress)', async () => {
    mockWorld();

    const listed = await getAccessibleMountPoints({
      projectId: 'proj-1',
      characterId: ACTING,
      extraCharacterIds: PEERS,
      hideCharacterVaults: true,
    });

    expect(listed.map((mp) => mp.id)).toEqual(expect.arrayContaining([GROUP_STORE.id, PROJECT_STORE.id]));
  });

  it('lists both vaults when the flag is absent', async () => {
    mockWorld({ transparency: true });

    const listed = await getAccessibleMountPoints({
      projectId: 'proj-1',
      characterId: ACTING,
      extraCharacterIds: PEERS,
    });

    expect(listed.map((mp) => mp.id)).toEqual(
      expect.arrayContaining([OWN_VAULT.id, PEER_VAULT.id, GROUP_STORE.id, PROJECT_STORE.id]),
    );
  });

  it('agrees with resolution: everything listed also opens', async () => {
    mockWorld();
    const hideCharacterVaults = await actingCharacterIsOpaqueToVaults(toolContext);

    const listed = await getAccessibleMountPoints({
      projectId: 'proj-1',
      characterId: ACTING,
      extraCharacterIds: PEERS,
      hideCharacterVaults,
    });

    expect(listed.length).toBeGreaterThan(0);
    for (const mp of listed) {
      const ctx = await buildReadResolutionContext({ mount_point: mp.name }, toolContext);
      await expect(resolveDocEditPath('document_store', 'x.md', ctx)).resolves.toMatchObject({
        mountPointId: mp.id,
      });
    }
  });
});

describe('doc_list_files does not advertise a vault it cannot open', () => {
  it('leaves both vault names out of the listing', async () => {
    mockWorld();

    const res = await handleListFiles({ scope: 'document_store' }, toolContext);

    expect(res.success).toBe(true);
    const mounts = new Set((res.result?.files ?? []).map((f) => f.mount_point));
    expect(mounts).not.toContain(OWN_VAULT.name);
    expect(mounts).not.toContain(PEER_VAULT.name);
    expect(mounts).toContain(GROUP_STORE.name);
  });

  it('returns nothing for mount_point "self"', async () => {
    mockWorld();

    const res = await handleListFiles({ scope: 'document_store', mount_point: SELF_VAULT_TOKEN }, toolContext);

    expect(res.success).toBe(true);
    expect(res.result?.files ?? []).toHaveLength(0);
  });

  it('returns nothing for the acting character own vault by name', async () => {
    mockWorld();

    const res = await handleListFiles({ scope: 'document_store', mount_point: OWN_VAULT.name }, toolContext);

    expect(res.success).toBe(true);
    expect(res.result?.files ?? []).toHaveLength(0);
  });

  it('still lists both vaults for a TRANSPARENT character', async () => {
    mockWorld({ transparency: true });

    const res = await handleListFiles({ scope: 'document_store' }, toolContext);

    const mounts = new Set((res.result?.files ?? []).map((f) => f.mount_point));
    expect(mounts).toContain(OWN_VAULT.name);
    expect(mounts).toContain(PEER_VAULT.name);
  });
});

describe('doc_grep does not search or name a hidden vault', () => {
  it('omits vault hits for an opaque character', async () => {
    mockWorld();

    const res = await handleGrep({ query: 'quarry' }, toolContext);

    expect(res.success).toBe(true);
    const mounts = new Set((res.result?.matches ?? []).map((m) => m.mount_point));
    expect(mounts).not.toContain(OWN_VAULT.name);
    expect(mounts).not.toContain(PEER_VAULT.name);
    expect(mounts).toContain(GROUP_STORE.name);
  });

  it('finds nothing when restricted to "self"', async () => {
    mockWorld();

    const res = await handleGrep({ query: 'quarry', mount_point: SELF_VAULT_TOKEN }, toolContext);

    expect(res.success).toBe(true);
    expect(res.result?.matches ?? []).toHaveLength(0);
  });

  it('still searches both vaults for a TRANSPARENT character', async () => {
    mockWorld({ transparency: true });

    const res = await handleGrep({ query: 'quarry' }, toolContext);

    const mounts = new Set((res.result?.matches ?? []).map((m) => m.mount_point));
    expect(mounts).toContain(OWN_VAULT.name);
    expect(mounts).toContain(PEER_VAULT.name);
  });
});

describe('the blob tools resolve mounts under the same covenant', () => {
  it('refuses a read from the acting character own vault, and from "self"', async () => {
    mockWorld();

    await expect(
      handleReadBlob({ mount_point: OWN_VAULT.name, path: 'portrait.webp' }, toolContext),
    ).resolves.toMatchObject({ success: false });
    await expect(
      handleReadBlob({ mount_point: SELF_VAULT_TOKEN, path: 'portrait.webp' }, toolContext),
    ).resolves.toMatchObject({ success: false });
  });

  it('refuses a listing of a peer vault', async () => {
    mockWorld();

    await expect(
      handleListBlobs({ mount_point: PEER_VAULT.name }, toolContext),
    ).resolves.toMatchObject({ success: false });
  });

  it('refuses a write to the acting character own vault', async () => {
    mockWorld();

    await expect(
      handleWriteBlob(
        {
          mount_point: OWN_VAULT.name,
          path: 'portrait.webp',
          data_base64: Buffer.from('nope').toString('base64'),
          original_filename: 'portrait.webp',
          mime_type: 'image/webp',
        },
        toolContext,
      ),
    ).resolves.toMatchObject({ success: false });
  });

  it('still reaches the group store', async () => {
    mockWorld();

    // No blob at that path — but the MOUNT resolved, which is what the
    // covenant governs. A hidden vault fails one step earlier, on the mount.
    const res = await handleReadBlob({ mount_point: GROUP_STORE.name, path: 'seal.webp' }, toolContext);

    expect(res.error).toMatch(/Blob not found/);
  });
});
