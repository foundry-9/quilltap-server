/**
 * Project roster access — the roster gates a character's TOOL access to the
 * project's files and shared wardrobe, and nothing else.
 *
 * Built against the real tiered-mount-pool and path resolver, mocking only the
 * repositories and the instance-settings singleton, so the gate is tested in
 * composition with the pool it narrows.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { projectRosterAdmits, rosterGatedProjectId } from '../roster-access';
import { getAccessibleMountPoints, resolveDocEditPath, PathResolutionError } from '@/lib/doc-edit/path-resolver';
import { resolveSharedWardrobeTiersForChat } from '@/lib/wardrobe/shared-tiers';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

const ON_ROSTER = 'char-rostered';
const OFF_ROSTER = 'char-stranger';

const PROJECT_STORE = {
  id: 'mp-project',
  name: 'Project Papers',
  enabled: true,
  mountType: 'database',
  storeType: 'documents',
  basePath: '',
};

function mockWorld(opts: { allowAnyCharacter?: boolean } = {}) {
  const { allowAnyCharacter = false } = opts;
  const project = {
    id: 'proj-1',
    officialMountPointId: PROJECT_STORE.id,
    allowAnyCharacter,
    characterRoster: [ON_ROSTER],
  };
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findById: jest.fn().mockImplementation(async (id: string) => ({ id, characterDocumentMountPointId: null })),
    },
    groupCharacterMembers: { findByCharacterId: jest.fn().mockResolvedValue([]) },
    groups: { findByIdRaw: jest.fn().mockResolvedValue(null) },
    groupDocMountLinks: { findByGroupId: jest.fn().mockResolvedValue([]) },
    projectDocMountLinks: {
      findByProjectId: jest.fn().mockResolvedValue([{ mountPointId: PROJECT_STORE.id }]),
    },
    projects: {
      findById: jest.fn().mockResolvedValue(project),
      canCharacterParticipate: jest.fn().mockImplementation(async (_projectId: string, characterId: string) =>
        project.allowAnyCharacter || project.characterRoster.includes(characterId),
      ),
    },
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => (id === PROJECT_STORE.id ? PROJECT_STORE : null)),
      findEnabled: jest.fn().mockResolvedValue([PROJECT_STORE]),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({ id: 'chat-1', projectId: 'proj-1' }),
    },
  } as never);
}

beforeEach(() => jest.clearAllMocks());

describe('projectRosterAdmits', () => {
  it('admits a rostered character and refuses one off the roster', async () => {
    mockWorld();
    await expect(projectRosterAdmits('proj-1', ON_ROSTER)).resolves.toBe(true);
    await expect(projectRosterAdmits('proj-1', OFF_ROSTER)).resolves.toBe(false);
  });

  it('admits everyone when Allow Any Character is on', async () => {
    mockWorld({ allowAnyCharacter: true });
    await expect(projectRosterAdmits('proj-1', OFF_ROSTER)).resolves.toBe(true);
  });

  it('does not gate a project-less chat or an operator surface', async () => {
    mockWorld();
    await expect(projectRosterAdmits(null, OFF_ROSTER)).resolves.toBe(true);
    await expect(projectRosterAdmits('proj-1', null)).resolves.toBe(true);
  });

  it('rosterGatedProjectId withholds the project id off the roster', async () => {
    mockWorld();
    await expect(rosterGatedProjectId('proj-1', ON_ROSTER)).resolves.toBe('proj-1');
    await expect(rosterGatedProjectId('proj-1', OFF_ROSTER)).resolves.toBeUndefined();
  });
});

describe('doc tools', () => {
  it('lists the project store for a rostered character only', async () => {
    mockWorld();
    const onIds = (await getAccessibleMountPoints({ projectId: 'proj-1', characterId: ON_ROSTER })).map((m) => m.id);
    const offIds = (await getAccessibleMountPoints({ projectId: 'proj-1', characterId: OFF_ROSTER })).map((m) => m.id);
    expect(onIds).toContain(PROJECT_STORE.id);
    expect(offIds).not.toContain(PROJECT_STORE.id);
  });

  it('refuses scope "project" off the roster with ACCESS_DENIED', async () => {
    mockWorld();
    const attempt = resolveDocEditPath('project', 'plan.md', { projectId: 'proj-1', characterId: OFF_ROSTER });
    await expect(attempt).rejects.toBeInstanceOf(PathResolutionError);
    await expect(attempt).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('resolves scope "project" for a rostered character', async () => {
    mockWorld();
    await expect(
      resolveDocEditPath('project', 'plan.md', { projectId: 'proj-1', characterId: ON_ROSTER }),
    ).resolves.toMatchObject({ mountPointId: PROJECT_STORE.id });
  });
});

describe('shared wardrobe', () => {
  it('withholds the project tier off the roster', async () => {
    mockWorld();
    const off = await resolveSharedWardrobeTiersForChat('chat-1', OFF_ROSTER);
    const on = await resolveSharedWardrobeTiersForChat('chat-1', ON_ROSTER);
    expect(off.projectMountPointIds).toEqual([]);
    expect(on.projectMountPointIds).toEqual([PROJECT_STORE.id]);
  });

  it('lets the operator dress any character from the project wardrobe', async () => {
    mockWorld();
    const tiers = await resolveSharedWardrobeTiersForChat('chat-1', OFF_ROSTER, { operator: true });
    expect(tiers.projectMountPointIds).toEqual([PROJECT_STORE.id]);
  });
});
