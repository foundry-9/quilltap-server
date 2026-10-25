/**
 * Inventory transfers — moving or copying one object between tiers.
 *
 * The one path both the operator's transfer route
 * (`app/api/v1/inventory/transfers`) and a character's `inventory_give` take.
 * A move keeps the id (so every chat's equipped set and every kit naming it
 * still do), a copy mints one and is refused when the object's resolved
 * `canCopy` is false (`NOT_COPYABLE`). The folder path is kept and created at
 * the destination as needed. Moving an instance keeps its `parentId`; moving
 * an archetype leaves its dependents alone (they name an id, not a path).
 * Pictures travel with it, through the wardrobe's carry steps over
 * `Inventory/images/`.
 *
 * Kits stay whole: a kit sent anywhere must reach its members from there
 * (`INVALID_SHAPE`, as on create), and a move that would leave kits naming
 * an object they can no longer reach is refused (`KIT_STRANDED`).
 *
 * Server-only.
 *
 * @module lib/inventory/transfers
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { InventoryRecord, ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { normalizeInventoryFolderPathOrRoot } from '@/lib/inventory/folders';
import { assertCopyable, assertKitMembers } from '@/lib/inventory/item-mutations';
import {
  findKitsStrandedByMove,
  findRecordsAnywhere,
  isReachableFromKitTier,
  mountOwnerResolver,
  mountScopeOf,
} from '@/lib/inventory/dependents';
import { InventoryKitStrandedError, InventoryShapeError } from '@/lib/inventory/errors';
import { carryInventoryItemImages, commitMovedInventoryImages } from '@/lib/inventory/item-images';
import { locationKey, type InventoryLocation } from '@/lib/inventory/location';
import { loadPoolForLocation } from '@/lib/inventory/pool';

export type InventoryTransferAction = 'move' | 'copy';

export interface TransferInventoryItemParams {
  action: InventoryTransferAction;
  source: InventoryLocation;
  destination: InventoryLocation;
  record: InventoryRecord;
  userId: string;
}

/** The source and destination name the same folder (a 400 at the route). */
export class InventoryTransferSameLocationError extends InventoryShapeError {
  constructor() {
    super('Source and destination are the same');
    this.name = 'InventoryTransferSameLocationError';
  }
}

/** Move or copy one object. Returns what landed, resolved at the destination. Throws a refusal. */
export async function transferInventoryItem(
  repos: RepositoryContainer,
  params: TransferInventoryItemParams,
): Promise<{ stored: InventoryRecord; item: ResolvedInventoryItem }> {
  const { action, source, destination, record, userId } = params;
  if (locationKey(source) === locationKey(destination)) throw new InventoryTransferSameLocationError();

  if (action === 'copy') {
    const pool = await loadPoolForLocation(repos, source);
    assertCopyable([pool.resolve(record)], { op: 'transfer-copy', itemId: record.id });
  } else {
    // A move writes the source too: an archived source character refuses
    // here, before anything lands at the destination.
    await source.writableMountPointId();
  }

  const meta = { op: `transfer-${action}`, itemId: record.id };
  if (record.kind === 'kit' && (record.itemIds ?? []).length > 0) {
    // Members the destination's own pool cannot see may still be in reach
    // from its tier in context (a project object, for a character's kit).
    const destinationPool = await loadPoolForLocation(repos, destination);
    const unseen = (record.itemIds ?? []).filter((id) => !destinationPool.get(id));
    const contextual = new Set<string>();
    if (unseen.length > 0) {
      const ownerOf = mountOwnerResolver();
      const homes = await findRecordsAnywhere(unseen);
      for (const [id, { mountPointId }] of homes) {
        const home = await mountScopeOf(mountPointId, ownerOf);
        if (home && (await isReachableFromKitTier(destination.mountPointId, { mountPointId, scope: home }, ownerOf))) contextual.add(id);
      }
    }
    assertKitMembers(destinationPool, record.itemIds ?? [], meta, contextual);
  }
  if (action === 'move' && record.kind !== 'kit') {
    const stranded = (await findKitsStrandedByMove(record.id, { mountPointId: destination.mountPointId, scope: destination.scope }))
      .filter((kit) => kit.id !== record.id);
    if (stranded.length > 0) {
      logger.info('[InventoryTransfers] Move refused: it would strand kits', { ...meta, kits: stranded.map((k) => k.id), context: 'inventory' });
      throw new InventoryKitStrandedError(record.id, stranded.map(({ id, name, ownerName }) => ({ id, name, ownerName })));
    }
  }

  const now = new Date().toISOString();
  const planned: InventoryRecord = {
    ...record,
    id: action === 'copy' ? randomUUID() : record.id,
    folder: normalizeInventoryFolderPathOrRoot(record.folder),
    archivedAt: action === 'copy' ? null : record.archivedAt ?? null,
    createdAt: action === 'copy' ? now : record.createdAt,
    updatedAt: action === 'copy' ? now : record.updatedAt,
  };
  if ((await destination.readItems(true)).some((existing) => existing.id === planned.id)) {
    throw new InventoryShapeError('An object with that id already exists at the destination', { itemId: planned.id });
  }

  // Pictures are linked at the destination before the object lands, so a
  // landed object's `imageFileId` never dangles.
  const { fileIdMap, pendingMove } = await carryInventoryItemImages(repos, {
    mode: action,
    sourceItemId: record.id,
    destinationItemId: planned.id,
    destinationMountPointId: await destination.writableMountPointId(),
    userId,
  });
  planned.imageFileId = record.imageFileId ? fileIdMap.get(record.imageFileId) ?? null : record.imageFileId;

  const stored = await destination.create(planned);
  if (action === 'move') {
    const removed = await source.delete([record.id]);
    if (removed.length === 0) throw new Error('Failed to remove the object from its source after the move');
    await commitMovedInventoryImages(repos, record.id, pendingMove);
  }

  logger.info('[InventoryTransfers] Inventory object transferred', {
    userId,
    action,
    itemId: record.id,
    resultItemId: stored.id,
    from: source.scope,
    to: destination.scope,
    folder: stored.folder,
    context: 'inventory',
  });
  const pool = await loadPoolForLocation(repos, destination);
  return {
    stored,
    item: pool.resolve({ ...stored, origin: destination.origin, mountPointId: destination.mountPointId }),
  };
}
