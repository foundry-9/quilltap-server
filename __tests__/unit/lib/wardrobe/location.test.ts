/**
 * Wardrobe locations (`lib/wardrobe/location.ts`) — the one answer to "where
 * does this item live". Pins ownership, opt-in provisioning (bug 192's
 * side-effect half), and the archived-character tombstone on writes.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

const mockGeneralId = jest.fn();
jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: (...args: unknown[]) => mockGeneralId(...args),
}));

const mockEnsureOwnerStore = jest.fn();
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: (...args: unknown[]) => mockEnsureOwnerStore(...args),
}));

const mockEnsureFolder = jest.fn();
jest.mock('@/lib/mount-index/shared-wardrobe', () => ({
  ensureSharedWardrobeFolder: (...args: unknown[]) => mockEnsureFolder(...args),
}));

const mockReadMountItems = jest.fn();
const mockCreateInMount = jest.fn();
const mockUpdateInMount = jest.fn();
const mockDeleteInMount = jest.fn();
const mockResolveWardrobeMount = jest.fn();
jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  readMountItems: (...a: unknown[]) => mockReadMountItems(...a),
  createInMount: (...a: unknown[]) => mockCreateInMount(...a),
  updateInMount: (...a: unknown[]) => mockUpdateInMount(...a),
  deleteInMount: (...a: unknown[]) => mockDeleteInMount(...a),
  resolveWardrobeMount: (...a: unknown[]) => mockResolveWardrobeMount(...a),
}));

const { locationKey, resolveWardrobeLocation } =
  require('@/lib/wardrobe/location') as typeof import('@/lib/wardrobe/location');
const { CharacterArchivedError } = require('@/lib/database/repositories/characters.repository');

const USER = 'user-1';

function makeRepos() {
  return {
    characters: {
      findByIdRaw: jest.fn(async (id: string) =>
        id === 'char-1'
          ? { id, userId: USER, name: 'Ada', characterDocumentMountPointId: 'vault-1' }
          : id === 'char-other'
            ? { id, userId: 'someone-else', name: 'Bo', characterDocumentMountPointId: 'vault-2' }
            : null,
      ),
    },
    projects: {
      findById: jest.fn(async (id: string) =>
        id === 'proj-1' ? { id, name: 'Manor', officialMountPointId: null } : id === 'proj-2' ? { id, name: 'Abbey', officialMountPointId: 'proj-mp-2' } : null,
      ),
    },
    groups: { findById: jest.fn(async (id: string) => (id === 'grp-1' ? { id, name: 'Guild', officialMountPointId: 'grp-mp' } : null)) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeneralId.mockResolvedValue('general-mp');
  mockEnsureOwnerStore.mockResolvedValue({ mountPointId: 'proj-mp-new' });
});

describe('resolveWardrobeLocation', () => {
  it("resolves a character's vault with the character's origin", async () => {
    const loc = await resolveWardrobeLocation('character', 'char-1', makeRepos() as never, USER);
    expect(loc).toMatchObject({
      scope: 'character',
      id: 'char-1',
      characterId: 'char-1',
      mountPointId: 'vault-1',
      origin: { scope: 'character', id: 'char-1', name: 'Ada' },
    });
  });

  it("refuses another user's character", async () => {
    expect(await resolveWardrobeLocation('character', 'char-other', makeRepos() as never, USER)).toBeNull();
  });

  it('refuses a non-General scope without an id', async () => {
    expect(await resolveWardrobeLocation('group', null, makeRepos() as never, USER)).toBeNull();
  });

  it('returns null for General when it is not provisioned', async () => {
    mockGeneralId.mockResolvedValue(null);
    expect(await resolveWardrobeLocation('general', null, makeRepos() as never, USER)).toBeNull();
  });

  it('a read probe never provisions a missing project store', async () => {
    const loc = await resolveWardrobeLocation('project', 'proj-1', makeRepos() as never, USER);
    expect(loc).toBeNull();
    expect(mockEnsureOwnerStore).not.toHaveBeenCalled();
    expect(mockEnsureFolder).not.toHaveBeenCalled();
  });

  it('a read probe of an existing store uses it as-is', async () => {
    const loc = await resolveWardrobeLocation('group', 'grp-1', makeRepos() as never, USER);
    expect(loc).toMatchObject({ scope: 'group', id: 'grp-1', mountPointId: 'grp-mp', characterId: null });
    expect(mockEnsureFolder).not.toHaveBeenCalled();
  });

  it('ensure provisions the store and its Wardrobe folder for a writer', async () => {
    const loc = await resolveWardrobeLocation('project', 'proj-1', makeRepos() as never, USER, { ensure: true });
    expect(mockEnsureOwnerStore).toHaveBeenCalledWith('project', 'proj-1', 'Manor');
    expect(mockEnsureFolder).toHaveBeenCalledWith('proj-mp-new');
    expect(loc?.mountPointId).toBe('proj-mp-new');
  });

  it('returns null when the owner does not exist', async () => {
    expect(await resolveWardrobeLocation('project', 'nope', makeRepos() as never, USER, { ensure: true })).toBeNull();
    expect(mockEnsureOwnerStore).not.toHaveBeenCalled();
  });
});

describe('location operations', () => {
  it('readItems hides archived items unless asked', async () => {
    mockReadMountItems.mockResolvedValue([{ id: 'a', archivedAt: null }, { id: 'b', archivedAt: 'x' }]);
    const loc = (await resolveWardrobeLocation('group', 'grp-1', makeRepos() as never, USER))!;
    expect((await loc.readItems()).map((i) => i.id)).toEqual(['a']);
    expect((await loc.readItems(true)).map((i) => i.id)).toEqual(['a', 'b']);
    expect((await loc.findItem('b'))?.id).toBe('b');
  });

  it('update strips identity and timestamps from the patch', async () => {
    const loc = (await resolveWardrobeLocation('group', 'grp-1', makeRepos() as never, USER))!;
    await loc.update('a', { id: 'x', createdAt: 'c', updatedAt: 'u', title: 'T' });
    expect(mockUpdateInMount).toHaveBeenCalledWith(
      { mountPointId: 'grp-mp', scope: 'group', characterId: null },
      'a',
      { title: 'T' },
    );
  });

  it("an archived character's location still reads, but every write throws the tombstone", async () => {
    mockReadMountItems.mockResolvedValue([{ id: 'a', archivedAt: null }]);
    mockResolveWardrobeMount.mockRejectedValue(new CharacterArchivedError('char-1'));
    const loc = (await resolveWardrobeLocation('character', 'char-1', makeRepos() as never, USER))!;

    await expect(loc.readItems()).resolves.toHaveLength(1);
    await expect(loc.create({ id: 'n' } as never)).rejects.toBeInstanceOf(CharacterArchivedError);
    await expect(loc.update('a', { title: 'x' })).rejects.toBeInstanceOf(CharacterArchivedError);
    await expect(loc.delete('a')).rejects.toBeInstanceOf(CharacterArchivedError);
    await expect(loc.writableMountPointId()).rejects.toBeInstanceOf(CharacterArchivedError);
    expect(mockCreateInMount).not.toHaveBeenCalled();
    expect(mockUpdateInMount).not.toHaveBeenCalled();
    expect(mockDeleteInMount).not.toHaveBeenCalled();
  });

  it('a live character writes through the freshly resolved vault mount', async () => {
    const mount = { mountPointId: 'vault-1', scope: 'character', characterId: 'char-1' };
    mockResolveWardrobeMount.mockResolvedValue(mount);
    const loc = (await resolveWardrobeLocation('character', 'char-1', makeRepos() as never, USER))!;
    await loc.delete('a');
    expect(mockResolveWardrobeMount).toHaveBeenCalledWith('char-1');
    expect(mockDeleteInMount).toHaveBeenCalledWith(mount, 'a');
  });
});

describe('locationKey', () => {
  it('names one folder by scope and mount', () => {
    expect(locationKey({ scope: 'project', mountPointId: 'mp-1' })).toBe('project:mp-1');
    expect(locationKey({ scope: 'group', mountPointId: 'mp-1' })).not.toBe(locationKey({ scope: 'project', mountPointId: 'mp-1' }));
  });
});
