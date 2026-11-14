/**
 * Import connection / image / embedding profiles. All three go through
 * `insertUnderPolicy`, and none ever restores an API key: a created profile
 * has `apiKeyId: null`, and an overwritten one keeps the key it already had.
 *
 * @module import/quilltap-import/import-profiles
 */

import { logger } from '@/lib/logger';
import { getUserRepositories } from '@/lib/repositories/factory';
import type {
  ConnectionProfile,
  ImageProfile,
  EmbeddingProfile,
} from '@/lib/schemas/types';
import { normalizeProfileName, makeUniqueProfileName } from '@/lib/llm/connection-profile-names';
import { seedLegacyConnectionProfileFields } from '@/lib/llm/connection-profile-legacy-fields';
import { insertUnderPolicy, OutcomeTally } from '@/lib/backup/insert-policy';
import { type ImportOptions, type IdMappingState, type ImportCounts, countsFrom, noteWritten } from './types';

const moduleLogger = logger.child({ module: 'import:quilltap-import-service' });

/** The profile columns a bundle carries: no id, owner, timestamps or key. */
function profileFields<P extends { id: string; userId?: string; createdAt?: string; updatedAt?: string; apiKeyId?: string | null }>(
  profile: P
): Omit<P, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'apiKeyId'> {
  const { id: _id, userId: _userId, createdAt: _c, updatedAt: _u, apiKeyId: _key, ...fields } = profile;
  return fields;
}

export async function importConnectionProfiles(
  userId: string,
  profiles: ConnectionProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();

  // Connection-profile names are unique per user (enforced by a DB index), so
  // an insert must never reuse a name already present. Seed the taken-name set
  // from existing profiles and add each freshly-inserted name as we go.
  const existingProfiles = await repos.connections.findAll();
  const takenNames = new Set(existingProfiles.map((p) => normalizeProfileName(p.name)));
  const claimName = (wanted: string): string => {
    const unique = makeUniqueProfileName(wanted, takenNames);
    if (unique !== wanted) {
      moduleLogger.debug('Renamed connection profile on import to avoid name collision', { from: wanted, to: unique });
    }
    takenNames.add(normalizeProfileName(unique));
    return unique;
  };

  for (const rawProfile of profiles) {
    let profile: ConnectionProfile;
    try {
      // Older exports predate some of the columns; seed them so the bundle's
      // age, not the table DEFAULT, decides what the profile comes back as.
      // Shared with backup restore so the two paths can't drift. Inside the
      // per-item guard: one item that fails to seed is named and skipped, not
      // the whole import (bug 105).
      profile = seedLegacyConnectionProfileFields(rawProfile);
    } catch (error) {
      tally.add({ status: 'failed' });
      warnings.push(`Failed to import connection profile "${rawProfile.name}": ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (rawProfile.multiCharacterPrefill === undefined || rawProfile.supportsImageUpload === undefined) {
      moduleLogger.debug('Seeded connection-profile columns the bundle predates', {
        profileId: profile.id,
        provider: profile.provider,
        seededMultiCharacterPrefill: rawProfile.multiCharacterPrefill === undefined,
        seededSupportsImageUpload: rawProfile.supportsImageUpload === undefined,
      });
    }
    const fields = profileFields(profile);

    noteWritten(idMaps, tally.add(await insertUnderPolicy<ConnectionProfile>({
      kind: 'connection profile',
      label: profile.name,
      incomingId: profile.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.connections.findById(profile.id),
      create: ({ id, duplicate }) => repos.connections.create(
        {
          ...fields,
          apiKeyId: null, // Don't restore API keys
          name: claimName(duplicate ? `${fields.name} (imported)` : fields.name),
        },
        id ? { id } : undefined
      ),
      update: async (existing) => {
        // The overwritten row's name is no longer taken by it.
        takenNames.delete(normalizeProfileName(existing.name));
        // apiKeyId is left out of the patch: the existing key stays.
        await repos.connections.update(existing.id, { ...fields, name: claimName(fields.name) });
      },
      idMap: idMaps.connectionProfiles,
      warnings,
    })));
  }

  return countsFrom(tally);
}

export async function importImageProfiles(
  userId: string,
  profiles: ImageProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  for (const profile of profiles) {
    const fields = profileFields(profile);
    noteWritten(idMaps, tally.add(await insertUnderPolicy<ImageProfile>({
      kind: 'image profile',
      label: profile.name,
      incomingId: profile.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.imageProfiles.findById(profile.id),
      create: ({ id, duplicate }) => repos.imageProfiles.create(
        {
          ...fields,
          apiKeyId: null, // Don't restore API keys
          ...(duplicate ? { name: `${fields.name} (imported)` } : {}),
        },
        id ? { id } : undefined
      ),
      update: (existing) => repos.imageProfiles.update(existing.id, fields),
      idMap: idMaps.imageProfiles,
      warnings,
    })));
  }
  return countsFrom(tally);
}

export async function importEmbeddingProfiles(
  userId: string,
  profiles: EmbeddingProfile[],
  options: ImportOptions,
  idMaps: IdMappingState,
  repos: ReturnType<typeof getUserRepositories>,
  warnings: string[]
): Promise<ImportCounts> {
  const tally = new OutcomeTally();
  for (const profile of profiles) {
    const fields = profileFields(profile);
    noteWritten(idMaps, tally.add(await insertUnderPolicy<EmbeddingProfile>({
      kind: 'embedding profile',
      label: profile.name,
      incomingId: profile.id,
      strategy: options.conflictStrategy,
      preserveIds: options.preserveIds,
      findExisting: () => repos.embeddingProfiles.findById(profile.id),
      create: ({ id, duplicate }) => repos.embeddingProfiles.create(
        {
          ...fields,
          apiKeyId: null, // Don't restore API keys
          ...(duplicate ? { name: `${fields.name} (imported)` } : {}),
        },
        id ? { id } : undefined
      ),
      update: (existing) => repos.embeddingProfiles.update(existing.id, fields),
      idMap: idMaps.embeddingProfiles,
      warnings,
    })));
  }
  return countsFrom(tally);
}
