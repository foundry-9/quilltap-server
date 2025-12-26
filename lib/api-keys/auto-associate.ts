/**
 * API Key Auto-Association Utility
 *
 * Automatically associates new API keys with profiles that need them.
 * This runs after API key import or creation to link keys with
 * connection profiles, image generation profiles, and embedding profiles
 * that are missing valid API keys.
 *
 * @module api-keys/auto-associate
 */

import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/factory';
import { requiresApiKey } from '@/lib/plugins/provider-validation';
import type { ApiKey, ConnectionProfile, ImageProfile, EmbeddingProfile } from '@/lib/schemas/types';

/**
 * Result of an auto-association operation
 */
export interface ProfileAssociation {
  profileId: string;
  profileName: string;
  profileType: 'connection' | 'image' | 'embedding';
  keyId: string;
  keyLabel: string;
}

/**
 * Result of the auto-associate function
 */
export interface AutoAssociateResult {
  associations: ProfileAssociation[];
  errors: string[];
}

/**
 * Check if a profile needs an API key based on its provider
 */
function profileNeedsApiKey(provider: string): boolean {
  // Use the provider validation utility to check if API key is required
  // This checks the provider registry for accurate requirements
  return requiresApiKey(provider);
}

/**
 * Check if an API key ID is valid (exists in the provided key list)
 */
function isValidApiKeyId(apiKeyId: string | null | undefined, apiKeys: ApiKey[]): boolean {
  if (!apiKeyId) return false;
  return apiKeys.some(key => key.id === apiKeyId);
}

/**
 * Find a matching API key for a profile based on provider
 * Returns the first matching key from the new keys that matches the profile's provider
 */
function findMatchingKey(
  profileProvider: string,
  newKeyIds: string[],
  allApiKeys: ApiKey[]
): ApiKey | null {
  // Get the new keys that match the profile provider
  for (const keyId of newKeyIds) {
    const key = allApiKeys.find(k => k.id === keyId);
    if (key && key.provider === profileProvider && key.isActive) {
      return key;
    }
  }
  return null;
}

/**
 * Find any available matching key for a profile based on provider
 * Returns the first active key that matches the profile's provider
 */
function findAnyMatchingKey(
  profileProvider: string,
  allApiKeys: ApiKey[]
): ApiKey | null {
  // Get the first active key that matches the profile provider
  return allApiKeys.find(key => key.provider === profileProvider && key.isActive) || null;
}

/**
 * Auto-associate profiles with any available API keys
 *
 * This function is called on settings tab navigation to ensure
 * any profiles without valid API keys get associated with matching keys.
 * It goes through all connection profiles, image profiles, and embedding profiles
 * for the user and links any that:
 * 1. Require an API key (based on their provider)
 * 2. Either have no apiKeyId or have an apiKeyId referencing a non-existent key
 * 3. Have a matching provider to any available key
 *
 * @param userId - The user ID to process
 * @returns Result containing successful associations and any errors
 */
