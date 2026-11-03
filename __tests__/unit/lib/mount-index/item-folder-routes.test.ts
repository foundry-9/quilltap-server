/**
 * @jest-environment node
 *
 * itemFolderActionHandlers — the create / rename / delete folder actions the
 * wardrobe and Inventory route factories share. The points worth holding:
 * only create-folder provisions a missing store (`ensure: true`), a location
 * that does not resolve answers with its own response, and a refusal from the
 * folder mutation goes through the kind's error mapper rather than escaping.
 *
 * And the shared preamble (`itemRoutePreamble`, `itemErrorResponse`) both
 * kinds build on, run for the wardrobe and the Inventory alike: per-tier 404
 * labels, the read probe that never provisions, `?action=folders`, and one
 * error mapping that keeps each kind's own refusals.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/mount-index/item-folder-location', () => ({
  createItemFolder: jest.fn(),
  renameItemFolder: jest.fn(),
  deleteItemFolder: jest.fn(),
}));

jest.mock('@/lib/database/repositories/characters.repository', () => {
  class CharacterArchivedError extends Error {}
  return { CharacterArchivedError };
});

import {
  itemErrorResponse,
  itemFolderActionHandlers,
  itemRoutePreamble,
  withItemErrors,
  type ItemErrorKind,
  type ItemRouteKind,
} from '@/lib/mount-index/item-folder-routes';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';
import { WardrobeFolderConflictError, WardrobeFolderNotFoundError, WardrobeFolderPathError } from '@/lib/wardrobe/folders';
import { InventoryFolderNotFoundError, InventoryItemNotInLocationError } from '@/lib/inventory/folders';

const { createItemFolder, renameItemFolder, deleteItemFolder } = jest.requireMock(
  '@/lib/mount-index/item-folder-location',
) as Record<string, jest.Mock>;

const kind = { rules: { noun: 'wardrobe' } } as any;
const location = { id: 'project-1', mountPointId: 'mp-1' } as any;
const ctx = { user: { id: 'user-1' } } as any;
const params = { id: 'project-1' };

const request = (body: unknown) =>
  ({ json: async () => body }) as any;

function build(overrides: Partial<Record<'resolveLocation' | 'errorResponse', jest.Mock>> = {}) {
  const resolveLocation =
    overrides.resolveLocation ?? jest.fn(async () => ({ ok: true as const, location }));
  const errorResponse =
    overrides.errorResponse ??
    jest.fn((_error: unknown) => NextResponse.json({ error: 'refused' }, { status: 409 }));
  const handlers = itemFolderActionHandlers({
    kind,
    logTag: '[Test]',
    logIdKey: 'projectId',
    resolveLocation,
    errorResponse,
    schemas: {
      path: z.object({ path: z.string().min(1) }),
      rename: z.object({ path: z.string().min(1), name: z.string().min(1) }),
    },
  });
  return { handlers, resolveLocation, errorResponse };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('itemFolderActionHandlers', () => {
  it('offers exactly the three folder actions', () => {
    expect(Object.keys(build().handlers).sort()).toEqual([
      'create-folder',
      'delete-folder',
      'rename-folder',
    ]);
  });

  it('create-folder provisions the store and answers with the new folder', async () => {
    createItemFolder.mockResolvedValue({ path: 'Hats' });
    const { handlers, resolveLocation } = build();

    const res = await handlers['create-folder'](request({ path: 'Hats' }), ctx, params);

    expect(resolveLocation).toHaveBeenCalledWith(ctx, params, true);
    expect(createItemFolder).toHaveBeenCalledWith(kind, location, 'Hats');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ folder: { path: 'Hats' } });
  });

  it('rename-folder and delete-folder never provision a store', async () => {
    renameItemFolder.mockResolvedValue({ path: 'Caps' });
    deleteItemFolder.mockResolvedValue({ deleted: 1 });
    const { handlers, resolveLocation } = build();

    await handlers['rename-folder'](request({ path: 'Hats', name: 'Caps' }), ctx, params);
    await handlers['delete-folder'](request({ path: 'Caps' }), ctx, params);

    expect(resolveLocation).toHaveBeenNthCalledWith(1, ctx, params, false);
    expect(resolveLocation).toHaveBeenNthCalledWith(2, ctx, params, false);
    expect(renameItemFolder).toHaveBeenCalledWith(kind, location, 'Hats', 'Caps');
    expect(deleteItemFolder).toHaveBeenCalledWith(kind, location, 'Caps');
  });

  it('answers with the resolver response when the location does not resolve', async () => {
    const missing = NextResponse.json({ error: 'not found' }, { status: 404 });
    const { handlers } = build({
      resolveLocation: jest.fn(async () => ({ ok: false as const, response: missing })),
    });

    const res = await handlers['delete-folder'](request({ path: 'Hats' }), ctx, params);

    expect(res).toBe(missing);
    expect(deleteItemFolder).not.toHaveBeenCalled();
  });

  it('maps a refusal from the folder mutation through the kind error mapper', async () => {
    const refusal = new Error('folder exists');
    createItemFolder.mockRejectedValue(refusal);
    const { handlers, errorResponse } = build();

    const res = await handlers['create-folder'](request({ path: 'Hats' }), ctx, params);

    expect(errorResponse).toHaveBeenCalledWith(refusal);
    expect(res.status).toBe(409);
  });

  it('rejects a malformed body before resolving anything', async () => {
    const { handlers, resolveLocation } = build();

    await expect(
      handlers['rename-folder'](request({ path: 'Hats' }), ctx, params),
    ).rejects.toThrow();
    expect(resolveLocation).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The shared preamble, for both kinds
// ============================================================================

class KindRefusal extends Error {}

function errorKind(noun: string): ItemErrorKind {
  return {
    noun,
    refusals: (error) =>
      error instanceof KindRefusal ? NextResponse.json({ error: error.message, code: 'OWN' }, { status: 418 }) : null,
  };
}

const KINDS = {
  wardrobe: {
    items: { character: 'Wardrobe item', group: 'Group wardrobe item', project: 'Project wardrobe item', general: 'Archetype wardrobe item' },
  },
  inventory: {
    items: { character: 'Inventory object', group: 'Group inventory object', project: 'Project inventory object', general: 'General inventory object' },
  },
} as const;

type Noun = keyof typeof KINDS;

function routeKind(noun: Noun, resolve: jest.Mock): ItemRouteKind<any> {
  return {
    folderKind: { rules: { noun } } as any,
    itemLabels: KINDS[noun].items,
    resolve,
    errors: errorKind(noun),
    folderSchemas: {
      path: z.object({ path: z.string().min(1) }),
      rename: z.object({ path: z.string().min(1), name: z.string().min(1) }),
    },
  };
}

function preambleCtx(owners: { project?: unknown; group?: unknown } = {}) {
  return {
    user: { id: 'user-1' },
    repos: {
      projects: { findById: jest.fn(async () => owners.project ?? null) },
      groups: { findById: jest.fn(async () => owners.group ?? null) },
    },
  } as any;
}

const config = (scope: 'character' | 'group' | 'project' | 'general') => ({
  scope,
  paramsToId: (p: { id?: string }) => (scope === 'general' ? null : p.id ?? null),
  logTag: '[Test]',
  logIdKey: 'ownerId',
});

describe.each(['wardrobe', 'inventory'] as const)('itemRoutePreamble (%s)', (noun) => {
  it('labels each tier: the owner the same for both kinds, the item per tier', () => {
    const resolve = jest.fn();
    for (const scope of ['character', 'group', 'project', 'general'] as const) {
      const { labels } = itemRoutePreamble(routeKind(noun, resolve), config(scope));
      expect(labels.item).toBe(KINDS[noun].items[scope]);
    }
    expect(itemRoutePreamble(routeKind(noun, resolve), config('project')).labels.owner).toBe('Project');
    expect(itemRoutePreamble(routeKind(noun, resolve), config('general')).labels.owner).toBe('Quilltap General');
  });

  it('the read probe never provisions: a project with no store yet is null, not a 404 or a new store', async () => {
    const resolve = jest.fn(async () => null);
    const { probe } = itemRoutePreamble(routeKind(noun, resolve), config('project'));

    const found = await probe(preambleCtx({ project: { id: 'p-1' } }), { id: 'p-1' });

    expect(found).toEqual({ ok: true, location: null });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('project', 'p-1', expect.anything(), 'user-1', { ensure: false });
  });

  it('the read probe 404s a missing owner and answers null for an unprovisioned General', async () => {
    const resolve = jest.fn(async () => null);
    const project = await itemRoutePreamble(routeKind(noun, resolve), config('project')).probe(preambleCtx(), { id: 'gone' });
    expect(project.ok).toBe(false);
    if (project.ok) return;
    expect(project.response.status).toBe(404);
    await expect(project.response.json()).resolves.toEqual({ error: 'Project not found' });

    const general = await itemRoutePreamble(routeKind(noun, resolve), config('general')).probe(preambleCtx(), {});
    expect(general).toEqual({ ok: true, location: null });
  });

  it('GET ?action=folders lists a resolved tier and answers [] for a tier with no store', async () => {
    const listFolders = jest.fn(async () => [{ path: 'Hats', itemCount: 2 }]);
    const resolve = jest.fn(async () => ({ id: 'g-1', mountPointId: 'mp-g', listFolders }));
    const listed = await itemRoutePreamble(routeKind(noun, resolve), config('group')).getFolders(
      {} as any,
      preambleCtx(),
      { id: 'g-1' },
    );
    await expect(listed.json()).resolves.toEqual({ folders: [{ path: 'Hats', itemCount: 2 }] });

    const none = await itemRoutePreamble(routeKind(noun, jest.fn(async () => null)), config('group')).getFolders(
      {} as any,
      preambleCtx({ group: { id: 'g-1' } }),
      { id: 'g-1' },
    );
    await expect(none.json()).resolves.toEqual({ folders: [] });
    expect(resolve).toHaveBeenCalledWith('group', 'g-1', expect.anything(), 'user-1', { ensure: false });
  });

  it('resolveLocation passes ensure through and labels the owner on a miss', async () => {
    const resolve = jest.fn(async () => null);
    const { resolveLocation } = itemRoutePreamble(routeKind(noun, resolve), config('group'));

    const miss = await resolveLocation(preambleCtx(), { id: 'g-1' }, true);

    expect(resolve).toHaveBeenCalledWith('group', 'g-1', expect.anything(), 'user-1', { ensure: true });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.response.status).toBe(404);
  });
});

describe('itemErrorResponse / withItemErrors', () => {
  it("tries the kind's own refusals first", async () => {
    const res = itemErrorResponse(errorKind('inventory'), new KindRefusal('cap'));
    expect(res.status).toBe(418);
    await expect(res.json()).resolves.toEqual({ error: 'cap', code: 'OWN' });
  });

  it('maps the shared folder refusals for both kinds, naming the kind', async () => {
    const wardrobe = errorKind('wardrobe');
    const inventory = errorKind('inventory');
    expect(itemErrorResponse(wardrobe, new WardrobeFolderPathError('bad')).status).toBe(400);
    expect(itemErrorResponse(wardrobe, new WardrobeFolderConflictError('Hats')).status).toBe(409);
    expect(itemErrorResponse(inventory, new InventoryItemNotInLocationError(['x'])).status).toBe(400);

    const wardrobeMissing = itemErrorResponse(wardrobe, new WardrobeFolderNotFoundError('Hats'));
    expect(wardrobeMissing.status).toBe(404);
    await expect(wardrobeMissing.json()).resolves.toEqual({ error: 'Wardrobe folder not found' });
    const inventoryMissing = itemErrorResponse(inventory, new InventoryFolderNotFoundError('Hats'));
    await expect(inventoryMissing.json()).resolves.toEqual({ error: 'Inventory folder not found' });
  });

  it("answers an archived character's vault with a 409 naming the kind", async () => {
    const res = itemErrorResponse(errorKind('wardrobe'), new CharacterArchivedError('c-1'));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "An archived character's wardrobe cannot be changed" });
  });

  it('rethrows anything it does not own, and withItemErrors lets it propagate', async () => {
    const boom = new Error('boom');
    expect(() => itemErrorResponse(errorKind('inventory'), boom)).toThrow(boom);
    const handler = withItemErrors(errorKind('inventory'))(async () => {
      throw boom;
    });
    await expect(handler()).rejects.toBe(boom);
    const refused = withItemErrors(errorKind('inventory'))(async () => {
      throw new KindRefusal('no');
    });
    expect((await refused()).status).toBe(418);
  });
});
