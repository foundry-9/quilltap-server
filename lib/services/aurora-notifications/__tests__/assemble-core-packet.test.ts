/**
 * Repo-driven tests for `assembleCorePacket` — specifically the group-Core
 * merge: the character's own `Core/*.md` first, then the shared `Core/*.md` of
 * every group they belong to, labeled by group name, with no mount read twice.
 *
 * jest.setup.ts already globally mocks `@/lib/repositories/factory`
 * (getRepositories). We configure it per-test via jest.mocked in beforeEach —
 * no re-mocking. Repos object is a minimal hand-built mock of the methods the
 * subject calls.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { assembleCorePacket } from '../core-whisper';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';

const PACKET_BUDGET = 4096;

interface CoreDoc {
  relativePath: string;
  content: string;
}

/**
 * Build a mock repos object. `coreByMount` maps a mount-point id to the
 * `Core/*.md` docs stored under it; `findManyByMountPointsInFolder` returns the
 * union for the requested mount ids.
 */
function makeMockRepos(opts: {
  characterMountPointId: string | null;
  memberships?: Array<{ groupId: string }>;
  groups?: Record<string, { id: string; name: string; officialMountPointId: string | null }>;
  links?: Record<string, Array<{ mountPointId: string }>>;
  coreByMount?: Record<string, CoreDoc[]>;
}) {
  const {
    characterMountPointId,
    memberships = [],
    groups = {},
    links = {},
    coreByMount = {},
  } = opts;

  return {
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue(
        characterMountPointId === undefined
          ? null
          : { id: 'char-1', characterDocumentMountPointId: characterMountPointId },
      ),
    },
    groupCharacterMembers: {
      findByCharacterId: jest.fn().mockResolvedValue(memberships),
    },
    groups: {
      findByIdRaw: jest.fn().mockImplementation(async (id: string) => groups[id] ?? null),
    },
    groupDocMountLinks: {
      findByGroupId: jest.fn().mockImplementation(async (id: string) => links[id] ?? []),
    },
    docMountDocuments: {
      findManyByMountPointsInFolder: jest
        .fn()
        .mockImplementation(async (mountIds: string[]) =>
          mountIds.flatMap((id) => coreByMount[id] ?? []),
        ),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('assembleCorePacket — group Core merge', () => {
  it('merges personal Core first, then group Core labeled by group name', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        characterMountPointId: 'vault-1',
        memberships: [{ groupId: 'grp-1' }],
        groups: { 'grp-1': { id: 'grp-1', name: 'The Circle', officialMountPointId: 'grp-mount-1' } },
        coreByMount: {
          'vault-1': [{ relativePath: 'Core/manifesto.md', content: 'Personal truth.' }],
          'grp-mount-1': [{ relativePath: 'Core/charter.md', content: 'Shared charter.' }],
        },
      }) as never,
    );

    const packet = await assembleCorePacket('char-1', PACKET_BUDGET);

    expect(packet).not.toBeNull();
    expect(packet!.files).toEqual([
      { path: 'Core/manifesto.md', body: 'Personal truth.' },
      { path: 'Core/charter.md', body: 'Shared charter.', sourceLabel: 'The Circle' },
    ]);
  });

  it('offers group Core even when the character has no vault of their own', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        characterMountPointId: null,
        memberships: [{ groupId: 'grp-1' }],
        groups: { 'grp-1': { id: 'grp-1', name: 'The Circle', officialMountPointId: 'grp-mount-1' } },
        coreByMount: {
          'grp-mount-1': [{ relativePath: 'Core/charter.md', content: 'Shared charter.' }],
        },
      }) as never,
    );

    const packet = await assembleCorePacket('char-1', PACKET_BUDGET);

    expect(packet).not.toBeNull();
    expect(packet!.files).toEqual([
      { path: 'Core/charter.md', body: 'Shared charter.', sourceLabel: 'The Circle' },
    ]);
  });

  it('leaves the personal-only path unchanged (no group membership → no labels)', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({
        characterMountPointId: 'vault-1',
        memberships: [],
        coreByMount: {
          'vault-1': [{ relativePath: 'Core/manifesto.md', content: 'Personal truth.' }],
        },
      }) as never,
    );

    const packet = await assembleCorePacket('char-1', PACKET_BUDGET);

    expect(packet).not.toBeNull();
    expect(packet!.files).toEqual([{ path: 'Core/manifesto.md', body: 'Personal truth.' }]);
    expect(packet!.files[0].sourceLabel).toBeUndefined();
  });

  it('returns null when there is neither personal nor group Core', async () => {
    jest.mocked(getRepositories).mockReturnValue(
      makeMockRepos({ characterMountPointId: null, memberships: [] }) as never,
    );

    const packet = await assembleCorePacket('char-1', PACKET_BUDGET);
    expect(packet).toBeNull();
  });

  it('does not read a store twice when a group links the character vault', async () => {
    const repos = makeMockRepos({
      characterMountPointId: 'vault-1',
      memberships: [{ groupId: 'grp-1' }],
      // Group's official store IS the character's own vault — must be skipped.
      groups: { 'grp-1': { id: 'grp-1', name: 'The Circle', officialMountPointId: 'vault-1' } },
      coreByMount: {
        'vault-1': [{ relativePath: 'Core/manifesto.md', content: 'Personal truth.' }],
      },
    });
    jest.mocked(getRepositories).mockReturnValue(repos as never);

    const packet = await assembleCorePacket('char-1', PACKET_BUDGET);

    expect(packet).not.toBeNull();
    // Only the personal copy survives — no duplicated, group-labeled entry.
    expect(packet!.files).toEqual([{ path: 'Core/manifesto.md', body: 'Personal truth.' }]);
  });
});
