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
import {
  getSeedCharacters,
  prepareSeedCharacter,
  getSeedEmbeddingProfiles,
  prepareSeedEmbeddingProfile,
  getSeedImports,
} from '@/first-startup';
import { executeImport } from '@/lib/import/quilltap-import-service';

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

    // Get seed characters
    const seedCharacters = getSeedCharacters();

    if (seedCharacters.length === 0) {
      logger.warn('No seed characters defined', { context });
      return;
    }

    logger.info('Seeding initial data for first startup', {
      context,
      characterCount: seedCharacters.length,
    });

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

    // Seed embedding profiles if none exist
    await seedEmbeddingProfiles(repos, context);

    // Seed from .qtap import files (characters with memories, etc.)
    await seedFromImports(context);

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
