/**
 * Bug 152 — the doc-tool opacity covenant (`systemTransparency !== true`) hides
 * CHARACTER VAULTS. It must not also hide the character's own GROUP stores.
 *
 * The old gate hid vaults by returning a resolution context with `characterId`
 * removed. `resolveTieredMountPool` derives the group tier from `characterId`
 * and from nothing else, so the omission silently erased every group store the
 * character belonged to — by name and by id, since both lookups iterate only
 * the accessible set.
 *
 * These run against the REAL tiered-mount-pool (only the repositories and the
 * instance-settings singleton are mocked), because the defect lived in the
 * composition of the gate and the pool rather than in either one alone.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { resolveDocEditPath, PathResolutionError, SELF_VAULT_TOKEN } from '../path-resolver';
import { flattenTierPool } from '@/lib/mount-index/tiered-mount-pool';
import {
  buildReadResolutionContext,
  buildWriteResolutionContext,
} from '@/lib/tools/handlers/doc-edit/shared';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
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
 * The reported shape: the acting character is a member of one group whose
 * OFFICIAL store is not linked to the active project, so the project tier
 * cannot stand in for it.
 */
function mockWorld(opts: { transparency?: boolean } = {}) {
  const { transparency = false } = opts;
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findById: jest.fn().mockImplementation(async (id: string) =>
        id === ACTING
          ? { id: ACTING, systemTransparency: transparency, characterDocumentMountPointId: OWN_VAULT.id }
          : { id: PEER, systemTransparency: true, characterDocumentMountPointId: PEER_VAULT.id },
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
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => ALL_STORES.find((s) => s.id === id) ?? null),
      findEnabled: jest.fn().mockResolvedValue(ALL_STORES),
    },
    chats: { findById: jest.fn().mockResolvedValue({ id: 'chat-1', allowCrossCharacterVaultReads: false, participants: [] }) },
  } as never);
}

/** The doc-edit tool context the Salon builds for a character's own turn. */
const toolContext = { chatId: 'chat-1', userId: 'u1', projectId: 'proj-1', characterId: ACTING };

beforeEach(() => jest.clearAllMocks());

describe('an opaque character keeps her own group stores', () => {
  it('resolves a group store by NAME (the reported failure)', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: GROUP_STORE.name }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'The Real History.md', ctx);

    expect(resolved.mountPointId).toBe(GROUP_STORE.id);
  });

  it('resolves a group store by ID', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: GROUP_STORE.id }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'The Real History.md', ctx);

    expect(resolved.mountPointId).toBe(GROUP_STORE.id);
  });

  it('resolves a group store on the READ path too', async () => {
    mockWorld();
    const ctx = await buildReadResolutionContext({ mount_point: GROUP_STORE.name }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'The Real History.md', ctx);

    expect(resolved.mountPointId).toBe(GROUP_STORE.id);
  });

  it('still reaches project-linked stores', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: PROJECT_STORE.name }, toolContext);

    const resolved = await resolveDocEditPath('document_store', 'notes.md', ctx);

    expect(resolved.mountPointId).toBe(PROJECT_STORE.id);
  });
});

describe('the covenant itself is unchanged', () => {
  it('keeps the acting character OWN vault hidden by name', async () => {
    mockWorld();
    const ctx = await buildReadResolutionContext({ mount_point: OWN_VAULT.name }, toolContext);

    await expect(resolveDocEditPath('document_store', 'x.md', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } as Partial<PathResolutionError>);
  });

  it('keeps a PEER vault hidden by name, and does not admit it exists', async () => {
    mockWorld();
    const ctx = await buildReadResolutionContext({ mount_point: PEER_VAULT.name }, toolContext);

    // NOT_FOUND, not ACCESS_DENIED: the out-of-scope disclosure must never
    // name a vault, or the refusal leaks what the covenant withholds.
    await expect(resolveDocEditPath('document_store', 'x.md', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } as Partial<PathResolutionError>);
  });

  it('refuses the reserved "self" token', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: SELF_VAULT_TOKEN }, toolContext);

    await expect(resolveDocEditPath('document_store', 'x.md', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } as Partial<PathResolutionError>);
  });

  it('sets hideCharacterVaults while KEEPING the character the group tier is keyed on', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: GROUP_STORE.name }, toolContext);

    expect(ctx.hideCharacterVaults).toBe(true);
    expect(ctx.characterId).toBe(ACTING);
  });
});

describe('a transparent character is unaffected', () => {
  it('reaches her own vault and her group store', async () => {
    mockWorld({ transparency: true });

    const vaultCtx = await buildReadResolutionContext({ mount_point: OWN_VAULT.name }, toolContext);
    await expect(resolveDocEditPath('document_store', 'x.md', vaultCtx)).resolves.toMatchObject({
      mountPointId: OWN_VAULT.id,
    });

    const groupCtx = await buildReadResolutionContext({ mount_point: GROUP_STORE.name }, toolContext);
    await expect(resolveDocEditPath('document_store', 'x.md', groupCtx)).resolves.toMatchObject({
      mountPointId: GROUP_STORE.id,
    });

    expect(vaultCtx.hideCharacterVaults).toBeUndefined();
  });
});

describe('a store that exists but is out of scope says so', () => {
  it('answers ACCESS_DENIED and tells the caller not to retry a spelling', async () => {
    mockWorld();
    // A non-vault store that is neither project-linked nor one of her groups'.
    const stranger = {
      id: 'mp-stranger',
      name: 'Someone Elses Papers',
      enabled: true,
      mountType: 'database',
      storeType: 'documents',
      basePath: '',
    };
    const repos = getRepositories() as unknown as {
      docMountPoints: { findEnabled: jest.Mock };
    };
    repos.docMountPoints.findEnabled.mockResolvedValue([...ALL_STORES, stranger]);

    const ctx = await buildWriteResolutionContext({ mount_point: stranger.name }, toolContext);

    await expect(resolveDocEditPath('document_store', 'x.md', ctx)).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    } as Partial<PathResolutionError>);
  });

  it('still answers NOT_FOUND for a store that does not exist at all', async () => {
    mockWorld();
    const ctx = await buildWriteResolutionContext({ mount_point: 'Group' }, toolContext);

    await expect(resolveDocEditPath('document_store', 'x.md', ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } as Partial<PathResolutionError>);
  });
});

// The pool helper gained the vocabulary the gate needed. Unit-level, since the
// subtraction is what the resolver now leans on.
describe('flattenTierPool: includeCharacterTier', () => {
  const pool = {
    characterMountPointId: 'vault-own',
    groupMountPointIds: ['grp-a', 'grp-b'],
    projectMountPointIds: ['proj-a'],
    globalMountPointId: 'general',
    participantMountPointIds: ['vault-peer'],
  };

  it('drops both vault tiers and keeps group, project and global', () => {
    const ids = flattenTierPool(pool, { includeCharacterTier: false, includeParticipants: false });

    expect(ids).toEqual(expect.arrayContaining(['grp-a', 'grp-b', 'proj-a', 'general']));
    expect(ids).not.toContain('vault-own');
    expect(ids).not.toContain('vault-peer');
  });

  it('includes the character tier by default', () => {
    expect(flattenTierPool(pool, { includeParticipants: true })).toEqual(
      expect.arrayContaining(['vault-own', 'vault-peer', 'grp-a', 'proj-a', 'general']),
    );
  });
});
