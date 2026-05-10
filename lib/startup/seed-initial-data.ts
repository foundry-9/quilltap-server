/**
 * Initial Data Seeding Service
 *
 * Seeds default data on first application startup when the database
 * is empty. Seeds default character(s) and a TF-IDF embedding profile
 * to provide immediate functionality for new users without requiring
 * any API keys.
 *
 * @module lib/startup/seed-initial-data
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/database/repositories';
import { SINGLE_USER_ID } from '@/lib/auth/single-user';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import {
  getSeedCharacters,
  prepareSeedCharacter,
  getSeedEmbeddingProfiles,
  prepareSeedEmbeddingProfile,
  getSeedImports,
  getSeedAvatars,
} from '@/first-startup';
import { executeImport } from '@/lib/import/quilltap-import-service';
import { fileStorageManager } from '@/lib/file-storage/manager';
import {
  getCharacterVaultStore,
  writeCharacterAvatarToVault,
} from '@/lib/file-storage/character-vault-bridge';

/**
 * Seed initial data if the database is empty
 *
 * This function checks if any characters exist for the default user.
 * If no characters exist, it seeds the default character(s) to provide
 * immediate functionality for new users.
 *
 * This function is designed to be safe to call multiple times - it only
 * seeds data when the database is truly empty.
 *
 * @returns Promise<void>
 */
