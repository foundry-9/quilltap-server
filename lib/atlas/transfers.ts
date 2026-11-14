/**
 * Atlas transfers — moving or copying one entry between tiers.
 *
 * A move keeps the id, a copy mints one. The folder path is kept and created
 * at the destination as needed; pictures travel with the entry, through the
 * shared carry steps over `Atlas/images/`. The destination's name rule
 * applies: a live entry there with the same canonical name refuses the
 * transfer (`NAME_TAKEN`).
 *
 * Server-only.
 *
 * @module lib/atlas/transfers
 */

import { foldItemName } from '@/lib/mount-index/item-rules';
import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { AtlasEntryWithOrigin, AtlasRecord } from '@/lib/schemas/atlas.types';
import { normalizeAtlasFolderPathOrRoot } from '@/lib/atlas/folders';
import { AtlasNameTakenError, AtlasShapeError } from '@/lib/atlas/errors';
import { carryAtlasEntryImages, commitMovedAtlasEntryImages } from '@/lib/atlas/item-images';
import { locationKey, type AtlasLocation } from '@/lib/atlas/location';
import { withOrigin } from '@/lib/atlas/pool';

export type AtlasTransferAction = 'move' | 'copy';

export interface TransferAtlasEntryParams {
  action: AtlasTransferAction;
  source: AtlasLocation;
  destination: AtlasLocation;
  record: AtlasRecord;
  userId: string;
}

/** The source and destination name the same folder (a 400 at the route). */
export class AtlasTransferSameLocationError extends AtlasShapeError {
  constructor() {
    super('Source and destination are the same');
    this.name = 'AtlasTransferSameLocationError';
  }
}

/** Move or copy one entry. Returns what landed, tagged with its new tier. Throws a refusal. */
export async function transferAtlasEntry(
  repos: RepositoryContainer,
  params: TransferAtlasEntryParams,
): Promise<{ stored: AtlasRecord; entry: AtlasEntryWithOrigin }> {
  const { action, source, destination, record, userId } = params;
  if (locationKey(source) === locationKey(destination)) throw new AtlasTransferSameLocationError();
  // A move writes the source too: an archived source character refuses here.
  if (action === 'move') await source.writableMountPointId();

  const now = new Date().toISOString();
  const planned: AtlasRecord = {
    ...record,
    id: action === 'copy' ? randomUUID() : record.id,
    folder: normalizeAtlasFolderPathOrRoot(record.folder),
    archivedAt: action === 'copy' ? null : record.archivedAt ?? null,
    createdAt: action === 'copy' ? now : record.createdAt,
    updatedAt: action === 'copy' ? now : record.updatedAt,
    fileStem: undefined,
  };
  const existing = await destination.readEntries(true);
  if (existing.some((entry) => entry.id === planned.id)) {
    throw new AtlasShapeError('An entry with that id already exists at the destination', { entryId: planned.id });
  }
  if (!planned.archivedAt) {
    const key = foldItemName(planned.name);
    const clash = existing.find((entry) => !entry.archivedAt && foldItemName(entry.name) === key);
    if (clash) {
      logger.info('[AtlasTransfers] Transfer refused: the name is taken at the destination', {
        action,
        entryId: record.id,
        clashId: clash.id,
        context: 'atlas',
      });
      throw new AtlasNameTakenError(planned.name, clash.id);
    }
  }

  // Pictures are linked at the destination before the entry lands, so a
  // landed entry's `imageFileId` never dangles.
  const { fileIdMap, pendingMove } = await carryAtlasEntryImages(repos, {
    mode: action,
    sourceItemId: record.id,
    destinationItemId: planned.id,
    destinationMountPointId: await destination.writableMountPointId(),
    userId,
  });
  planned.imageFileId = record.imageFileId ? fileIdMap.get(record.imageFileId) ?? null : null;

  const stored = await destination.create(planned);
  if (action === 'move') {
    const removed = await source.delete([record.id]);
    if (removed.length === 0) throw new Error('Failed to remove the entry from its source after the move');
    await commitMovedAtlasEntryImages(repos, record.id, pendingMove);
  }

  logger.info('[AtlasTransfers] Atlas entry transferred', {
    userId,
    action,
    entryId: record.id,
    resultEntryId: stored.id,
    from: source.scope,
    to: destination.scope,
    folder: stored.folder,
    pictures: fileIdMap.size,
    context: 'atlas',
  });
  return { stored, entry: withOrigin(destination, stored) };
}
