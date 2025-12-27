/**
 * Sync Conflict Resolver
 *
 * Handles conflict resolution during bidirectional sync operations.
 * Uses last-write-wins strategy based on updatedAt timestamps.
 */

import { logger } from '@/lib/logger';
import { ConflictResolution, SyncConflict, SyncableEntityType } from './types';

/**
 * Entity with timestamp for conflict resolution
 */
export interface EntityWithTimestamp {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * Result of a conflict resolution
 */
export interface ConflictResolutionResult {
  resolution: ConflictResolution;
  localTimestamp: Date;
  remoteTimestamp: Date;
  timeDifferenceMs: number;
}

/**
 * Resolve a conflict between local and remote entities using last-write-wins.
 * The entity with the more recent updatedAt timestamp wins.
 *
 * @param localEntity The local version of the entity
 * @param remoteEntity The remote version of the entity
 * @returns The resolution result indicating which version should be kept
 */
export function resolveConflict(
  localEntity: EntityWithTimestamp,
  remoteEntity: EntityWithTimestamp
): ConflictResolutionResult {
  const localTimestamp = new Date(localEntity.updatedAt);
  const remoteTimestamp = new Date(remoteEntity.updatedAt);

  const localTime = localTimestamp.getTime();
  const remoteTime = remoteTimestamp.getTime();
  const timeDifferenceMs = Math.abs(remoteTime - localTime);

  // Remote wins if it has a more recent timestamp
  const resolution: ConflictResolution = remoteTime > localTime ? 'REMOTE_WINS' : 'LOCAL_WINS';

  logger.debug('Resolved sync conflict', {
    context: 'sync:conflict-resolver',
    localId: localEntity.id,
    localUpdatedAt: localEntity.updatedAt,
    remoteUpdatedAt: remoteEntity.updatedAt,
    resolution,
    timeDifferenceMs,
  });

  return {
    resolution,
    localTimestamp,
    remoteTimestamp,
    timeDifferenceMs,
  };
}

/**
 * Resolve conflict and create a SyncConflict record for audit logging
 */
export function resolveConflictWithRecord(
  entityType: SyncableEntityType,
  localEntity: EntityWithTimestamp,
  remoteId: string,
  remoteUpdatedAt: string
): { resolution: ConflictResolution; conflict: SyncConflict } {
  const remoteEntity: EntityWithTimestamp = {
    id: remoteId,
    updatedAt: remoteUpdatedAt,
  };

  const result = resolveConflict(localEntity, remoteEntity);

  const conflict: SyncConflict = {
    entityType,
    localId: localEntity.id,
    remoteId,
    resolution: result.resolution,
    localUpdatedAt: localEntity.updatedAt,
    remoteUpdatedAt,
  };

  logger.info('Created conflict record', {
    context: 'sync:conflict-resolver',
    entityType,
    localId: localEntity.id,
    remoteId,
    resolution: result.resolution,
  });

  return {
    resolution: result.resolution,
    conflict,
  };
}

/**
 * Determine if an entity needs to be synced based on timestamps.
 * Returns true if the source entity is newer than the last synced version.
 *
 * @param sourceUpdatedAt The source entity's updatedAt timestamp
 * @param lastSyncedAt The timestamp of the last sync (null if never synced)
 * @returns True if the entity should be synced
 */
export function needsSync(sourceUpdatedAt: string, lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) {
    // Never synced, always needs sync
    logger.debug('Entity needs sync: never synced before', {
      context: 'sync:conflict-resolver',
      sourceUpdatedAt,
    });
    return true;
  }

  const sourceTime = new Date(sourceUpdatedAt).getTime();
  const lastSyncTime = new Date(lastSyncedAt).getTime();

  const needsUpdate = sourceTime > lastSyncTime;

  logger.debug('Checked if entity needs sync', {
    context: 'sync:conflict-resolver',
    sourceUpdatedAt,
    lastSyncedAt,
    needsUpdate,
  });

  return needsUpdate;
}

/**
 * Compare two timestamps and return which is more recent
 *
 * @param timestamp1 First timestamp
 * @param timestamp2 Second timestamp
 * @returns 1 if timestamp1 is newer, -1 if timestamp2 is newer, 0 if equal
 */
export function compareTimestamps(timestamp1: string, timestamp2: string): number {
  const time1 = new Date(timestamp1).getTime();
  const time2 = new Date(timestamp2).getTime();

  if (time1 > time2) return 1;
  if (time1 < time2) return -1;
  return 0;
}

/**
 * Get the more recent of two timestamps
 */
export function getMoreRecentTimestamp(timestamp1: string, timestamp2: string): string {
  return compareTimestamps(timestamp1, timestamp2) >= 0 ? timestamp1 : timestamp2;
}

/**
 * Batch resolve conflicts for multiple entity pairs.
 * Returns arrays of entities that should be kept locally vs fetched from remote.
 */
export function batchResolveConflicts<T extends EntityWithTimestamp>(
  localEntities: Map<string, T>,
  remoteEntities: Map<string, EntityWithTimestamp>,
  entityType: SyncableEntityType
): {
  keepLocal: string[];
  fetchRemote: string[];
  conflicts: SyncConflict[];
} {
  const keepLocal: string[] = [];
  const fetchRemote: string[] = [];
  const conflicts: SyncConflict[] = [];

  logger.debug('Starting batch conflict resolution', {
    context: 'sync:conflict-resolver',
    entityType,
    localCount: localEntities.size,
    remoteCount: remoteEntities.size,
  });

  // Check entities that exist in both
  for (const [localId, localEntity] of localEntities) {
    const remoteEntity = remoteEntities.get(localId);

    if (remoteEntity) {
      const { resolution, conflict } = resolveConflictWithRecord(
        entityType,
        localEntity,
        remoteEntity.id,
        remoteEntity.updatedAt
      );

      conflicts.push(conflict);

      if (resolution === 'LOCAL_WINS') {
        keepLocal.push(localId);
      } else {
        fetchRemote.push(localId);
      }
    }
  }

  logger.info('Batch conflict resolution complete', {
    context: 'sync:conflict-resolver',
    entityType,
    keepLocalCount: keepLocal.length,
    fetchRemoteCount: fetchRemote.length,
    conflictCount: conflicts.length,
  });

  return { keepLocal, fetchRemote, conflicts };
}
