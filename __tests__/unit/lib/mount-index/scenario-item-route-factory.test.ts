/**
 * The shared GET / PUT / POST(?action=rename) / DELETE bodies behind the
 * General, group and project single-scenario endpoints, plus the collection
 * list/create bodies.
 *
 * The routes read and write only through the scenario location now, so the
 * suite drives them against an in-memory store (`scenario-stores` helper) with
 * the location running for real. The behaviours a caller can actually get
 * hurt by:
 *
 *   - **Path resolution runs before anything else.** `..` and nested paths are
 *     refused with a 400 before a store is even looked up, which is what keeps
 *     a crafted `[scenarioPath]` from reading outside `Scenarios/`.
 *   - **A read never provisions.** An owner without a store is a 404 naming
 *     the remedy, not a freshly minted store.
 *   - **PUT preserves an unmentioned archived flag.** The serializer rewrites
 *     the whole file, so an omitted `archived` would silently un-archive the
 *     scenario — a tombstone quietly resurrected.
 *   - **Rename refuses to clobber.** A colliding name is a 400, not a move that
 *     eats the destination.
 *   - **`?includeArchived` is honoured on every list that comes back**, or the
 *     dialog's view flips depending on which verb last ran.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/api/middleware', () => ({
  createContextParamsHandler:
    (handler: (req: never, ctx: never, params: never) => Promise<unknown>) => handler,
  // The real dispatcher: the ?action= rule under test is its rule.
  dispatchAction: jest.requireActual('@/lib/api/middleware/actions').dispatchAction,
}));

const mockGetGeneralMountPointId = jest.fn();
jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: () => mockGetGeneralMountPointId(),
}));
const mockEnsureFolderPath = jest.fn();
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (...args: unknown[]) => mockEnsureFolderPath(...args),
}));
const mockEnsureOwnerOfficialStore = jest.fn();
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: (...args: unknown[]) => mockEnsureOwnerOfficialStore(...args),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(),
  deleteDatabaseDocument: jest.fn(),
  moveDatabaseDocument: jest.fn(),
  readDatabaseDocument: jest.fn(),
}));

let mockRepos: unknown;
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockRepos,
}));

import {
  createScenarioCollectionBodies,
  createScenarioItemHandlers,
} from '@/lib/mount-index/scenario-item-route-factory';
import {
  deleteDatabaseDocument,
  moveDatabaseDocument,
  writeDatabaseDocument,
} from '@/lib/mount-index/database-store';
import { isScenarioContentArchived } from '@/lib/mount-index/scenarios-common';
import { makeScenarioStores, type FakeScenarioStores } from '../../../helpers/scenario-stores';

const mockWrite = jest.mocked(writeDatabaseDocument);
const mockDelete = jest.mocked(deleteDatabaseDocument);
const mockMove = jest.mocked(moveDatabaseDocument);

const MOUNT = 'mount-1';
let stores: FakeScenarioStores;

function handlers() {
  return createScenarioItemHandlers<{ id: string; scenarioPath: string }>({
    scope: 'project',
    ownerLabel: 'Project',
    logTag: '[Projects v1]',
    logIdKey: 'projectId',
  });
}

/** The request shape the handlers actually read: `url`, `nextUrl` and `json()`. */
function req(url: string, body?: unknown) {
  return { url, nextUrl: new URL(url), json: async () => body } as never;
}

function ctx() {
  return { user: { id: 'user-1' }, repos: stores.repos } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGeneralMountPointId.mockResolvedValue('general-mount');
  mockEnsureFolderPath.mockResolvedValue('folder-1');
  mockEnsureOwnerOfficialStore.mockResolvedValue({ mountPointId: MOUNT, created: false });
  stores = makeScenarioStores({
    projects: [
      { id: 'proj-1', name: 'Blackwood', officialMountPointId: MOUNT },
      { id: 'proj-bare', name: 'Storeless', officialMountPointId: null },
    ],
    groups: [{ id: 'group-1', name: 'The Club', officialMountPointId: 'group-mount' }],
  });
  mockRepos = stores.repos;
  stores.put(MOUNT, 'Scenarios/tea.md', '---\nname: Tea\n---\n\nbody');
  mockWrite.mockImplementation(async (mountPointId: string, path: string, content: string) => {
    stores.put(mountPointId, path, content);
    return undefined as never;
  });
  mockDelete.mockImplementation(async (mountPointId: string, path: string) =>
    stores.files.delete(`${mountPointId}|${path}`) as never,
  );
  mockMove.mockImplementation(async (mountPointId: string, from: string, to: string) => {
    const content = stores.files.get(`${mountPointId}|${from}`)!;
    stores.files.delete(`${mountPointId}|${from}`);
    stores.put(mountPointId, to, content);
    return undefined as never;
  });
});

