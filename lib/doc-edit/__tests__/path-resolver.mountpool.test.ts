/**
 * Scenario Builder mount pool threading (docs/developer/features/scenario-builder.md
 * §5.2): a pre-built `TieredMountPool` stands in for a chat's normal
 * project/character resolution when the tool loop runs before any chat row
 * exists. `PathResolutionContext.mountPool`, when set, IS the accessible set —
 * `collectAccessibleMountPointIds` flattens it (participant tier included) and
 * never consults `characterId` / `projectId` for membership.
 *
 * These run against the real path resolver with only the repositories and
 * `getGeneralMountPointId` mocked, mirroring
 * `path-resolver-opacity-group-stores.test.ts`.
 */

// ── Subject ──────────────────────────────────────────────────────────────────
import { resolveDocEditPath, PathResolutionError } from '../path-resolver';
import { buildReadResolutionContext } from '@/lib/tools/handlers/doc-edit/shared';
import { handleListFiles } from '@/lib/tools/handlers/doc-edit/text-handlers';
import type { TieredMountPool } from '@/lib/mount-index/tiered-mount-pool';

// ── Mocks ────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { listDatabaseFiles } from '@/lib/mount-index/database-store';

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

const PARTICIPANT_VAULT = {
  id: 'mp-participant-vault',
  name: 'Castmate Vault',
  enabled: true,
  mountType: 'database',
  storeType: 'character',
  basePath: '',
};
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
const STRANGER_STORE = {
  id: 'mp-stranger',
  name: 'Someone Elses Papers',
  enabled: true,
  mountType: 'database',
  storeType: 'documents',
  basePath: '',
};

const ALL_STORES = [PARTICIPANT_VAULT, GROUP_STORE, PROJECT_STORE, STRANGER_STORE];

function mockWorld() {
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(getRepositories).mockReturnValue({
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => ALL_STORES.find((s) => s.id === id) ?? null),
      findEnabled: jest.fn().mockResolvedValue(ALL_STORES),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({ id: 'chat-1', allowCrossCharacterVaultReads: false, participants: [] }),
    },
  } as never);
}

function emptyPool(overrides: Partial<TieredMountPool> = {}): TieredMountPool {
  return {
    characterMountPointId: null,
    participantMountPointIds: [],
    groupMountPointIds: [],
    projectMountPointIds: [],
    globalMountPointId: null,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('resolveDocEditPath with a pre-built mountPool', () => {
  it('admits a cast participant vault via the pool', async () => {
    mockWorld();
    const pool = emptyPool({ participantMountPointIds: [PARTICIPANT_VAULT.id] });

    const resolved = await resolveDocEditPath('document_store', 'notes.md', {
      mountPool: pool,
      mountPoint: PARTICIPANT_VAULT.name,
    });

    expect(resolved.mountPointId).toBe(PARTICIPANT_VAULT.id);
  });

  it('admits a group store via the pool', async () => {
    mockWorld();
    const pool = emptyPool({ groupMountPointIds: [GROUP_STORE.id] });

    const resolved = await resolveDocEditPath('document_store', 'notes.md', {
      mountPool: pool,
      mountPoint: GROUP_STORE.name,
    });

    expect(resolved.mountPointId).toBe(GROUP_STORE.id);
  });

  it('refuses an unrelated ENABLED store that exists but is out of the pool\'s scope', async () => {
    mockWorld();
    // The pool admits the group store but not the stranger store, which is
    // still an enabled, non-character store elsewhere in the instance.
    const pool = emptyPool({ groupMountPointIds: [GROUP_STORE.id] });

    await expect(
      resolveDocEditPath('document_store', 'x.md', {
        mountPool: pool,
        mountPoint: STRANGER_STORE.name,
      })
    ).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      message:
        `The document store "${STRANGER_STORE.name}" exists but is not reachable from this conversation. ` +
        `It is not linked to this project, and it is not one of your own group's stores. ` +
        `Retrying with a different spelling will not help — use doc_list_files with no path to see the stores you can reach.`,
    } as Partial<PathResolutionError>);
  });

  it('works with no projectId and no characterId set on the context — the pool alone is sufficient', async () => {
    mockWorld();
    const pool = emptyPool({ projectMountPointIds: [PROJECT_STORE.id] });

    const resolved = await resolveDocEditPath('document_store', 'notes.md', {
      mountPool: pool,
      mountPoint: PROJECT_STORE.name,
      // deliberately no projectId, no characterId
    });

    expect(resolved.mountPointId).toBe(PROJECT_STORE.id);
  });
});

describe('buildReadResolutionContext forwards mountPool', () => {
  it('carries the same mountPool reference onto the produced context', async () => {
    mockWorld();
    const pool = emptyPool({ participantMountPointIds: [PARTICIPANT_VAULT.id] });

    const ctx = await buildReadResolutionContext(
      { mount_point: PARTICIPANT_VAULT.name },
      { chatId: 'chat-1', userId: 'u1', mountPool: pool }
    );

    expect(ctx.mountPool).toBe(pool);
  });
});

describe('handleListFiles accepts mountPool as an alternative to projectId', () => {
  it('does not refuse with "List files requires a project context" when a mountPool is present', async () => {
    mockWorld();
    jest.mocked(listDatabaseFiles).mockResolvedValue([]);
    const pool = emptyPool({ groupMountPointIds: [GROUP_STORE.id] });

    const result = await handleListFiles(
      { scope: 'document_store' },
      { chatId: 'chat-1', userId: 'u1', mountPool: pool }
    );

    expect(result.error).not.toBe('List files requires a project context');
    expect(result.success).toBe(true);
  });

  it('still refuses with the project-context error when neither projectId nor mountPool is present', async () => {
    mockWorld();

    const result = await handleListFiles(
      { scope: 'document_store' },
      { chatId: 'chat-1', userId: 'u1' }
    );

    expect(result).toEqual({ success: false, error: 'List files requires a project context' });
  });
});
