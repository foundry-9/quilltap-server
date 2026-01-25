/**
 * Unauthenticated User Service
 *
 * Manages the creation and retrieval of the unauthenticated user when AUTH_DISABLED=true.
 * The unauthenticated user is identified by a fixed UUID: ffffffff-ffff-ffff-ffff-ffffffffffff
 *
 * This is distinct from the deprecated anonymous user (00000000-0000-0000-0000-000000000000)
 * to avoid data migration issues and clearly differentiate the two concepts.
 */

import { logger } from '@/lib/logger';
import { User, AvatarDisplayMode } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { getUnauthenticatedUserName, getUnauthenticatedUserEmail } from './config';

/**
 * Fixed UUID for the unauthenticated user
 * This UUID is reserved for automatic access when AUTH_DISABLED=true
 */
export const UNAUTHENTICATED_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Get the current timestamp in ISO-8601 format
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get or create the unauthenticated user
 *
 * When called, this function will:
 * 1. Check if the unauthenticated user already exists in the repository
 * 2. If not found, create a new unauthenticated user with:
 *    - The fixed unauthenticated user UUID
 *    - Email from getUnauthenticatedUserEmail()
 *    - Name from getUnauthenticatedUserName()
 *    - No password hash (null)
 *    - TOTP disabled
 * 3. Return the User object
 *
 * @returns {Promise<User>} The unauthenticated user object
 * @throws {Error} If unable to create or retrieve the unauthenticated user
 */
export async function getOrCreateUnauthenticatedUser(): Promise<User> {
  try {
    const repos = getRepositories();

    // Check if unauthenticated user already exists
    const existingUser = await repos.users.findById(UNAUTHENTICATED_USER_ID);

    if (existingUser) {
      return existingUser;
    }

    // Create new unauthenticated user
    const now = getCurrentTimestamp();

    // Construct user with fixed ID
    const unauthenticatedUser: User = {
      id: UNAUTHENTICATED_USER_ID,
      username: 'unauthenticatedLocalUser',
      email: getUnauthenticatedUserEmail(),
      name: getUnauthenticatedUserName(),
      passwordHash: null,
      totp: {
        ciphertext: '',
        iv: '',
        authTag: '',
        enabled: false,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Insert or update the unauthenticated user using the repository
    // The repository handles backend-agnostic operations (SQLite/MongoDB)
    try {
      // Try to update if exists, otherwise create
      await repos.users.create(unauthenticatedUser);
    } catch (error) {
      // If it already exists, that's fine - we just need it to exist
      // The repository will handle any conflicts
      if (error instanceof Error && !error.message.includes('already exists')) {
        throw error;
      }
    }

    // Create chat settings using the repository method (which creates if not exists)
    await repos.chatSettings.updateForUser(UNAUTHENTICATED_USER_ID, {
      avatarDisplayMode: 'ALWAYS' as AvatarDisplayMode,
      avatarDisplayStyle: 'CIRCULAR',
      tagStyles: {},
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST',
        fallbackToLocal: true,
        embeddingProvider: 'OPENAI',
      },
    });
    return unauthenticatedUser;
  } catch (error) {
    logger.error(
      'Failed to get or create unauthenticated user',
      {
        context: 'getOrCreateUnauthenticatedUser',
        userId: UNAUTHENTICATED_USER_ID,
      },
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * Check if a user ID belongs to the unauthenticated user
 *
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if the user ID is the unauthenticated user ID, false otherwise
 */
export function isUnauthenticatedUser(userId: string): boolean {
  const isUnauthenticated = userId === UNAUTHENTICATED_USER_ID;
  return isUnauthenticated;
}
