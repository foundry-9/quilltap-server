/**
 * Unit Tests for Sync Conflict Resolver
 *
 * Tests the conflict resolution logic used during bidirectional sync operations.
 * Covers last-write-wins strategy, conflict record generation, sync determination,
 * batch conflict resolution, and timestamp utilities.
 */

// Unmock the conflict-resolver module to test the real implementation
jest.unmock('@/lib/sync/conflict-resolver');

import {
  resolveConflict,
  resolveConflictWithRecord,
  needsSync,
  batchResolveConflicts,
  compareTimestamps,
  getMoreRecentTimestamp,
  EntityWithTimestamp,
  ConflictResolutionResult,
} from '@/lib/sync/conflict-resolver';
import { SyncableEntityType } from '@/lib/sync/types';

describe('Sync Conflict Resolver', () => {
  const now = new Date('2025-01-15T12:00:00.000Z');
  const earlier = new Date('2025-01-15T11:00:00.000Z');
  const later = new Date('2025-01-15T13:00:00.000Z');

  const createEntity = (id: string, updatedAt: Date): EntityWithTimestamp => ({
    id,
    updatedAt: updatedAt.toISOString(),
    name: `Entity ${id}`,
    someField: 'test-data',
  });

  describe('resolveConflict', () => {
    it('should return LOCAL_WINS when local timestamp is newer', () => {
      const localEntity = createEntity('entity-1', later);
      const remoteEntity = createEntity('entity-1', earlier);

      const result: ConflictResolutionResult = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('LOCAL_WINS');
      expect(result.localTimestamp).toEqual(later);
      expect(result.remoteTimestamp).toEqual(earlier);
      expect(result.timeDifferenceMs).toBe(7200000); // 2 hours in ms
    });

    it('should return REMOTE_WINS when remote timestamp is newer', () => {
      const localEntity = createEntity('entity-1', earlier);
      const remoteEntity = createEntity('entity-1', later);

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('REMOTE_WINS');
      expect(result.localTimestamp).toEqual(earlier);
      expect(result.remoteTimestamp).toEqual(later);
      expect(result.timeDifferenceMs).toBe(7200000); // 2 hours in ms
    });

    it('should return LOCAL_WINS when timestamps are equal (local wins by default)', () => {
      const localEntity = createEntity('entity-1', now);
      const remoteEntity = createEntity('entity-1', now);

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('LOCAL_WINS');
      expect(result.localTimestamp).toEqual(now);
      expect(result.remoteTimestamp).toEqual(now);
      expect(result.timeDifferenceMs).toBe(0);
    });

    it('should handle timestamps with millisecond precision', () => {
      const localTime = new Date('2025-01-15T12:00:00.123Z');
      const remoteTime = new Date('2025-01-15T12:00:00.456Z');

      const localEntity = createEntity('entity-1', localTime);
      const remoteEntity = createEntity('entity-1', remoteTime);

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('REMOTE_WINS');
      expect(result.timeDifferenceMs).toBe(333); // 456 - 123 ms
    });

    it('should handle very small time differences', () => {
      const localTime = new Date('2025-01-15T12:00:00.000Z');
      const remoteTime = new Date('2025-01-15T12:00:00.001Z');

      const localEntity = createEntity('entity-1', localTime);
      const remoteEntity = createEntity('entity-1', remoteTime);

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('REMOTE_WINS');
      expect(result.timeDifferenceMs).toBe(1);
    });

    it('should handle invalid timestamps gracefully', () => {
      const localEntity: EntityWithTimestamp = {
        id: 'entity-1',
        updatedAt: 'invalid-date',
      };
      const remoteEntity = createEntity('entity-1', now);

      const result = resolveConflict(localEntity, remoteEntity);

      // Invalid date becomes NaN, which should handle gracefully
      expect(result.resolution).toBeDefined();
      expect(result.localTimestamp.toString()).toBe('Invalid Date');
    });

    it('should calculate time difference correctly regardless of which is newer', () => {
      const time1 = new Date('2025-01-15T12:00:00.000Z');
      const time2 = new Date('2025-01-15T12:05:30.500Z'); // 5 min 30.5 sec later

      const localEntity = createEntity('entity-1', time1);
      const remoteEntity = createEntity('entity-1', time2);

      const result1 = resolveConflict(localEntity, remoteEntity);
      expect(result1.timeDifferenceMs).toBe(330500); // 5.5 min in ms

      // Reverse order should give same absolute difference
      const result2 = resolveConflict(remoteEntity, localEntity);
      expect(result2.timeDifferenceMs).toBe(330500);
    });
  });

  describe('resolveConflictWithRecord', () => {
    it('should create a conflict record when local wins', () => {
      const entityType: SyncableEntityType = 'CHARACTER';
      const localEntity = createEntity('local-123', later);
      const remoteId = 'remote-456';
      const remoteUpdatedAt = earlier.toISOString();

      const { resolution, conflict } = resolveConflictWithRecord(
        entityType,
        localEntity,
        remoteId,
        remoteUpdatedAt
      );

      expect(resolution).toBe('LOCAL_WINS');
      expect(conflict).toEqual({
        entityType: 'CHARACTER',
        localId: 'local-123',
        remoteId: 'remote-456',
        resolution: 'LOCAL_WINS',
        localUpdatedAt: later.toISOString(),
        remoteUpdatedAt: earlier.toISOString(),
      });
    });

    it('should create a conflict record when remote wins', () => {
      const entityType: SyncableEntityType = 'CHAT';
      const localEntity = createEntity('local-789', earlier);
      const remoteId = 'remote-012';
      const remoteUpdatedAt = later.toISOString();

      const { resolution, conflict } = resolveConflictWithRecord(
        entityType,
        localEntity,
        remoteId,
        remoteUpdatedAt
      );

      expect(resolution).toBe('REMOTE_WINS');
      expect(conflict).toEqual({
        entityType: 'CHAT',
        localId: 'local-789',
        remoteId: 'remote-012',
        resolution: 'REMOTE_WINS',
        localUpdatedAt: earlier.toISOString(),
        remoteUpdatedAt: later.toISOString(),
      });
    });

    it('should handle all syncable entity types', () => {
      const entityTypes: SyncableEntityType[] = [
        'CHARACTER',
        'PERSONA',
        'CHAT',
        'MEMORY',
        'TAG',
        'ROLEPLAY_TEMPLATE',
        'PROMPT_TEMPLATE',
      ];

      entityTypes.forEach((entityType) => {
        const localEntity = createEntity('local-id', now);
        const { conflict } = resolveConflictWithRecord(
          entityType,
          localEntity,
          'remote-id',
          now.toISOString()
        );

        expect(conflict.entityType).toBe(entityType);
      });
    });

    it('should preserve timestamp strings in conflict record', () => {
      const localTimestamp = '2025-01-15T12:34:56.789Z';
      const remoteTimestamp = '2025-01-15T13:45:67.890Z';

      const localEntity: EntityWithTimestamp = {
        id: 'local-id',
        updatedAt: localTimestamp,
      };

      const { conflict } = resolveConflictWithRecord(
        'PERSONA',
        localEntity,
        'remote-id',
        remoteTimestamp
      );

      expect(conflict.localUpdatedAt).toBe(localTimestamp);
      expect(conflict.remoteUpdatedAt).toBe(remoteTimestamp);
    });
  });

  describe('needsSync', () => {
    it('should return true when never synced before (lastSyncedAt is null)', () => {
      const sourceUpdatedAt = now.toISOString();
      const result = needsSync(sourceUpdatedAt, null);

      expect(result).toBe(true);
    });

    it('should return true when source is newer than last sync', () => {
      const sourceUpdatedAt = later.toISOString();
      const lastSyncedAt = earlier.toISOString();

      const result = needsSync(sourceUpdatedAt, lastSyncedAt);

      expect(result).toBe(true);
    });

    it('should return false when source is older than last sync', () => {
      const sourceUpdatedAt = earlier.toISOString();
      const lastSyncedAt = later.toISOString();

      const result = needsSync(sourceUpdatedAt, lastSyncedAt);

      expect(result).toBe(false);
    });

    it('should return false when source timestamp equals last sync', () => {
      const sourceUpdatedAt = now.toISOString();
      const lastSyncedAt = now.toISOString();

      const result = needsSync(sourceUpdatedAt, lastSyncedAt);

      expect(result).toBe(false);
    });

    it('should handle millisecond precision correctly', () => {
      const sourceUpdatedAt = '2025-01-15T12:00:00.001Z';
      const lastSyncedAt = '2025-01-15T12:00:00.000Z';

      const result = needsSync(sourceUpdatedAt, lastSyncedAt);

      expect(result).toBe(true);
    });

    it('should return true for invalid lastSyncedAt (treats as never synced)', () => {
      const sourceUpdatedAt = now.toISOString();

      expect(needsSync(sourceUpdatedAt, null)).toBe(true);
      expect(needsSync(sourceUpdatedAt, '')).toBe(true);
    });
  });

  describe('compareTimestamps', () => {
    it('should return 1 when first timestamp is newer', () => {
      const result = compareTimestamps(later.toISOString(), earlier.toISOString());
      expect(result).toBe(1);
    });

    it('should return -1 when second timestamp is newer', () => {
      const result = compareTimestamps(earlier.toISOString(), later.toISOString());
      expect(result).toBe(-1);
    });

    it('should return 0 when timestamps are equal', () => {
      const result = compareTimestamps(now.toISOString(), now.toISOString());
      expect(result).toBe(0);
    });

    it('should handle millisecond precision', () => {
      const time1 = '2025-01-15T12:00:00.123Z';
      const time2 = '2025-01-15T12:00:00.124Z';

      expect(compareTimestamps(time1, time2)).toBe(-1);
      expect(compareTimestamps(time2, time1)).toBe(1);
      expect(compareTimestamps(time1, time1)).toBe(0);
    });
  });

  describe('getMoreRecentTimestamp', () => {
    it('should return the first timestamp when it is newer', () => {
      const result = getMoreRecentTimestamp(later.toISOString(), earlier.toISOString());
      expect(result).toBe(later.toISOString());
    });

    it('should return the second timestamp when it is newer', () => {
      const result = getMoreRecentTimestamp(earlier.toISOString(), later.toISOString());
      expect(result).toBe(later.toISOString());
    });

    it('should return the first timestamp when both are equal', () => {
      const timestamp = now.toISOString();
      const result = getMoreRecentTimestamp(timestamp, timestamp);
      expect(result).toBe(timestamp);
    });

    it('should handle different timestamp formats', () => {
      const time1 = '2025-01-15T12:00:00.000Z';
      const time2 = '2025-01-15T12:00:00.001Z';

      const result = getMoreRecentTimestamp(time1, time2);
      expect(result).toBe(time2);
    });
  });

  describe('batchResolveConflicts', () => {
    it('should resolve conflicts for entities that exist in both local and remote', () => {
      const localEntities = new Map<string, EntityWithTimestamp>([
        ['entity-1', createEntity('entity-1', later)], // Local wins
        ['entity-2', createEntity('entity-2', earlier)], // Remote wins
        ['entity-3', createEntity('entity-3', now)], // Local wins (equal)
      ]);

      const remoteEntities = new Map<string, EntityWithTimestamp>([
        ['entity-1', createEntity('entity-1', earlier)],
        ['entity-2', createEntity('entity-2', later)],
        ['entity-3', createEntity('entity-3', now)],
      ]);

      const result = batchResolveConflicts(localEntities, remoteEntities, 'CHARACTER');

      expect(result.keepLocal).toEqual(['entity-1', 'entity-3']);
      expect(result.fetchRemote).toEqual(['entity-2']);
      expect(result.conflicts).toHaveLength(3);
    });

    it('should skip entities that only exist locally', () => {
      const localEntities = new Map<string, EntityWithTimestamp>([
        ['local-only', createEntity('local-only', now)],
        ['both', createEntity('both', later)],
      ]);

      const remoteEntities = new Map<string, EntityWithTimestamp>([
        ['both', createEntity('both', earlier)],
      ]);

      const result = batchResolveConflicts(localEntities, remoteEntities, 'CHAT');

      expect(result.keepLocal).toEqual(['both']);
      expect(result.fetchRemote).toEqual([]);
      expect(result.conflicts).toHaveLength(1);
    });

    it('should skip entities that only exist remotely', () => {
      const localEntities = new Map<string, EntityWithTimestamp>([
        ['both', createEntity('both', earlier)],
      ]);

      const remoteEntities = new Map<string, EntityWithTimestamp>([
        ['both', createEntity('both', later)],
        ['remote-only', createEntity('remote-only', now)],
      ]);

      const result = batchResolveConflicts(localEntities, remoteEntities, 'MEMORY');

      expect(result.keepLocal).toEqual([]);
      expect(result.fetchRemote).toEqual(['both']);
      expect(result.conflicts).toHaveLength(1);
    });

    it('should handle empty local entities', () => {
      const localEntities = new Map<string, EntityWithTimestamp>();
      const remoteEntities = new Map<string, EntityWithTimestamp>([
        ['remote-1', createEntity('remote-1', now)],
      ]);

      const result = batchResolveConflicts(localEntities, remoteEntities, 'TAG');

      expect(result.keepLocal).toEqual([]);
      expect(result.fetchRemote).toEqual([]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle empty remote entities', () => {
      const localEntities = new Map<string, EntityWithTimestamp>([
        ['local-1', createEntity('local-1', now)],
      ]);
      const remoteEntities = new Map<string, EntityWithTimestamp>();

      const result = batchResolveConflicts(localEntities, remoteEntities, 'PERSONA');

      expect(result.keepLocal).toEqual([]);
      expect(result.fetchRemote).toEqual([]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle both maps being empty', () => {
      const localEntities = new Map<string, EntityWithTimestamp>();
      const remoteEntities = new Map<string, EntityWithTimestamp>();

      const result = batchResolveConflicts(
        localEntities,
        remoteEntities,
        'ROLEPLAY_TEMPLATE'
      );

      expect(result.keepLocal).toEqual([]);
      expect(result.fetchRemote).toEqual([]);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should create proper conflict records for all conflicts', () => {
      const localEntities = new Map<string, EntityWithTimestamp>([
        ['entity-1', createEntity('entity-1', later)],
        ['entity-2', createEntity('entity-2', earlier)],
      ]);

      const remoteEntities = new Map<string, EntityWithTimestamp>([
        ['entity-1', createEntity('entity-1', earlier)],
        ['entity-2', createEntity('entity-2', later)],
      ]);

      const result = batchResolveConflicts(localEntities, remoteEntities, 'PROMPT_TEMPLATE');

      expect(result.conflicts).toHaveLength(2);

      expect(result.conflicts[0]).toEqual({
        entityType: 'PROMPT_TEMPLATE',
        localId: 'entity-1',
        remoteId: 'entity-1',
        resolution: 'LOCAL_WINS',
        localUpdatedAt: later.toISOString(),
        remoteUpdatedAt: earlier.toISOString(),
      });

      expect(result.conflicts[1]).toEqual({
        entityType: 'PROMPT_TEMPLATE',
        localId: 'entity-2',
        remoteId: 'entity-2',
        resolution: 'REMOTE_WINS',
        localUpdatedAt: earlier.toISOString(),
        remoteUpdatedAt: later.toISOString(),
      });
    });

    it('should handle large batches', () => {
      const localEntities = new Map<string, EntityWithTimestamp>();
      const remoteEntities = new Map<string, EntityWithTimestamp>();

      // Create 100 entities with mixed timestamps
      for (let i = 0; i < 100; i++) {
        const id = `entity-${i}`;
        const localTime = new Date(now.getTime() + (i % 2 === 0 ? 1000 : -1000));
        const remoteTime = new Date(now.getTime() + (i % 2 === 0 ? -1000 : 1000));

        localEntities.set(id, createEntity(id, localTime));
        remoteEntities.set(id, createEntity(id, remoteTime));
      }

      const result = batchResolveConflicts(localEntities, remoteEntities, 'CHARACTER');

      expect(result.keepLocal).toHaveLength(50);
      expect(result.fetchRemote).toHaveLength(50);
      expect(result.conflicts).toHaveLength(100);
    });

    it('should handle mixed results with various timestamp differences', () => {
      const baseTime = new Date('2025-01-15T12:00:00.000Z');

      const localEntities = new Map<string, EntityWithTimestamp>([
        ['very-old', createEntity('very-old', new Date(baseTime.getTime() - 86400000))], // -1 day
        ['recent', createEntity('recent', new Date(baseTime.getTime() + 3600000))], // +1 hour
        ['equal', createEntity('equal', baseTime)],
        ['slightly-newer', createEntity('slightly-newer', new Date(baseTime.getTime() + 1))],
      ]);

      const remoteEntities = new Map<string, EntityWithTimestamp>([
        ['very-old', createEntity('very-old', baseTime)],
        ['recent', createEntity('recent', new Date(baseTime.getTime() - 7200000))], // -2 hours
        ['equal', createEntity('equal', baseTime)],
        ['slightly-newer', createEntity('slightly-newer', baseTime)],
      ]);

      const result = batchResolveConflicts(localEntities, remoteEntities, 'CHAT');

      expect(result.keepLocal).toEqual(['recent', 'equal', 'slightly-newer']);
      expect(result.fetchRemote).toEqual(['very-old']);
      expect(result.conflicts).toHaveLength(4);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle entities with additional fields', () => {
      const localEntity: EntityWithTimestamp = {
        id: 'entity-1',
        updatedAt: later.toISOString(),
        name: 'Character Name',
        description: 'Some description',
        tags: ['tag1', 'tag2'],
        metadata: { custom: 'data' },
      };

      const remoteEntity: EntityWithTimestamp = {
        id: 'entity-1',
        updatedAt: earlier.toISOString(),
        name: 'Different Name',
        version: 2,
      };

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('LOCAL_WINS');
    });

    it('should handle ISO 8601 timestamps in different formats', () => {
      const formats = [
        '2025-01-15T12:00:00.000Z',
        '2025-01-15T12:00:00Z',
        '2025-01-15T12:00:00.123456Z',
      ];

      formats.forEach((format) => {
        const localEntity: EntityWithTimestamp = {
          id: 'test',
          updatedAt: format,
        };

        const remoteEntity = createEntity('test', earlier);
        const result = resolveConflict(localEntity, remoteEntity);

        expect(result).toBeDefined();
        expect(result.resolution).toBeDefined();
      });
    });

    it('should handle timezone differences correctly', () => {
      // Same moment in time, different representations
      const utc = '2025-01-15T12:00:00.000Z';
      const parsed = new Date(utc);

      const localEntity = createEntity('test', parsed);
      const remoteEntity: EntityWithTimestamp = {
        id: 'test',
        updatedAt: utc,
      };

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('LOCAL_WINS'); // Equal timestamps, local wins by default
      expect(result.timeDifferenceMs).toBe(0);
    });

    it('should handle very large time differences', () => {
      const veryOld = new Date('2020-01-01T00:00:00.000Z');
      const veryNew = new Date('2025-01-15T12:00:00.000Z');

      const localEntity = createEntity('test', veryNew);
      const remoteEntity = createEntity('test', veryOld);

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('LOCAL_WINS');
      expect(result.timeDifferenceMs).toBeGreaterThan(0);
    });

    it('should handle future timestamps', () => {
      const future = new Date('2030-01-01T00:00:00.000Z');

      const localEntity = createEntity('test', future);
      const remoteEntity = createEntity('test', now);

      const result = resolveConflict(localEntity, remoteEntity);

      expect(result.resolution).toBe('LOCAL_WINS');
    });
  });
});