export async function autoAssociateAllKeys(
  userId: string
): Promise<AutoAssociateResult> {
  const result: AutoAssociateResult = {
    associations: [],
    errors: [],
  };

  logger.debug('Starting API key auto-association (all keys)', {
    context: 'auto-associate.autoAssociateAllKeys',
    userId,
  });

  try {
    const repos = getUserRepositories(userId);

    // Get all API keys for the user
    const allApiKeys = await repos.connections.getAllApiKeys();

    if (!allApiKeys.length) {
      logger.debug('No API keys available for auto-association', {
        context: 'auto-associate.autoAssociateAllKeys',
        userId,
      });
      return result;
    }

    // Get all profiles
    const [connectionProfiles, imageProfiles, embeddingProfiles] = await Promise.all([
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
    ]);

    logger.debug('Fetched profiles for auto-association', {
      context: 'auto-associate.autoAssociateAllKeys',
      connectionProfiles: connectionProfiles.length,
      imageProfiles: imageProfiles.length,
      embeddingProfiles: embeddingProfiles.length,
      apiKeys: allApiKeys.length,
    });

    // Process connection profiles
    for (const profile of connectionProfiles) {
      try {
        if (profileNeedsApiKey(profile.provider) &&
            !isValidApiKeyId(profile.apiKeyId, allApiKeys)) {
          const matchingKey = findAnyMatchingKey(profile.provider, allApiKeys);
          if (matchingKey) {
            await repos.connections.update(profile.id, { apiKeyId: matchingKey.id });
            result.associations.push({
              profileId: profile.id,
              profileName: profile.name,
              profileType: 'connection',
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
            logger.info('Auto-associated connection profile with API key', {
              context: 'auto-associate.autoAssociateAllKeys',
              profileId: profile.id,
              profileName: profile.name,
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
          }
        }
      } catch (error) {
        const message = `Failed to auto-associate connection profile "${profile.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(message);
        logger.error(message, {
          context: 'auto-associate.autoAssociateAllKeys',
          profileId: profile.id,
        }, error instanceof Error ? error : undefined);
      }
    }

    // Process image profiles
    for (const profile of imageProfiles) {
      try {
        if (profileNeedsApiKey(profile.provider) &&
            !isValidApiKeyId(profile.apiKeyId, allApiKeys)) {
          const matchingKey = findAnyMatchingKey(profile.provider, allApiKeys);
          if (matchingKey) {
            await repos.imageProfiles.update(profile.id, { apiKeyId: matchingKey.id });
            result.associations.push({
              profileId: profile.id,
              profileName: profile.name,
              profileType: 'image',
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
            logger.info('Auto-associated image profile with API key', {
              context: 'auto-associate.autoAssociateAllKeys',
              profileId: profile.id,
              profileName: profile.name,
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
          }
        }
      } catch (error) {
        const message = `Failed to auto-associate image profile "${profile.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(message);
        logger.error(message, {
          context: 'auto-associate.autoAssociateAllKeys',
          profileId: profile.id,
        }, error instanceof Error ? error : undefined);
      }
    }

    // Process embedding profiles
    for (const profile of embeddingProfiles) {
      try {
        if (profileNeedsApiKey(profile.provider) &&
            !isValidApiKeyId(profile.apiKeyId, allApiKeys)) {
          const matchingKey = findAnyMatchingKey(profile.provider, allApiKeys);
          if (matchingKey) {
            await repos.embeddingProfiles.update(profile.id, { apiKeyId: matchingKey.id });
            result.associations.push({
              profileId: profile.id,
              profileName: profile.name,
              profileType: 'embedding',
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
            logger.info('Auto-associated embedding profile with API key', {
              context: 'auto-associate.autoAssociateAllKeys',
              profileId: profile.id,
              profileName: profile.name,
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
          }
        }
      } catch (error) {
        const message = `Failed to auto-associate embedding profile "${profile.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(message);
        logger.error(message, {
          context: 'auto-associate.autoAssociateAllKeys',
          profileId: profile.id,
        }, error instanceof Error ? error : undefined);
      }
    }

    logger.info('API key auto-association (all keys) complete', {
      context: 'auto-associate.autoAssociateAllKeys',
      userId,
      associations: result.associations.length,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = `Failed to auto-associate API keys: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errors.push(message);
    logger.error(message, {
      context: 'auto-associate.autoAssociateAllKeys',
      userId,
    }, error instanceof Error ? error : undefined);
    return result;
  }
}

/**
 * Auto-associate new API keys with profiles that need them
 *
 * This function is called after API keys are imported or created.
 * It goes through all connection profiles, image profiles, and embedding profiles
 * for the user and links any that:
 * 1. Require an API key (based on their provider)
 * 2. Either have no apiKeyId or have an apiKeyId referencing a non-existent key
 * 3. Have a matching provider to one of the new keys
 *
 * @param userId - The user ID to process
 * @param newKeyIds - IDs of newly created/imported API keys
 * @returns Result containing successful associations and any errors
 */
export async function autoAssociateApiKeys(
  userId: string,
  newKeyIds: string[]
): Promise<AutoAssociateResult> {
  const result: AutoAssociateResult = {
    associations: [],
    errors: [],
  };

  if (!newKeyIds.length) {
    logger.debug('No new keys to auto-associate', {
      context: 'auto-associate.autoAssociateApiKeys',
      userId,
    });
    return result;
  }

  logger.info('Starting API key auto-association', {
    context: 'auto-associate.autoAssociateApiKeys',
    userId,
    newKeyCount: newKeyIds.length,
  });

  try {
    const repos = getUserRepositories(userId);

    // Get all API keys for the user (to check for valid references)
    const allApiKeys = await repos.connections.getAllApiKeys();

    // Get all profiles
    const [connectionProfiles, imageProfiles, embeddingProfiles] = await Promise.all([
      repos.connections.findAll(),
      repos.imageProfiles.findAll(),
      repos.embeddingProfiles.findAll(),
    ]);

    logger.debug('Fetched profiles for auto-association', {
      context: 'auto-associate.autoAssociateApiKeys',
      connectionProfiles: connectionProfiles.length,
      imageProfiles: imageProfiles.length,
      embeddingProfiles: embeddingProfiles.length,
      apiKeys: allApiKeys.length,
    });

    // Process connection profiles
    for (const profile of connectionProfiles) {
      try {
        if (profileNeedsApiKey(profile.provider) &&
            !isValidApiKeyId(profile.apiKeyId, allApiKeys)) {
          const matchingKey = findMatchingKey(profile.provider, newKeyIds, allApiKeys);
          if (matchingKey) {
            await repos.connections.update(profile.id, { apiKeyId: matchingKey.id });
            result.associations.push({
              profileId: profile.id,
              profileName: profile.name,
              profileType: 'connection',
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
            logger.info('Auto-associated connection profile with API key', {
              context: 'auto-associate.autoAssociateApiKeys',
              profileId: profile.id,
              profileName: profile.name,
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
          }
        }
      } catch (error) {
        const message = `Failed to auto-associate connection profile "${profile.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(message);
        logger.error(message, {
          context: 'auto-associate.autoAssociateApiKeys',
          profileId: profile.id,
        }, error instanceof Error ? error : undefined);
      }
    }

    // Process image profiles
    for (const profile of imageProfiles) {
      try {
        if (profileNeedsApiKey(profile.provider) &&
            !isValidApiKeyId(profile.apiKeyId, allApiKeys)) {
          const matchingKey = findMatchingKey(profile.provider, newKeyIds, allApiKeys);
          if (matchingKey) {
            await repos.imageProfiles.update(profile.id, { apiKeyId: matchingKey.id });
            result.associations.push({
              profileId: profile.id,
              profileName: profile.name,
              profileType: 'image',
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
            logger.info('Auto-associated image profile with API key', {
              context: 'auto-associate.autoAssociateApiKeys',
              profileId: profile.id,
              profileName: profile.name,
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
          }
        }
      } catch (error) {
        const message = `Failed to auto-associate image profile "${profile.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(message);
        logger.error(message, {
          context: 'auto-associate.autoAssociateApiKeys',
          profileId: profile.id,
        }, error instanceof Error ? error : undefined);
      }
    }

    // Process embedding profiles
    for (const profile of embeddingProfiles) {
      try {
        if (profileNeedsApiKey(profile.provider) &&
            !isValidApiKeyId(profile.apiKeyId, allApiKeys)) {
          const matchingKey = findMatchingKey(profile.provider, newKeyIds, allApiKeys);
          if (matchingKey) {
            await repos.embeddingProfiles.update(profile.id, { apiKeyId: matchingKey.id });
            result.associations.push({
              profileId: profile.id,
              profileName: profile.name,
              profileType: 'embedding',
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
            logger.info('Auto-associated embedding profile with API key', {
              context: 'auto-associate.autoAssociateApiKeys',
              profileId: profile.id,
              profileName: profile.name,
              keyId: matchingKey.id,
              keyLabel: matchingKey.label,
            });
          }
        }
      } catch (error) {
        const message = `Failed to auto-associate embedding profile "${profile.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(message);
        logger.error(message, {
          context: 'auto-associate.autoAssociateApiKeys',
          profileId: profile.id,
        }, error instanceof Error ? error : undefined);
      }
    }

    logger.info('API key auto-association complete', {
      context: 'auto-associate.autoAssociateApiKeys',
      userId,
      associations: result.associations.length,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    const message = `Failed to auto-associate API keys: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errors.push(message);
    logger.error(message, {
      context: 'auto-associate.autoAssociateApiKeys',
      userId,
    }, error instanceof Error ? error : undefined);
    return result;
  }
}
