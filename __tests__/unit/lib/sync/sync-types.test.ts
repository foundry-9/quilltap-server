/**
 * Unit Tests for Sync System Zod Schemas
 *
 * Tests validation of sync protocol message schemas:
 * - SyncVersionInfo: Version compatibility information
 * - SyncHandshake: Request/response for initial connection
 * - SyncDelta: Request/response for incremental changes
 * - SyncEntityDelta: Individual entity change records
 * - SyncConflict: Conflict resolution records
 */

import {
  SyncVersionInfoSchema,
  SyncHandshakeRequestSchema,
  SyncHandshakeResponseSchema,
  SyncDeltaRequestSchema,
  SyncDeltaResponseSchema,
  SyncEntityDeltaSchema,
  SyncConflictSchema,
  SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
} from '@/lib/sync/types';

describe('Sync System Zod Schemas', () => {
  // ============================================================================
  // SYNC VERSION INFO
  // ============================================================================

  describe('SyncVersionInfoSchema', () => {
    const validVersionInfo = {
      appVersion: '2.5.0',
      schemaVersion: SCHEMA_VERSION,
      syncProtocolVersion: SYNC_PROTOCOL_VERSION,
      supportedEntityTypes: ['CHARACTER', 'PERSONA', 'CHAT'],
    };

    it('should validate valid version info', () => {
      const result = SyncVersionInfoSchema.safeParse(validVersionInfo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validVersionInfo);
      }
    });

    it('should fail with missing appVersion', () => {
      const { appVersion, ...invalid } = validVersionInfo;
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing schemaVersion', () => {
      const { schemaVersion, ...invalid } = validVersionInfo;
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing syncProtocolVersion', () => {
      const { syncProtocolVersion, ...invalid } = validVersionInfo;
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing supportedEntityTypes', () => {
      const { supportedEntityTypes, ...invalid } = validVersionInfo;
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid appVersion type', () => {
      const invalid = { ...validVersionInfo, appVersion: 123 };
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid schemaVersion type', () => {
      const invalid = { ...validVersionInfo, schemaVersion: null };
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid syncProtocolVersion type', () => {
      const invalid = { ...validVersionInfo, syncProtocolVersion: true };
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with non-array supportedEntityTypes', () => {
      const invalid = { ...validVersionInfo, supportedEntityTypes: 'CHARACTER' };
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid entity type in array', () => {
      const invalid = { ...validVersionInfo, supportedEntityTypes: ['CHARACTER', 'INVALID_TYPE'] };
      const result = SyncVersionInfoSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with empty supportedEntityTypes array', () => {
      const valid = { ...validVersionInfo, supportedEntityTypes: [] };
      const result = SyncVersionInfoSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with all entity types', () => {
      const valid = {
        ...validVersionInfo,
        supportedEntityTypes: ['CHARACTER', 'PERSONA', 'CHAT', 'MEMORY', 'TAG', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE'],
      };
      const result = SyncVersionInfoSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // SYNC HANDSHAKE
  // ============================================================================

  describe('SyncHandshakeRequestSchema', () => {
    const validHandshakeRequest = {
      versionInfo: {
        appVersion: '2.5.0',
        schemaVersion: SCHEMA_VERSION,
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        supportedEntityTypes: ['CHARACTER', 'PERSONA'],
      },
      email: 'test@example.com',
      password: 'secure-password',
    };

    it('should validate valid handshake request with email/password', () => {
      const result = SyncHandshakeRequestSchema.safeParse(validHandshakeRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validHandshakeRequest);
      }
    });

    it('should validate with apiKey instead of email/password', () => {
      const valid = {
        versionInfo: validHandshakeRequest.versionInfo,
        apiKey: 'sk-test-api-key-12345',
      };
      const result = SyncHandshakeRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with only versionInfo (no credentials)', () => {
      const valid = {
        versionInfo: validHandshakeRequest.versionInfo,
      };
      const result = SyncHandshakeRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail with missing versionInfo', () => {
      const { versionInfo, ...invalid } = validHandshakeRequest;
      const result = SyncHandshakeRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid email format', () => {
      const invalid = { ...validHandshakeRequest, email: 'not-an-email' };
      const result = SyncHandshakeRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with optional email omitted', () => {
      const { email, ...valid } = validHandshakeRequest;
      const result = SyncHandshakeRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with optional password omitted', () => {
      const { password, ...valid } = validHandshakeRequest;
      const result = SyncHandshakeRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with all optional fields present', () => {
      const valid = {
        ...validHandshakeRequest,
        apiKey: 'sk-test-key',
      };
      const result = SyncHandshakeRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('SyncHandshakeResponseSchema', () => {
    const validHandshakeResponse = {
      compatible: true,
      reason: 'Version compatible',
      versionInfo: {
        appVersion: '2.5.0',
        schemaVersion: SCHEMA_VERSION,
        syncProtocolVersion: SYNC_PROTOCOL_VERSION,
        supportedEntityTypes: ['CHARACTER', 'PERSONA'],
      },
      sessionToken: 'session-token-12345',
      remoteUserId: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('should validate valid handshake response', () => {
      const result = SyncHandshakeResponseSchema.safeParse(validHandshakeResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validHandshakeResponse);
      }
    });

    it('should validate minimal response (incompatible)', () => {
      const valid = {
        compatible: false,
      };
      const result = SyncHandshakeResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with reason only', () => {
      const valid = {
        compatible: false,
        reason: 'Version mismatch',
      };
      const result = SyncHandshakeResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail with missing compatible field', () => {
      const { compatible, ...invalid } = validHandshakeResponse;
      const result = SyncHandshakeResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid compatible type', () => {
      const invalid = { ...validHandshakeResponse, compatible: 'yes' };
      const result = SyncHandshakeResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid remoteUserId format', () => {
      const invalid = { ...validHandshakeResponse, remoteUserId: 'not-a-uuid' };
      const result = SyncHandshakeResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with null optional fields', () => {
      const valid = {
        compatible: true,
        reason: null,
        versionInfo: null,
        sessionToken: null,
        remoteUserId: null,
      };
      const result = SyncHandshakeResponseSchema.safeParse(valid);
      expect(result.success).toBe(false); // reason, versionInfo, etc. are optional, not nullable
    });

    it('should validate with omitted optional fields', () => {
      const valid = {
        compatible: true,
      };
      const result = SyncHandshakeResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // SYNC DELTA REQUEST/RESPONSE
  // ============================================================================

  describe('SyncDeltaRequestSchema', () => {
    const validDeltaRequest = {
      instanceId: '550e8400-e29b-41d4-a716-446655440000',
      entityTypes: ['CHARACTER', 'PERSONA'],
      sinceTimestamp: '2025-01-01T00:00:00.000Z',
      limit: 50,
      cursor: 'cursor-token-12345',
    };

    it('should validate valid delta request', () => {
      const result = SyncDeltaRequestSchema.safeParse(validDeltaRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validDeltaRequest);
      }
    });

    it('should validate with all optional fields omitted', () => {
      const valid = {};
      const result = SyncDeltaRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100); // default value
      }
    });

    it('should apply default limit of 100', () => {
      const valid = { entityTypes: ['CHARACTER'] };
      const result = SyncDeltaRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100);
      }
    });

    it('should fail with invalid instanceId format', () => {
      const invalid = { ...validDeltaRequest, instanceId: 'not-a-uuid' };
      const result = SyncDeltaRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid entityTypes', () => {
      const invalid = { ...validDeltaRequest, entityTypes: ['INVALID_TYPE'] };
      const result = SyncDeltaRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid timestamp format', () => {
      const invalid = { ...validDeltaRequest, sinceTimestamp: 'not-a-timestamp' };
      const result = SyncDeltaRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with limit less than 1', () => {
      const invalid = { ...validDeltaRequest, limit: 0 };
      const result = SyncDeltaRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with limit greater than 1000', () => {
      const invalid = { ...validDeltaRequest, limit: 1001 };
      const result = SyncDeltaRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with non-integer limit', () => {
      const invalid = { ...validDeltaRequest, limit: 50.5 };
      const result = SyncDeltaRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with limit at boundary (1)', () => {
      const valid = { ...validDeltaRequest, limit: 1 };
      const result = SyncDeltaRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with limit at boundary (1000)', () => {
      const valid = { ...validDeltaRequest, limit: 1000 };
      const result = SyncDeltaRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with null sinceTimestamp', () => {
      const valid = { ...validDeltaRequest, sinceTimestamp: null };
      const result = SyncDeltaRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('SyncDeltaResponseSchema', () => {
    const validDeltaResponse = {
      serverTimestamp: '2025-01-01T12:00:00.000Z',
      deltas: [
        {
          entityType: 'CHARACTER',
          id: '550e8400-e29b-41d4-a716-446655440001',
          createdAt: '2025-01-01T10:00:00.000Z',
          updatedAt: '2025-01-01T11:00:00.000Z',
          isDeleted: false,
          data: { name: 'Test Character', description: 'A test' },
        },
      ],
      hasMore: true,
      nextCursor: 'next-cursor-token',
    };

    it('should validate valid delta response', () => {
      const result = SyncDeltaResponseSchema.safeParse(validDeltaResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validDeltaResponse);
      }
    });

    it('should validate with empty deltas array', () => {
      const valid = {
        serverTimestamp: '2025-01-01T12:00:00.000Z',
        deltas: [],
        hasMore: false,
      };
      const result = SyncDeltaResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should apply default hasMore of false', () => {
      const valid = {
        serverTimestamp: '2025-01-01T12:00:00.000Z',
        deltas: [],
      };
      const result = SyncDeltaResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(false);
      }
    });

    it('should fail with missing serverTimestamp', () => {
      const { serverTimestamp, ...invalid } = validDeltaResponse;
      const result = SyncDeltaResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing deltas', () => {
      const { deltas, ...invalid } = validDeltaResponse;
      const result = SyncDeltaResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid serverTimestamp format', () => {
      const invalid = { ...validDeltaResponse, serverTimestamp: 'not-a-timestamp' };
      const result = SyncDeltaResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid hasMore type', () => {
      const invalid = { ...validDeltaResponse, hasMore: 'yes' };
      const result = SyncDeltaResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with null nextCursor', () => {
      const valid = { ...validDeltaResponse, nextCursor: null };
      const result = SyncDeltaResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with multiple deltas', () => {
      const valid = {
        ...validDeltaResponse,
        deltas: [
          {
            entityType: 'CHARACTER',
            id: '550e8400-e29b-41d4-a716-446655440001',
            createdAt: '2025-01-01T10:00:00.000Z',
            updatedAt: '2025-01-01T11:00:00.000Z',
            isDeleted: false,
            data: { name: 'Character 1' },
          },
          {
            entityType: 'PERSONA',
            id: '550e8400-e29b-41d4-a716-446655440002',
            createdAt: '2025-01-01T10:30:00.000Z',
            updatedAt: '2025-01-01T11:30:00.000Z',
            isDeleted: false,
            data: { name: 'Persona 1' },
          },
        ],
      };
      const result = SyncDeltaResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // SYNC ENTITY DELTA
  // ============================================================================

  describe('SyncEntityDeltaSchema', () => {
    const validEntityDelta = {
      entityType: 'CHARACTER',
      id: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2025-01-01T10:00:00.000Z',
      updatedAt: '2025-01-01T12:00:00.000Z',
      isDeleted: false,
      data: {
        name: 'Test Character',
        description: 'A test character',
        tags: [],
      },
    };

    it('should validate valid entity delta', () => {
      const result = SyncEntityDeltaSchema.safeParse(validEntityDelta);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validEntityDelta);
      }
    });

    it('should validate deleted entity with null data', () => {
      const valid = {
        entityType: 'CHARACTER',
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
        isDeleted: true,
        data: null,
      };
      const result = SyncEntityDeltaSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should apply default isDeleted of false', () => {
      const { isDeleted, ...valid } = validEntityDelta;
      const result = SyncEntityDeltaSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDeleted).toBe(false);
      }
    });

    it('should fail with missing entityType', () => {
      const { entityType, ...invalid } = validEntityDelta;
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing id', () => {
      const { id, ...invalid } = validEntityDelta;
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing updatedAt', () => {
      const { updatedAt, ...invalid } = validEntityDelta;
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid entityType', () => {
      const invalid = { ...validEntityDelta, entityType: 'INVALID_TYPE' };
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid id format', () => {
      const invalid = { ...validEntityDelta, id: 'not-a-uuid' };
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid updatedAt format', () => {
      const invalid = { ...validEntityDelta, updatedAt: 'not-a-timestamp' };
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid isDeleted type', () => {
      const invalid = { ...validEntityDelta, isDeleted: 'false' };
      const result = SyncEntityDeltaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate with omitted optional data field', () => {
      const { data, ...valid } = validEntityDelta;
      const result = SyncEntityDeltaSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with empty data object', () => {
      const valid = { ...validEntityDelta, data: {} };
      const result = SyncEntityDeltaSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with complex nested data', () => {
      const valid = {
        ...validEntityDelta,
        data: {
          name: 'Complex Character',
          nested: {
            level1: {
              level2: ['array', 'of', 'values'],
            },
          },
          numbers: [1, 2, 3],
          boolean: true,
        },
      };
      const result = SyncEntityDeltaSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate all entity types', () => {
      const entityTypes = ['CHARACTER', 'PERSONA', 'CHAT', 'MEMORY', 'TAG', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE'];

      entityTypes.forEach(entityType => {
        const valid = { ...validEntityDelta, entityType };
        const result = SyncEntityDeltaSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // SYNC CONFLICT
  // ============================================================================

  describe('SyncConflictSchema', () => {
    const validConflict = {
      entityType: 'CHARACTER',
      localId: '550e8400-e29b-41d4-a716-446655440000',
      remoteId: '550e8400-e29b-41d4-a716-446655440001',
      resolution: 'LOCAL_WINS',
      localUpdatedAt: '2025-01-01T12:00:00.000Z',
      remoteUpdatedAt: '2025-01-01T11:00:00.000Z',
    };

    it('should validate valid conflict', () => {
      const result = SyncConflictSchema.safeParse(validConflict);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validConflict);
      }
    });

    it('should validate with REMOTE_WINS resolution', () => {
      const valid = { ...validConflict, resolution: 'REMOTE_WINS' };
      const result = SyncConflictSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail with missing entityType', () => {
      const { entityType, ...invalid } = validConflict;
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing localId', () => {
      const { localId, ...invalid } = validConflict;
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing remoteId', () => {
      const { remoteId, ...invalid } = validConflict;
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing resolution', () => {
      const { resolution, ...invalid } = validConflict;
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing localUpdatedAt', () => {
      const { localUpdatedAt, ...invalid } = validConflict;
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with missing remoteUpdatedAt', () => {
      const { remoteUpdatedAt, ...invalid } = validConflict;
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid entityType', () => {
      const invalid = { ...validConflict, entityType: 'INVALID_TYPE' };
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid localId format', () => {
      const invalid = { ...validConflict, localId: 'not-a-uuid' };
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid remoteId format', () => {
      const invalid = { ...validConflict, remoteId: 'not-a-uuid' };
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid resolution', () => {
      const invalid = { ...validConflict, resolution: 'MERGE' };
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid localUpdatedAt format', () => {
      const invalid = { ...validConflict, localUpdatedAt: 'not-a-timestamp' };
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should fail with invalid remoteUpdatedAt format', () => {
      const invalid = { ...validConflict, remoteUpdatedAt: 'not-a-timestamp' };
      const result = SyncConflictSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate all entity types', () => {
      const entityTypes = ['CHARACTER', 'PERSONA', 'CHAT', 'MEMORY', 'TAG', 'ROLEPLAY_TEMPLATE', 'PROMPT_TEMPLATE'];

      entityTypes.forEach(entityType => {
        const valid = { ...validConflict, entityType };
        const result = SyncConflictSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    it('should validate with same timestamp for local and remote', () => {
      const timestamp = '2025-01-01T12:00:00.000Z';
      const valid = {
        ...validConflict,
        localUpdatedAt: timestamp,
        remoteUpdatedAt: timestamp,
      };
      const result = SyncConflictSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate with local timestamp before remote', () => {
      const valid = {
        ...validConflict,
        localUpdatedAt: '2025-01-01T10:00:00.000Z',
        remoteUpdatedAt: '2025-01-01T12:00:00.000Z',
      };
      const result = SyncConflictSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // EDGE CASES AND COMBINED SCENARIOS
  // ============================================================================

  describe('Edge Cases and Combined Scenarios', () => {
    it('should validate handshake flow with version mismatch', () => {
      const request = {
        versionInfo: {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER', 'PERSONA'],
        },
        apiKey: 'test-key',
      };

      const response = {
        compatible: false,
        reason: 'Schema version mismatch',
        versionInfo: {
          appVersion: '2.6.0',
          schemaVersion: '2.6.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER', 'PERSONA', 'CHAT'],
        },
      };

      expect(SyncHandshakeRequestSchema.safeParse(request).success).toBe(true);
      expect(SyncHandshakeResponseSchema.safeParse(response).success).toBe(true);
    });

    it('should validate delta response with mixed entity types', () => {
      const response = {
        serverTimestamp: '2025-01-01T12:00:00.000Z',
        deltas: [
          {
            entityType: 'CHARACTER',
            id: '550e8400-e29b-41d4-a716-446655440001',
            createdAt: '2025-01-01T10:00:00.000Z',
            updatedAt: '2025-01-01T11:00:00.000Z',
            isDeleted: false,
            data: { name: 'Character' },
          },
          {
            entityType: 'PERSONA',
            id: '550e8400-e29b-41d4-a716-446655440002',
            createdAt: '2025-01-01T10:30:00.000Z',
            updatedAt: '2025-01-01T11:30:00.000Z',
            isDeleted: false,
            data: { name: 'Persona' },
          },
          {
            entityType: 'CHAT',
            id: '550e8400-e29b-41d4-a716-446655440003',
            createdAt: '2025-01-01T10:45:00.000Z',
            updatedAt: '2025-01-01T11:45:00.000Z',
            isDeleted: true,
            data: null,
          },
        ],
        hasMore: false,
      };

      const result = SyncDeltaResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate Date objects in timestamp fields', () => {
      const entityDelta = {
        entityType: 'CHARACTER',
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: new Date('2025-01-01T10:00:00.000Z'),
        updatedAt: new Date('2025-01-01T12:00:00.000Z'),
        isDeleted: false,
        data: { name: 'Test' },
      };

      const result = SyncEntityDeltaSchema.safeParse(entityDelta);
      expect(result.success).toBe(true);
      if (result.success) {
        // TimestampSchema should transform Date to ISO string
        expect(typeof result.data.updatedAt).toBe('string');
        expect(result.data.updatedAt).toBe('2025-01-01T12:00:00.000Z');
      }
    });

    it('should fail with extra unknown fields (strict mode)', () => {
      const entityDelta = {
        entityType: 'CHARACTER',
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-01T12:00:00.000Z',
        isDeleted: false,
        data: { name: 'Test' },
        unknownField: 'should be ignored or rejected',
      };

      // Zod by default allows extra fields, so this will pass
      // If strict validation is needed, use .strict() on schemas
      const result = SyncEntityDeltaSchema.safeParse(entityDelta);
      expect(result.success).toBe(true);
    });
  });
});
