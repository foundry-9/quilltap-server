/**
 * Anonymous User Service - DEPRECATED
 *
 * This module is deprecated. Use unauthenticated-user.ts instead.
 *
 * This file is kept for backward compatibility and re-exports functions
 * from the new unauthenticated-user.ts module with deprecation warnings.
 *
 * The anonymous user ID (00000000-0000-0000-0000-000000000000) is different
 * from the new unauthenticated user ID (ffffffff-ffff-ffff-ffff-ffffffffffff)
 * to avoid data conflicts during migration.
 *
 * @deprecated Use unauthenticated-user.ts instead
 */

import { logger } from '@/lib/logger';
import { User } from '@/lib/schemas/types';
import {
  UNAUTHENTICATED_USER_ID,
  getOrCreateUnauthenticatedUser,
  isUnauthenticatedUser,
} from './unauthenticated-user';

/**
 * @deprecated Use UNAUTHENTICATED_USER_ID from unauthenticated-user.ts instead
 *
 * Note: This still returns the old anonymous user ID for backward compatibility
 * with existing data. New code should use UNAUTHENTICATED_USER_ID.
 */
export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * @deprecated Use getOrCreateUnauthenticatedUser() from unauthenticated-user.ts instead
 *
 * This function now delegates to getOrCreateUnauthenticatedUser() which uses
 * the new user ID (ffffffff-...). Existing data with the old anonymous user ID
 * (00000000-...) will not be affected but new sessions will use the new ID.
 */
export async function getOrCreateAnonymousUser(): Promise<User> {
  logger.warn(
    'getOrCreateAnonymousUser() is deprecated, use getOrCreateUnauthenticatedUser()',
    {
      context: 'getOrCreateAnonymousUser',
    }
  );
  return getOrCreateUnauthenticatedUser();
}

/**
 * @deprecated Use isUnauthenticatedUser() from unauthenticated-user.ts instead
 *
 * This function checks both the old anonymous user ID and the new unauthenticated
 * user ID for backward compatibility.
 */
export function isAnonymousUser(userId: string): boolean {
  logger.warn('isAnonymousUser() is deprecated, use isUnauthenticatedUser()', {
    context: 'isAnonymousUser',
  });

  // Check both old anonymous ID and new unauthenticated ID for backward compatibility
  const isOldAnonymous = userId === ANONYMOUS_USER_ID;
  const isNewUnauthenticated = isUnauthenticatedUser(userId);

  return isOldAnonymous || isNewUnauthenticated;
}

// Re-export new functions for gradual migration
export { UNAUTHENTICATED_USER_ID, getOrCreateUnauthenticatedUser, isUnauthenticatedUser };