export async function seedInitialData(): Promise<void> {
  const context = 'seed-initial-data';

  try {
    const repos = getRepositories();

    // Check if any characters exist for the default user
    const existingCharacters = await repos.characters.findByUserId(SINGLE_USER_ID);

    if (existingCharacters.length > 0) {
      // Database already has characters, no need to seed
      return;
    }

    logger.info('Seeding initial data for first startup', { context });

    // Get seed characters from JSON files (if any)
    const seedCharacters = getSeedCharacters();

    if (seedCharacters.length > 0) {
      // Create each seed character
      for (const seedData of seedCharacters) {
        try {
          const characterData = prepareSeedCharacter(seedData, SINGLE_USER_ID);
          const created = await repos.characters.create(characterData);

          logger.info('Seeded initial character', {
            context,
            characterId: created.id,
            characterName: created.name,
          });
        } catch (charError) {
          logger.error('Failed to seed character', {
            context,
            characterName: seedData.name,
            error: charError instanceof Error ? charError.message : String(charError),
          });
          // Continue with other characters even if one fails
        }
      }

      logger.info('Character seeding complete', {
        context,
        seededCount: seedCharacters.length,
      });
    }

    // Seed embedding profiles if none exist
    await seedEmbeddingProfiles(repos, context);

    // Seed from .qtap import files (characters with memories, etc.)
    await seedFromImports(context);

    // Seed avatar images for imported characters
    await seedAvatars(repos, context);

    logger.info('Initial data seeding complete', { context });
  } catch (error) {
    logger.error('Error during initial data seeding', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - seeding failure should not prevent startup
  }
}

/**
 * Seed default embedding profile if none exist
 *
 * Creates a default TF-IDF embedding profile to enable semantic search
 * without requiring any API keys. This provides immediate functionality
 * for memory search and retrieval.
 */
async function seedEmbeddingProfiles(
  repos: ReturnType<typeof getRepositories>,
  context: string
): Promise<void> {
  try {
    // Check if any embedding profiles exist
    const existingProfiles = await repos.embeddingProfiles.findAll();

    if (existingProfiles.length > 0) {
      // Embedding profiles already exist, no need to seed
      return;
    }

    // Get seed embedding profiles
    const seedProfiles = getSeedEmbeddingProfiles();

    if (seedProfiles.length === 0) {
      logger.warn('No seed embedding profiles defined', { context });
      return;
    }

    logger.info('Seeding default embedding profile', {
      context,
      profileCount: seedProfiles.length,
    });

    // Create each seed embedding profile
    for (const seedData of seedProfiles) {
      try {
        const profileData = prepareSeedEmbeddingProfile(seedData, SINGLE_USER_ID);
        const created = await repos.embeddingProfiles.create(profileData);

        logger.info('Seeded embedding profile', {
          context,
          profileId: created.id,
          profileName: created.name,
          provider: created.provider,
          isDefault: created.isDefault,
        });
      } catch (profileError) {
        logger.error('Failed to seed embedding profile', {
          context,
          profileName: seedData.name,
          error: profileError instanceof Error ? profileError.message : String(profileError),
        });
        // Continue with other profiles even if one fails
      }
    }
  } catch (error) {
    logger.error('Error seeding embedding profiles', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - this is non-critical
  }
}

/**
 * Seed data from .qtap import files
 *
 * Loads .qtap files from first-startup/imports/ and runs them through
 * the standard import service with 'skip' conflict strategy. This allows
 * seeding characters with their memories and other related data in a
 * single bundle. The skip strategy ensures no duplicates on repeated runs.
 */
async function seedFromImports(context: string): Promise<void> {
  try {
    const seedImports = getSeedImports();

    if (seedImports.length === 0) {
      return;
    }

    logger.info('Seeding from .qtap import files', {
      context,
      fileCount: seedImports.length,
    });

    for (const { filename, data } of seedImports) {
      try {
        const result = await executeImport(SINGLE_USER_ID, data, {
          conflictStrategy: 'skip',
          includeMemories: true,
          includeRelatedEntities: false,
        });

        logger.info('Seed import complete', {
          context,
          filename,
          success: result.success,
          imported: result.imported,
          skipped: result.skipped,
          warnings: result.warnings.length > 0 ? result.warnings : undefined,
        });
      } catch (importError) {
        logger.error('Failed to execute seed import', {
          context,
          filename,
          error: importError instanceof Error ? importError.message : String(importError),
        });
        // Continue with other import files
      }
    }
  } catch (error) {
    logger.error('Error during seed imports', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - seed import failure should not prevent startup
  }
}

/**
 * Seed avatar images for imported characters
 *
 * Loads avatar image files from first-startup/avatars/ and associates them
 * with characters by name. Creates file entries in the database, uploads
 * files to storage, and sets defaultImageId on the matching characters.
 *
 * Skips characters that already have a defaultImageId set with a valid
 * file entry, ensuring idempotent behavior on repeated runs.
 */
async function seedAvatars(
  repos: ReturnType<typeof getRepositories>,
  context: string,
  targetCharacterNames?: string[]
): Promise<void> {
  try {
    const normalizedTargetNames = targetCharacterNames?.map(name => name.toLowerCase());
    const seedAvatarData = getSeedAvatars().filter(avatar => {
      if (!normalizedTargetNames || normalizedTargetNames.length === 0) {
        return true;
      }

      return normalizedTargetNames.includes(avatar.characterName.toLowerCase());
    });

    if (seedAvatarData.length === 0) {
      return;
    }

    logger.info('Seeding avatar images for characters', {
      context,
      avatarCount: seedAvatarData.length,
      characters: seedAvatarData.map(a => a.characterName),
    });

    // Get all characters for the default user to match by name
    const allCharacters = await repos.characters.findByUserId(SINGLE_USER_ID);

    for (const avatar of seedAvatarData) {
      try {
        // Find the character by name (case-insensitive match)
        const character = allCharacters.find(
          c => c.name.toLowerCase() === avatar.characterName.toLowerCase()
        );

        if (!character) {
          logger.warn('No matching character found for seed avatar', {
            context,
            characterName: avatar.characterName,
          });
          continue;
        }

        // Skip if the character already has a valid avatar file
        if (character.defaultImageId) {
          const existingFile = await repos.files.findById(character.defaultImageId);
          if (existingFile) {
            continue;
          }
        }

        // Calculate SHA256 hash for the image
        const sha256 = createHash('sha256').update(avatar.content).digest('hex');

        // Route the seed avatar into the character vault when one exists.
        // Seeds are the canonical "main" — they overwrite images/avatar.webp.
        let storageKey: string;
        let fileFolderPath: string | null = '/';
        const vault = await getCharacterVaultStore(character.id);
        if (vault) {
          const written = await writeCharacterAvatarToVault({
            characterId: character.id,
            kind: 'main',
            filename: avatar.filename,
            content: avatar.content,
            contentType: avatar.mimeType,
          });
          storageKey = written.storageKey;
          fileFolderPath = null;
        } else {
          const uploaded = await fileStorageManager.uploadFile({
            filename: avatar.filename,
            content: avatar.content,
            contentType: avatar.mimeType,
          });
          storageKey = uploaded.storageKey;
        }

        // Create the file entry in the database
        const fileId = randomUUID();
        const fileEntry = await repos.files.create({
          userId: SINGLE_USER_ID,
          sha256,
          originalFilename: avatar.filename,
          mimeType: avatar.mimeType,
          size: avatar.content.length,
          width: null,
          height: null,
          linkedTo: [character.id],
          source: 'SYSTEM',
          category: 'AVATAR',
          storageKey,
          generationPrompt: null,
          generationModel: null,
          generationRevisedPrompt: null,
          description: null,
          tags: [],
          folderPath: fileFolderPath,
          projectId: null,
        }, { id: fileId });

        // Update the character's defaultImageId
        await repos.characters.update(character.id, {
          defaultImageId: fileEntry.id,
        });

        logger.info('Seeded avatar for character', {
          context,
          characterName: character.name,
          characterId: character.id,
          fileId: fileEntry.id,
          storageKey,
          size: avatar.content.length,
        });
      } catch (avatarError) {
        logger.error('Failed to seed avatar for character', {
          context,
          characterName: avatar.characterName,
          error: avatarError instanceof Error ? avatarError.message : String(avatarError),
        });
        // Continue with other avatars
      }
    }
  } catch (error) {
    logger.error('Error during avatar seeding', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - avatar seeding failure should not prevent startup
  }
}

export async function reseedAvatarsForCharacters(
  characterNames: string[],
  context = 'reseed-avatars'
): Promise<void> {
  const repos = getRepositories();
  await seedAvatars(repos, context, characterNames);
}