describe('path resolution runs before the store is touched', () => {
  it.each([
    ['a traversal', 'Scenarios/../../secrets.md'],
    ['a nested path', 'Scenarios/sub/deep.md'],
    ['an empty path', '   '],
  ])('400s on %s without looking up the owner', async (_label, scenarioPath) => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath });

    expect(res.status).toBe(400);
    expect(stores.repos.projects.findByIdRaw).not.toHaveBeenCalled();
  });

  it('accepts a bare filename and prefixes the folder', async () => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    await expect(res.json()).resolves.toMatchObject({ scenario: { path: 'Scenarios/tea.md', name: 'Tea' } });
  });

  it('accepts a URL-encoded filename', async () => {
    stores.put(MOUNT, 'Scenarios/a tea party.md', 'party');
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), {
      id: 'proj-1',
      scenarioPath: encodeURIComponent('a tea party.md'),
    });

    await expect(res.json()).resolves.toMatchObject({ scenario: { path: 'Scenarios/a tea party.md' } });
  });
});

describe('owner and store lookup', () => {
  it('404s when the owner does not exist', async () => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-nope', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Project not found' });
  });

  it('404s with the remedy when the owner has no store yet — and provisions nothing', async () => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-bare', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error:
        'Project has no official document store yet — restart the server or call GET /scenarios first not found',
    });
    expect(mockEnsureOwnerOfficialStore).not.toHaveBeenCalled();
  });

  it('404s when the file itself is absent', async () => {
    const { GET } = handlers();

    const res = await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'coffee' });

    expect(res.status).toBe(404);
  });
});

describe('folder repair', () => {
  it('heals the Scenarios/ folder on a write, but never on a read', async () => {
    const { GET, PUT } = handlers();

    await GET(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });
    expect(mockEnsureFolderPath).not.toHaveBeenCalled();

    await PUT(req('https://x.test/', { body: 'b' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });
    expect(mockEnsureFolderPath).toHaveBeenCalledWith(MOUNT, 'Scenarios');
  });

  it("runs the tier's extra heal (the group's Knowledge/) on a write", async () => {
    const afterEnsure = jest.fn();
    stores.put('group-mount', 'Scenarios/tea.md', 'Tea.');
    mockEnsureOwnerOfficialStore.mockResolvedValue({ mountPointId: 'group-mount', created: false });
    const { DELETE } = createScenarioItemHandlers<{ id: string; scenarioPath: string }>({
      scope: 'group',
      ownerLabel: 'Group',
      logTag: '[Groups v1]',
      logIdKey: 'groupId',
      afterEnsure,
    });

    await DELETE(req('https://x.test/'), ctx(), { id: 'group-1', scenarioPath: 'tea' });

    expect(afterEnsure).toHaveBeenCalledWith('group-mount');
  });

  it('does not mint a store for a write to an owner that has none', async () => {
    const { PUT } = handlers();

    const res = await PUT(req('https://x.test/', { body: 'b' }), ctx(), { id: 'proj-bare', scenarioPath: 'tea' });

    expect(res.status).toBe(404);
    expect(mockEnsureOwnerOfficialStore).not.toHaveBeenCalled();
  });
});

