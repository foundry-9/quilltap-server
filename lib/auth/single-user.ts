/**
 * Single User Service
 *
 * Manages the creation and retrieval of the single user in single-user mode.
 * Quilltap operates exclusively in single-user mode - no authentication required.
 *
 * The single user is identified by a fixed UUID: ffffffff-ffff-ffff-ffff-ffffffffffff
 */

import { logger } from '@/lib/logger';
import { User, AvatarDisplayMode } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * Fixed UUID for the single user
 * This UUID is reserved for the single-user mode
 */
export const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Default single user name
 * Can be overridden via AUTH_UNAUTHENTICATED_USER_NAME env var for backwards compatibility
 */
export function getSingleUserName(): string {
  return process.env.AUTH_UNAUTHENTICATED_USER_NAME || 'Local User';
}

/**
 * Default single user email
 * Used for database records
 */
export function getSingleUserEmail(): string {
  return 'user@localhost.localdomain';
}

/**
 * Get the current timestamp in ISO-8601 format
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get or create the single user
 *
 * When called, this function will:
 * 1. Check if the single user already exists in the repository
 * 2. If not found, create a new single user with:
 *    - The fixed single user UUID
 *    - Default email and name
 *    - No password hash (null)
 * 3. Return the User object
 *
 * @returns {Promise<User>} The single user object
 * @throws {Error} If unable to create or retrieve the single user
 */
export async function getOrCreateSingleUser(): Promise<User> {
  try {
    const repos = getRepositories();

    // Check if single user already exists
    const existingUser = await repos.users.findById(SINGLE_USER_ID);

    if (existingUser) {
      return existingUser;
    }

    // Create new single user
    const now = getCurrentTimestamp();

    const singleUser: User = {
      id: SINGLE_USER_ID,
      username: 'localUser',
      email: getSingleUserEmail(),
      name: getSingleUserName(),
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
    };

    // Insert the single user using the repository
    try {
      await repos.users.create(singleUser);
    } catch (error) {
      // If it already exists, that's fine - we just need it to exist
      if (error instanceof Error && !error.message.includes('already exists')) {
        throw error;
      }
    }

    // Create default chat settings
    await repos.chatSettings.updateForUser(SINGLE_USER_ID, {
      avatarDisplayMode: 'ALWAYS' as AvatarDisplayMode,
      avatarDisplayStyle: 'CIRCULAR',
      tagStyles: {},
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: true,
        embeddingProvider: 'OPENAI',
      },
    });

    logger.info('Created single user', {
      context: 'getOrCreateSingleUser',
      userId: SINGLE_USER_ID,
    });

    return singleUser;
  } catch (error) {
    logger.error(
      'Failed to get or create single user',
      {
        context: 'getOrCreateSingleUser',
        userId: SINGLE_USER_ID,
      },
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * Check if a user ID belongs to the single user
 *
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if the user ID is the single user ID
 */
export function isSingleUser(userId: string): boolean {
  return userId === SINGLE_USER_ID;
}

// Backwards compatibility exports
export const UNAUTHENTICATED_USER_ID = SINGLE_USER_ID;
export const getOrCreateUnauthenticatedUser = getOrCreateSingleUser;
export const isUnauthenticatedUser = isSingleUser;
