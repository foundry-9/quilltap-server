/**
 * @jest-environment node
 *
 * itemFolderActionHandlers — the create / rename / delete folder actions the
 * wardrobe and Inventory route factories share. The points worth holding:
 * only create-folder provisions a missing store (`ensure: true`), a location
 * that does not resolve answers with its own response, and a refusal from the
 * folder mutation goes through the kind's error mapper rather than escaping.
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

import { itemFolderActionHandlers } from '@/lib/mount-index/item-folder-routes';

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
