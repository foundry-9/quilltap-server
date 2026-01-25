/**
 * Sync Version Checker
 *
 * Handles version compatibility checking between Quilltap instances
 * during sync operations. Ensures that schema and protocol versions
 * are compatible before allowing data synchronization.
 */

import { logger } from '@/lib/logger';
import {
  SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  SyncVersionInfo,
  SyncableEntityType,
  SyncableEntityTypeEnum,
} from './types';
import packageJson from '@/package.json';

/**
 * Result of a version compatibility check
 */
export interface VersionCompatibilityResult {
  compatible: boolean;
  reason?: string;
  localVersion: SyncVersionInfo;
  remoteVersion?: SyncVersionInfo;
}

/**
 * Get the current instance's version info
 */
export function getLocalVersionInfo(): SyncVersionInfo {
  // Get app version directly from package.json (includes full version like 2.5.0-dev.25)
  const appVersion = packageJson.version;

  const versionInfo: SyncVersionInfo = {
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    syncProtocolVersion: SYNC_PROTOCOL_VERSION,
    supportedEntityTypes: SyncableEntityTypeEnum.options as SyncableEntityType[],
  };
  return versionInfo;
}

/**
 * Parse a semver version string into components
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  // Handle versions like "2.5.0" or "2.5.0-dev.18"
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Check if two schema versions are compatible.
 * Major version must match for compatibility.
 */
function areSchemaVersionsCompatible(localVersion: string, remoteVersion: string): boolean {
  const local = parseVersion(localVersion);
  const remote = parseVersion(remoteVersion);

  if (!local || !remote) {
    logger.warn('Failed to parse schema versions', {
      context: 'sync:version-checker',
      localVersion,
      remoteVersion,
    });
    return false;
  }

  // Major version must match
  const compatible = local.major === remote.major;
  return compatible;
}

/**
 * Check if two protocol versions are compatible.
 * Protocol versions must match exactly.
 */
function areProtocolVersionsCompatible(localVersion: string, remoteVersion: string): boolean {
  const compatible = localVersion === remoteVersion;
  return compatible;
}

/**
 * Check if the remote instance supports the entity types we want to sync
 */
function areEntityTypesCompatible(
  localTypes: SyncableEntityType[],
  remoteTypes: SyncableEntityType[]
): { compatible: boolean; missingTypes: SyncableEntityType[] } {
  const remoteTypeSet = new Set(remoteTypes);
  const missingTypes = localTypes.filter((type) => !remoteTypeSet.has(type));

  const compatible = missingTypes.length === 0;
  return { compatible, missingTypes };
}

/**
 * Check full version compatibility between local and remote instances.
 * Returns detailed information about compatibility status.
 */
export function checkVersionCompatibility(
  remoteVersionInfo: SyncVersionInfo
): VersionCompatibilityResult {
  const localVersionInfo = getLocalVersionInfo();

  logger.info('Checking version compatibility', {
    context: 'sync:version-checker',
    local: localVersionInfo,
    remote: remoteVersionInfo,
  });

  // Check protocol version (must match exactly)
  if (
    !areProtocolVersionsCompatible(
      localVersionInfo.syncProtocolVersion,
      remoteVersionInfo.syncProtocolVersion
    )
  ) {
    const reason = `Sync protocol version mismatch: local=${localVersionInfo.syncProtocolVersion}, remote=${remoteVersionInfo.syncProtocolVersion}. Both instances must use the same sync protocol version.`;

    logger.warn('Version compatibility check failed: protocol mismatch', {
      context: 'sync:version-checker',
      reason,
    });

    return {
      compatible: false,
      reason,
      localVersion: localVersionInfo,
      remoteVersion: remoteVersionInfo,
    };
  }

  // Check schema version (major must match)
  if (
    !areSchemaVersionsCompatible(localVersionInfo.schemaVersion, remoteVersionInfo.schemaVersion)
  ) {
    const reason = `Schema version incompatible: local=${localVersionInfo.schemaVersion}, remote=${remoteVersionInfo.schemaVersion}. Major versions must match.`;

    logger.warn('Version compatibility check failed: schema mismatch', {
      context: 'sync:version-checker',
      reason,
    });

    return {
      compatible: false,
      reason,
      localVersion: localVersionInfo,
      remoteVersion: remoteVersionInfo,
    };
  }

  // Check entity type support
  const entityTypeCheck = areEntityTypesCompatible(
    localVersionInfo.supportedEntityTypes,
    remoteVersionInfo.supportedEntityTypes
  );

  if (!entityTypeCheck.compatible) {
    const reason = `Remote instance does not support all entity types: missing ${entityTypeCheck.missingTypes.join(', ')}`;

    logger.warn('Version compatibility check failed: entity type mismatch', {
      context: 'sync:version-checker',
      reason,
      missingTypes: entityTypeCheck.missingTypes,
    });

    return {
      compatible: false,
      reason,
      localVersion: localVersionInfo,
      remoteVersion: remoteVersionInfo,
    };
  }

  logger.info('Version compatibility check passed', {
    context: 'sync:version-checker',
    localVersion: localVersionInfo.schemaVersion,
    remoteVersion: remoteVersionInfo.schemaVersion,
  });

  return {
    compatible: true,
    localVersion: localVersionInfo,
    remoteVersion: remoteVersionInfo,
  };
}

/**
 * Validate that a version info object has all required fields
 */
export function validateVersionInfo(versionInfo: unknown): versionInfo is SyncVersionInfo {
  if (!versionInfo || typeof versionInfo !== 'object') {
    return false;
  }

  const info = versionInfo as Record<string, unknown>;

  const hasRequiredFields =
    typeof info.appVersion === 'string' &&
    typeof info.schemaVersion === 'string' &&
    typeof info.syncProtocolVersion === 'string' &&
    Array.isArray(info.supportedEntityTypes);

  if (!hasRequiredFields) {
    return false;
  }

  return true;
}
