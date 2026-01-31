/**
 * Initial Data Seeding Service
 *
 * Seeds default data on first application startup when the database
 * is empty. Currently seeds a default character to provide immediate
 * functionality for new users.
 *
 * @module lib/startup/seed-initial-data
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/database/repositories';
import { SINGLE_USER_ID } from '@/lib/auth/single-user';
import { getSeedCharacters, prepareSeedCharacter } from '@/first-startup';

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

    logger.info('Initial data seeding complete', {
      context,
      seededCount: seedCharacters.length,
    });
  } catch (error) {
    logger.error('Error during initial data seeding', {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - seeding failure should not prevent startup
  }
}
