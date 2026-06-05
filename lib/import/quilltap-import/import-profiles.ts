/**
 * Import connection / image / embedding profiles. All three share the same
 * conflict-strategy shape and never restore API keys (apiKeyId is forced to
 * null on insert).
 *
 * @module import/quilltap-import/import-profiles
 */

import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/factory';
import type {
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
} from '@/lib/schemas/types';
import type { ImportOptions, IdMappingState, ImportCounts } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

const LEGACY_IMAGE_CAPABLE_PROVIDERS = new Set(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK']);

export async function importConnectionProfiles(
  userId: string,
  profiles: ConnectionProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const rawProfile of profiles) {
    // Older exports predate the per-profile supportsImageUpload flag; seed it
    // from the historic provider capability map so image support round-trips.
    const profile: ConnectionProfile =
      (rawProfile as Partial<ConnectionProfile>).supportsImageUpload === undefined
        ? { ...rawProfile, supportsImageUpload: LEGACY_IMAGE_CAPABLE_PROVIDERS.has(rawProfile.provider) }
        : rawProfile;

    try {
      const existing = await repos.connections.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.connectionProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.connections.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.connectionProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const newProfile = await repos.connections.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: `${profileData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const newProfile = await repos.connections.create({
        ...profileData,
        apiKeyId: null, // Don't restore API keys
      });
      idMaps.connectionProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import connection profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importImageProfiles(
  userId: string,
  profiles: ImageProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const existing = await repos.imageProfiles.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.imageProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.imageProfiles.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.imageProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const newProfile = await repos.imageProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: `${profileData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const newProfile = await repos.imageProfiles.create({
        ...profileData,
        apiKeyId: null, // Don't restore API keys
      });
      idMaps.imageProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import image profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}

export async function importEmbeddingProfiles(
  userId: string,
  profiles: EmbeddingProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>
): Promise<ImportCounts> {
  let imported = 0;
  let skipped = 0;

  for (const profile of profiles) {
    try {
      const existing = await repos.embeddingProfiles.findById(profile.id);

      if (existing) {
        if (options.conflictStrategy === 'skip') {
          skipped++;
          idMaps.embeddingProfiles.set(profile.id, profile.id);
          continue;
        }

        if (options.conflictStrategy === 'overwrite') {
          await repos.embeddingProfiles.delete(profile.id);
        }

        if (options.conflictStrategy === 'duplicate') {
          const newId = randomUUID();
          idMaps.embeddingProfiles.set(profile.id, newId);
          const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
          const newProfile = await repos.embeddingProfiles.create({
            ...profileData,
            apiKeyId: null, // Don't restore API keys
            name: `${profileData.name} (imported)`,
          });
          imported++;
          continue;
        }
      }

      const { id: _, userId: __, createdAt, updatedAt, ...profileData } = profile;
      const newProfile = await repos.embeddingProfiles.create({
        ...profileData,
        apiKeyId: null, // Don't restore API keys
      });
      idMaps.embeddingProfiles.set(profile.id, newProfile.id);
      imported++;
    } catch (error) {
      moduleLogger.warn('Failed to import embedding profile', {
        profileId: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imported, skipped };
}
