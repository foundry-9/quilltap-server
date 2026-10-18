/**
 * Inventory transfer API.
 *
 * POST /api/v1/inventory/transfers
 *   `{ action: 'move' | 'copy', itemId, from: { scope, id }, to: { scope, id } }`
 *   Moves or copies one Inventory object between tiers.
 *
 * Mirrors the wardrobe's transfers: a move keeps the id (so every chat's
 * equipped set and every kit naming it still do), a copy mints one and is
 * refused when the object's resolved `canCopy` is false (`NOT_COPYABLE`).
 * The folder path is kept and created at the destination as needed. Moving
 * an instance keeps its `parentId`; moving an archetype leaves its
 * dependents alone (they name an id, not a path). Pictures travel with it,
 * through the wardrobe's carry steps over `Inventory/images/`.
 *
 * Kits stay whole: a kit sent anywhere must reach its members from there
 * (`INVALID_SHAPE`, as on create), and a move that would leave kits naming
 * an object they can no longer reach is refused (`KIT_STRANDED`).
 */

import { randomUUID } from 'crypto';
import { createContextHandler } from '@/lib/api/middleware';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { inventoryTransferSchema, type InventoryRecord } from '@/lib/schemas/inventory.types';
import { normalizeInventoryFolderPathOrRoot } from '@/lib/inventory/folders';
import { assertCopyable, assertKitMembers } from '@/lib/inventory/item-mutations';
import { findKitsStrandedByMove, findRecordsAnywhere, isReachableFromKitTier, mountScopeOf } from '@/lib/inventory/dependents';
import { InventoryKitStrandedError } from '@/lib/inventory/errors';
import { carryInventoryItemImages, commitMovedInventoryImages } from '@/lib/inventory/item-images';
import { locationKey, resolveInventoryLocation } from '@/lib/inventory/location';
import { loadPoolForLocation } from '@/lib/inventory/pool';
import { inventoryErrorResponse } from '@/lib/inventory/routes/responses';

export const POST = createContextHandler(async (req, { user, repos }) => {
  const body = inventoryTransferSchema.parse(await req.json());
  try {
    const source = await resolveInventoryLocation(body.from.scope, body.from.id, repos, user.id);
    const record = source ? await source.findItem(body.itemId) : null;
    if (!source || !record) return notFound('Inventory object');

    const destination = await resolveInventoryLocation(body.to.scope, body.to.id, repos, user.id, { ensure: true });
    if (!destination) return badRequest('Invalid destination');
    if (locationKey(source) === locationKey(destination)) return badRequest('Source and destination are the same');

    if (body.action === 'copy') {
      const pool = await loadPoolForLocation(repos, source);
      assertCopyable([pool.resolve(record)], { op: 'transfer-copy', itemId: record.id });
    } else {
      // A move writes the source too: an archived source character refuses
      // here, before anything lands at the destination.
      await source.writableMountPointId();
    }

    const meta = { op: `transfer-${body.action}`, itemId: record.id };
    if (record.kind === 'kit' && (record.itemIds ?? []).length > 0) {
      // Members the destination's own pool cannot see may still be in reach
      // from its tier in context (a project object, for a character's kit).
      const destinationPool = await loadPoolForLocation(repos, destination);
      const unseen = (record.itemIds ?? []).filter((id) => !destinationPool.get(id));
      const contextual = new Set<string>();
      if (unseen.length > 0) {
        const homes = await findRecordsAnywhere(unseen);
        for (const [id, { mountPointId }] of homes) {
          const home = await mountScopeOf(mountPointId);
          if (home && (await isReachableFromKitTier(destination.mountPointId, { mountPointId, scope: home }))) contextual.add(id);
        }
      }
      assertKitMembers(destinationPool, record.itemIds ?? [], meta, contextual);
    }
    if (body.action === 'move' && record.kind !== 'kit') {
      const stranded = (await findKitsStrandedByMove(record.id, { mountPointId: destination.mountPointId, scope: destination.scope }))
        .filter((kit) => kit.id !== record.id);
      if (stranded.length > 0) {
        logger.info('[InventoryTransfers v1] Move refused: it would strand kits', { ...meta, kits: stranded.map((k) => k.id) });
        throw new InventoryKitStrandedError(record.id, stranded.map(({ id, name, ownerName }) => ({ id, name, ownerName })));
      }
    }

    const now = new Date().toISOString();
    const planned: InventoryRecord = {
      ...record,
      id: body.action === 'copy' ? randomUUID() : record.id,
      folder: normalizeInventoryFolderPathOrRoot(record.folder),
      archivedAt: body.action === 'copy' ? null : record.archivedAt ?? null,
      createdAt: body.action === 'copy' ? now : record.createdAt,
      updatedAt: body.action === 'copy' ? now : record.updatedAt,
    };
    if ((await destination.readItems(true)).some((existing) => existing.id === planned.id)) {
      return badRequest('An object with that id already exists at the destination');
    }

    // Pictures are linked at the destination before the object lands, so a
    // landed object's `imageFileId` never dangles.
    const { fileIdMap, pendingMove } = await carryInventoryItemImages(repos, {
      mode: body.action,
      sourceItemId: record.id,
      destinationItemId: planned.id,
      destinationMountPointId: await destination.writableMountPointId(),
      userId: user.id,
    });
    planned.imageFileId = record.imageFileId ? fileIdMap.get(record.imageFileId) ?? null : record.imageFileId;

    const stored = await destination.create(planned);
    if (body.action === 'move') {
      const removed = await source.delete([record.id]);
      if (removed.length === 0) return serverError('Failed to remove the object from its source after the move');
      await commitMovedInventoryImages(repos, record.id, pendingMove);
    }

    logger.info('[InventoryTransfers v1] Inventory object transferred', {
      userId: user.id,
      action: body.action,
      itemId: record.id,
      resultItemId: stored.id,
      from: body.from.scope,
      to: body.to.scope,
      folder: stored.folder,
      context: 'inventory',
    });
    const pool = await loadPoolForLocation(repos, destination);
    return successResponse({
      item: pool.resolve({ ...stored, origin: destination.origin, mountPointId: destination.mountPointId }),
    });
  } catch (error) {
    return inventoryErrorResponse(error);
  }
});
