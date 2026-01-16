/**
 * Unit Tests for Sync Version Checker
 *
 * Tests the version compatibility checking system used during sync operations.
 * Covers version info generation, compatibility checks, and validation.
 */

// Unmock the version-checker module to test the real implementation
jest.unmock('@/lib/sync/version-checker');

import {
  getLocalVersionInfo,
  checkVersionCompatibility,
  validateVersionInfo,
  VersionCompatibilityResult,
} from '@/lib/sync/version-checker';
import { SyncVersionInfo, SCHEMA_VERSION, SYNC_PROTOCOL_VERSION } from '@/lib/sync/types';

describe('Sync Version Checker', () => {
  describe('getLocalVersionInfo', () => {
    it('should return version info with all required fields', () => {
      const versionInfo = getLocalVersionInfo();

      expect(versionInfo).toHaveProperty('appVersion');
      expect(versionInfo).toHaveProperty('schemaVersion');
      expect(versionInfo).toHaveProperty('syncProtocolVersion');
      expect(versionInfo).toHaveProperty('supportedEntityTypes');
    });

    it('should return correct version values', () => {
      const versionInfo = getLocalVersionInfo();

      expect(versionInfo.schemaVersion).toBe(SCHEMA_VERSION);
      expect(versionInfo.syncProtocolVersion).toBe(SYNC_PROTOCOL_VERSION);
      expect(typeof versionInfo.appVersion).toBe('string');
      expect(versionInfo.appVersion.length).toBeGreaterThan(0);
    });

    it('should return supported entity types array', () => {
      const versionInfo = getLocalVersionInfo();

      expect(Array.isArray(versionInfo.supportedEntityTypes)).toBe(true);
      expect(versionInfo.supportedEntityTypes.length).toBeGreaterThan(0);
      expect(versionInfo.supportedEntityTypes).toContain('CHARACTER');
      expect(versionInfo.supportedEntityTypes).toContain('TAG');
      expect(versionInfo.supportedEntityTypes).toContain('CHAT');
    });

    it('should return consistent results across multiple calls', () => {
      const info1 = getLocalVersionInfo();
      const info2 = getLocalVersionInfo();

      expect(info1.appVersion).toBe(info2.appVersion);
      expect(info1.schemaVersion).toBe(info2.schemaVersion);
      expect(info1.syncProtocolVersion).toBe(info2.syncProtocolVersion);
      expect(info1.supportedEntityTypes).toEqual(info2.supportedEntityTypes);
    });

    it('should have valid semver format for app version', () => {
      const versionInfo = getLocalVersionInfo();
      // Should match pattern like "2.5.0" or "2.5.0-dev.18"
      expect(versionInfo.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('checkVersionCompatibility', () => {
    let localVersion: SyncVersionInfo;

    beforeEach(() => {
      localVersion = getLocalVersionInfo();
    });

    describe('compatible versions', () => {
      it('should return compatible for identical versions', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: localVersion.schemaVersion,
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.localVersion).toEqual(localVersion);
        expect(result.remoteVersion).toEqual(remoteVersion);
      });

      it('should return compatible for same major schema version with different minor', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: '2.4.0',
          schemaVersion: '2.6.0', // Different minor, same major
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should return compatible for same major schema version with different patch', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: '2.5.1',
          schemaVersion: '2.5.1', // Different patch, same major
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should return compatible when remote supports all local entity types', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: localVersion.schemaVersion,
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: [
            ...localVersion.supportedEntityTypes,
            'TAG',
            'MEMORY',
          ] as any,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(true);
        expect(result.reason).toBeUndefined();
      });
    });

    describe('protocol version incompatibility', () => {
      it('should return incompatible for different protocol versions', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: localVersion.schemaVersion,
          syncProtocolVersion: '2.0', // Different protocol version
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('Sync protocol version mismatch');
        expect(result.reason).toContain('local=');
        expect(result.reason).toContain('remote=2.0');
        expect(result.localVersion).toEqual(localVersion);
        expect(result.remoteVersion).toEqual(remoteVersion);
      });

      it('should fail fast on protocol mismatch before checking schema', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: '99.0.0', // Also incompatible schema
          syncProtocolVersion: '99.0', // Incompatible protocol
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        // Should mention protocol, not schema
        expect(result.reason).toContain('protocol');
        expect(result.reason).not.toContain('schema');
      });
    });

    describe('schema version incompatibility', () => {
      it('should return incompatible for different major schema versions', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: '3.0.0',
          schemaVersion: '3.0.0', // Different major version
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('Schema version incompatible');
        expect(result.reason).toContain('Major versions must match');
        expect(result.localVersion).toEqual(localVersion);
        expect(result.remoteVersion).toEqual(remoteVersion);
      });

      it('should return incompatible for lower major schema version', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: '1.0.0',
          schemaVersion: '1.0.0', // Lower major version
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('Schema version incompatible');
      });

      it('should return incompatible for invalid schema version format', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: 'invalid-version',
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('Schema version incompatible');
      });
    });

    describe('entity type incompatibility', () => {
      it('should return incompatible when remote is missing entity types', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: localVersion.schemaVersion,
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: ['CHARACTER'], // Missing other types
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('Remote instance does not support all entity types');
        expect(result.reason).toContain('missing');
        expect(result.localVersion).toEqual(localVersion);
        expect(result.remoteVersion).toEqual(remoteVersion);
      });

      it('should return incompatible when remote supports no entity types', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: localVersion.schemaVersion,
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: [],
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain('Remote instance does not support all entity types');
      });

      it('should list all missing entity types in reason', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: localVersion.appVersion,
          schemaVersion: localVersion.schemaVersion,
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: ['CHARACTER', 'PERSONA'], // Missing some types
        };

        const result = checkVersionCompatibility(remoteVersion);

        expect(result.compatible).toBe(false);
        expect(result.reason).toBeDefined();
        // Should list missing types
        const missingTypes = localVersion.supportedEntityTypes.filter(
          (type) => !remoteVersion.supportedEntityTypes.includes(type)
        );
        missingTypes.forEach((type) => {
          expect(result.reason).toContain(type);
        });
      });
    });

    describe('edge cases', () => {
      it('should handle semver pre-release versions', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: '2.5.0-dev.18',
          schemaVersion: '2.5.0-beta.1',
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        // Should still be compatible if major version matches
        expect(result.compatible).toBe(true);
      });

      it('should handle semver build metadata', () => {
        const remoteVersion: SyncVersionInfo = {
          appVersion: '2.5.0+build.123',
          schemaVersion: '2.5.0+abc123',
          syncProtocolVersion: localVersion.syncProtocolVersion,
          supportedEntityTypes: localVersion.supportedEntityTypes,
        };

        const result = checkVersionCompatibility(remoteVersion);

        // Should still be compatible if major version matches
        expect(result.compatible).toBe(true);
      });
    });
  });

  describe('validateVersionInfo', () => {
    describe('valid version info', () => {
      it('should return true for complete valid version info', () => {
        const versionInfo: SyncVersionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER', 'PERSONA', 'CHAT'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(true);
      });

      it('should return true for version info with empty entity types array', () => {
        const versionInfo: SyncVersionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: [],
        };

        expect(validateVersionInfo(versionInfo)).toBe(true);
      });

      it('should return true for version info with non-standard version formats', () => {
        const versionInfo: SyncVersionInfo = {
          appVersion: '2.5.0-dev.18+build.123',
          schemaVersion: '2.5.0-beta.1',
          syncProtocolVersion: '1.0-alpha',
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(true);
      });
    });

    describe('invalid version info', () => {
      it('should return false for null', () => {
        expect(validateVersionInfo(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(validateVersionInfo(undefined)).toBe(false);
      });

      it('should return false for non-object values', () => {
        expect(validateVersionInfo('not an object')).toBe(false);
        expect(validateVersionInfo(123)).toBe(false);
        expect(validateVersionInfo(true)).toBe(false);
        expect(validateVersionInfo([])).toBe(false);
      });

      it('should return false for empty object', () => {
        expect(validateVersionInfo({})).toBe(false);
      });

      it('should return false when appVersion is missing', () => {
        const versionInfo = {
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when schemaVersion is missing', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when syncProtocolVersion is missing', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when supportedEntityTypes is missing', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when appVersion is not a string', () => {
        const versionInfo = {
          appVersion: 2.5,
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when schemaVersion is not a string', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: 2.5,
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when syncProtocolVersion is not a string', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: 1.0,
          supportedEntityTypes: ['CHARACTER'],
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when supportedEntityTypes is not an array', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: 'CHARACTER',
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false when supportedEntityTypes is null', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: null,
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });

      it('should return false for object with extra fields but missing required ones', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          // Missing syncProtocolVersion
          supportedEntityTypes: ['CHARACTER'],
          extraField: 'extra',
          anotherField: 123,
        };

        expect(validateVersionInfo(versionInfo)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return true for version info with extra fields', () => {
        const versionInfo = {
          appVersion: '2.5.0',
          schemaVersion: '2.5.0',
          syncProtocolVersion: '1.0',
          supportedEntityTypes: ['CHARACTER'],
          extraField: 'extra',
        };

        expect(validateVersionInfo(versionInfo)).toBe(true);
      });

      it('should return true for version info with empty strings (strings are valid)', () => {
        const versionInfo = {
          appVersion: '',
          schemaVersion: '',
          syncProtocolVersion: '',
          supportedEntityTypes: [],
        };

        // Empty strings are still strings, so this is technically valid
        // The actual compatibility check may reject empty versions
        expect(validateVersionInfo(versionInfo)).toBe(true);
      });
    });
  });

  describe('integration scenarios', () => {
    it('should validate version info before checking compatibility', () => {
      const localVersion = getLocalVersionInfo();

      // Validate that our local version is valid
      expect(validateVersionInfo(localVersion)).toBe(true);

      // Create a valid remote version
      const remoteVersion: SyncVersionInfo = {
        appVersion: '2.5.0',
        schemaVersion: localVersion.schemaVersion,
        syncProtocolVersion: localVersion.syncProtocolVersion,
        supportedEntityTypes: localVersion.supportedEntityTypes,
      };

      expect(validateVersionInfo(remoteVersion)).toBe(true);

      // Should be compatible
      const result = checkVersionCompatibility(remoteVersion);
      expect(result.compatible).toBe(true);
    });

    it('should handle the full handshake workflow', () => {
      // Step 1: Get local version
      const localVersion = getLocalVersionInfo();
      expect(validateVersionInfo(localVersion)).toBe(true);

      // Step 2: Receive remote version (simulated)
      const remoteVersion: SyncVersionInfo = {
        appVersion: '2.5.0',
        schemaVersion: localVersion.schemaVersion,
        syncProtocolVersion: localVersion.syncProtocolVersion,
        supportedEntityTypes: localVersion.supportedEntityTypes,
      };

      // Step 3: Validate remote version
      expect(validateVersionInfo(remoteVersion)).toBe(true);

      // Step 4: Check compatibility
      const result = checkVersionCompatibility(remoteVersion);
      expect(result.compatible).toBe(true);
      expect(result.localVersion).toEqual(localVersion);
      expect(result.remoteVersion).toEqual(remoteVersion);
    });

    it('should reject invalid remote version during handshake', () => {
      const localVersion = getLocalVersionInfo();
      expect(validateVersionInfo(localVersion)).toBe(true);

      // Invalid remote version (missing fields)
      const invalidRemote = {
        appVersion: '2.5.0',
        schemaVersion: '2.5.0',
        // Missing syncProtocolVersion and supportedEntityTypes
      };

      // Should fail validation
      expect(validateVersionInfo(invalidRemote)).toBe(false);

      // If we try to check compatibility anyway, TypeScript would prevent this,
      // but in JavaScript it would cause issues
    });
  });
});