describe('PUT', () => {
  it('preserves an archived flag the body never mentions', async () => {
    stores.put(MOUNT, 'Scenarios/tea.md', '---\nname: Tea\narchived: true\n---\n\nold body');
    const { PUT } = handlers();

    await PUT(req('https://x.test/', { body: 'new body' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    const written = mockWrite.mock.calls[0][2] as string;
    expect(isScenarioContentArchived(written)).toBe(true);
  });

  it('honours an explicit archived: false', async () => {
    stores.put(MOUNT, 'Scenarios/tea.md', '---\nname: Tea\narchived: true\n---\n\nold body');
    const { PUT } = handlers();

    await PUT(req('https://x.test/', { body: 'new body', archived: false }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    const written = mockWrite.mock.calls[0][2] as string;
    expect(isScenarioContentArchived(written)).toBe(false);
  });

  it('404s rather than creating a file that is not there', async () => {
    const { PUT } = handlers();

    const res = await PUT(req('https://x.test/', { body: 'new body' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'coffee',
    });

    expect(res.status).toBe(404);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('400s on an invalid body without writing', async () => {
    const { PUT } = handlers();

    const res = await PUT(req('https://x.test/', { body: '' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('promotes the default only when asked', async () => {
    stores.put(MOUNT, 'Scenarios/other.md', '---\nisDefault: true\n---\nOther.');
    const { PUT } = handlers();

    await PUT(req('https://x.test/', { body: 'b' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });
    expect(stores.files.get(`${MOUNT}|Scenarios/other.md`)).toContain('isDefault: true');

    const res = await PUT(req('https://x.test/', { body: 'b', isDefault: true }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });
    const { scenarios } = await res.json();
    expect(scenarios.find((s: { path: string }) => s.path === 'Scenarios/tea.md').isDefault).toBe(true);
    expect(stores.files.get(`${MOUNT}|Scenarios/other.md`)).toContain('isDefault: false');
  });

  it('honours ?includeArchived on the list it answers with', async () => {
    stores.put(MOUNT, 'Scenarios/old.md', '---\narchived: true\n---\nOld.');
    const { PUT } = handlers();

    const withArchived = await PUT(req('https://x.test/?includeArchived=true', { body: 'b' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });
    expect((await withArchived.json()).scenarios).toHaveLength(2);

    const without = await PUT(req('https://x.test/', { body: 'b' }), ctx(), { id: 'proj-1', scenarioPath: 'tea' });
    expect((await without.json()).scenarios).toHaveLength(1);
  });
});

describe('POST ?action=rename', () => {
  it('refuses an unknown action before doing anything', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=archive', {}), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Unknown action: archive',
      availableActions: ['rename'],
    });
    expect(stores.repos.projects.findByIdRaw).not.toHaveBeenCalled();
  });

  it('refuses a missing action', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/', {}), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(400);
  });

  it('moves the document and answers the new path', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'coffee' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(mockMove).toHaveBeenCalledWith(MOUNT, 'Scenarios/tea.md', 'Scenarios/coffee.md');
    await expect(res.json()).resolves.toMatchObject({ path: 'Scenarios/coffee.md' });
  });

  it('strips a .md the caller supplied rather than doubling it', async () => {
    const { POST } = handlers();

    await POST(req('https://x.test/?action=rename', { newFilename: 'coffee.md' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(mockMove).toHaveBeenCalledWith(MOUNT, 'Scenarios/tea.md', 'Scenarios/coffee.md');
  });

  it('refuses to clobber an existing scenario', async () => {
    stores.put(MOUNT, 'Scenarios/coffee.md', 'destination');
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'coffee' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'A scenario named "coffee" already exists' });
    expect(mockMove).not.toHaveBeenCalled();
  });

  it('treats a rename to the same name as a no-op, not a self-clobber', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'tea' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'tea',
    });

    expect(res.status).toBe(200);
    expect(mockMove).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ path: 'Scenarios/tea.md' });
  });

  it('404s when the source is gone', async () => {
    const { POST } = handlers();

    const res = await POST(req('https://x.test/?action=rename', { newFilename: 'coffee' }), ctx(), {
      id: 'proj-1',
      scenarioPath: 'gone',
    });

    expect(res.status).toBe(404);
    expect(mockMove).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  it('deletes and answers the refreshed list', async () => {
    stores.put(MOUNT, 'Scenarios/other.md', 'Other.');
    const { DELETE } = handlers();

    const res = await DELETE(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(mockDelete).toHaveBeenCalledWith(MOUNT, 'Scenarios/tea.md');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenarios.map((s: { filename: string }) => s.filename)).toEqual(['other']);
  });

  it('404s when there was nothing to delete', async () => {
    const { DELETE } = handlers();

    const res = await DELETE(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'gone' });

    expect(res.status).toBe(404);
  });

  it('500s rather than leaking a store failure', async () => {
    mockDelete.mockRejectedValue(new Error('store unreachable'));
    const { DELETE } = handlers();

    const res = await DELETE(req('https://x.test/'), ctx(), { id: 'proj-1', scenarioPath: 'tea' });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to delete project scenario' });
  });
});

describe('the tier label follows the config', () => {
  it('says Group when built for the group tier', async () => {
    const { GET } = createScenarioItemHandlers<{ id: string; scenarioPath: string }>({
      scope: 'group',
      ownerLabel: 'Group',
      logTag: '[Groups v1]',
      logIdKey: 'groupId',
    });

    const res = await GET(req('https://x.test/'), ctx(), { id: 'group-nope', scenarioPath: 'tea' });

    await expect(res.json()).resolves.toEqual({ error: 'Group not found' });
  });
});

describe('collection bodies', () => {
  const bodies = () =>
    createScenarioCollectionBodies<{ id: string }>({
      scope: 'project',
      ownerLabel: 'Project',
      logTag: '[Projects v1]',
      logIdKey: 'projectId',
    });

  it('provisions the store before listing', async () => {
    const res = await bodies().list(req('https://x.test/'), ctx(), { id: 'proj-1' });

    expect(mockEnsureOwnerOfficialStore).toHaveBeenCalledWith('project', 'proj-1', 'Blackwood');
    await expect(res.json()).resolves.toMatchObject({ mountPointId: MOUNT, scenarios: [{ name: 'Tea' }] });
  });

  it('creates a scenario and refuses a duplicate name', async () => {
    const created = await bodies().create(req('https://x.test/', { filename: 'coffee', body: 'Coffee.' }), ctx(), {
      id: 'proj-1',
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ path: 'Scenarios/coffee.md' });

    const dup = await bodies().create(req('https://x.test/', { filename: 'coffee', body: 'Again.' }), ctx(), {
      id: 'proj-1',
    });
    expect(dup.status).toBe(400);
  });

  it('404s for an owner that does not exist', async () => {
    const res = await bodies().list(req('https://x.test/'), ctx(), { id: 'proj-nope' });
    expect(res.status).toBe(404);
  });
});
