/**
 * Regression tests for ensure{Group,Project}OfficialStore FK persistence.
 *
 * The provisioning helpers run BEFORE the store files (properties.json et al.)
 * exist — group/project `create()` writes those only after ensure() returns.
 * They must therefore persist `officialMountPointId` through the RAW
 * `setOfficialMountPointId` setter, never the overlay-applying `update()`,
 * whose closing re-read (`apply*StoreOverlayOne`) would throw
 * `*StoreUnavailableError: properties.json missing`.
 *
 * These tests pin that contract: ensure() calls setOfficialMountPointId and
 * never update(). Regressing to update() reintroduces the create-time 500.
 *
 * Strategy: mock getRepositories() — no real database, no document store.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureGroupOfficialStore } from '@/lib/mount-index/ensure-group-store';
import { ensureProjectOfficialStore } from '@/lib/mount-index/ensure-project-store';

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnThis(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockGetRepositories = jest.mocked(getRepositories);

/** Build a repos double for the entity under test ('groups' | 'projects'). */
function makeRepos(opts: {
  entity: 'groups' | 'projects';
  rawRow: Record<string, unknown> | null;
  links?: Array<{ mountPointId: string }>;
  mountPointsById?: Record<string, unknown>;
  createdMountPointId?: string;
}) {
  const entityRepo = {
    findByIdRaw: jest.fn(async () => opts.rawRow),
    setOfficialMountPointId: jest.fn(async () => undefined),
    update: jest.fn(async () => opts.rawRow),
  };
  const linksRepo = {
    findByGroupId: jest.fn(async () => opts.links ?? []),
    findByProjectId: jest.fn(async () => opts.links ?? []),
    link: jest.fn(async () => undefined),
  };
  const docMountPoints = {
    findById: jest.fn(async (id: string) => opts.mountPointsById?.[id] ?? null),
    findAll: jest.fn(async () => Object.values(opts.mountPointsById ?? {})),
    create: jest.fn(async () => ({ id: opts.createdMountPointId ?? 'mp-new' })),
  };

  const repos = {
    docMountPoints,
    groups: opts.entity === 'groups' ? entityRepo : undefined,
    projects: opts.entity === 'projects' ? entityRepo : undefined,
    groupDocMountLinks: linksRepo,
    projectDocMountLinks: linksRepo,
  } as unknown as ReturnType<typeof getRepositories>;

  mockGetRepositories.mockReturnValue(repos);
  return { entityRepo, linksRepo, docMountPoints };
}

describe('ensureGroupOfficialStore — raw FK write contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a fresh store and persists the FK via setOfficialMountPointId, not update', async () => {
    const { entityRepo, docMountPoints, linksRepo } = makeRepos({
      entity: 'groups',
      rawRow: { id: 'g1', name: 'Cabal', officialMountPointId: null },
      links: [],
      createdMountPointId: 'mp-1',
    });

    const result = await ensureGroupOfficialStore('g1', 'Cabal');

    expect(result).toEqual({ mountPointId: 'mp-1', created: true });
    expect(docMountPoints.create).toHaveBeenCalledTimes(1);
    expect(linksRepo.link).toHaveBeenCalledWith('g1', 'mp-1');
    expect(entityRepo.setOfficialMountPointId).toHaveBeenCalledWith('g1', 'mp-1');
    // The overlay-applying update() must NOT be touched on the provisioning path.
    expect(entityRepo.update).not.toHaveBeenCalled();
  });

  it('adopts an existing linked store via setOfficialMountPointId, not update', async () => {
    const adopted = {
      id: 'mp-existing',
      name: 'Group Files: Cabal',
      mountType: 'database',
      storeType: 'documents',
    };
    const { entityRepo } = makeRepos({
      entity: 'groups',
      rawRow: { id: 'g1', name: 'Cabal', officialMountPointId: null },
      links: [{ mountPointId: 'mp-existing' }],
      mountPointsById: { 'mp-existing': adopted },
    });

    const result = await ensureGroupOfficialStore('g1', 'Cabal');

    expect(result).toEqual({ mountPointId: 'mp-existing', created: false });
    expect(entityRepo.setOfficialMountPointId).toHaveBeenCalledWith('g1', 'mp-existing');
    expect(entityRepo.update).not.toHaveBeenCalled();
  });

  it('returns the existing store untouched when the FK is already valid', async () => {
    const { entityRepo } = makeRepos({
      entity: 'groups',
      rawRow: { id: 'g1', name: 'Cabal', officialMountPointId: 'mp-1' },
      mountPointsById: { 'mp-1': { id: 'mp-1' } },
    });

    const result = await ensureGroupOfficialStore('g1', 'Cabal');

    expect(result).toEqual({ mountPointId: 'mp-1', created: false });
    expect(entityRepo.setOfficialMountPointId).not.toHaveBeenCalled();
    expect(entityRepo.update).not.toHaveBeenCalled();
  });
});

describe('ensureProjectOfficialStore — raw FK write contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a fresh store and persists the FK via setOfficialMountPointId, not update', async () => {
    const { entityRepo, docMountPoints, linksRepo } = makeRepos({
      entity: 'projects',
      rawRow: { id: 'p1', name: 'Saga', officialMountPointId: null },
      links: [],
      createdMountPointId: 'mp-2',
    });

    const result = await ensureProjectOfficialStore('p1', 'Saga');

    expect(result).toEqual({ mountPointId: 'mp-2', created: true });
    expect(docMountPoints.create).toHaveBeenCalledTimes(1);
    expect(linksRepo.link).toHaveBeenCalledWith('p1', 'mp-2');
    expect(entityRepo.setOfficialMountPointId).toHaveBeenCalledWith('p1', 'mp-2');
    expect(entityRepo.update).not.toHaveBeenCalled();
  });
});
