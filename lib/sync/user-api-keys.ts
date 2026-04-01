/**
 * User Sync API Key Types
 *
 * Zod schemas and TypeScript types for user API keys used for
 * sync authentication between Quilltap instances.
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from '@/lib/schemas/types';

// ============================================================================
// USER SYNC API KEY
// ============================================================================

/**
 * A user's sync API key for authenticating to this instance from remote instances.
 * The key itself is stored as a hash - the plaintext is only shown once on creation.
 */
export const UserSyncApiKeySchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  // Display name for this key
  name: z.string().min(1).max(100),
  // First 8 characters of the key for identification (qt_sync_xxxxxxxx...)
  keyPrefix: z.string().length(8),
  // bcrypt hash of the full key
  keyHash: z.string(),
  isActive: z.boolean().default(true),
  // When this key was last used for authentication
  lastUsedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type UserSyncApiKey = z.infer<typeof UserSyncApiKeySchema>;

/**
 * Data required to create a new sync API key
 */
export const CreateUserSyncApiKeySchema = z.object({
  userId: UUIDSchema,
  name: z.string().min(1).max(100),
  keyPrefix: z.string().length(8),
  keyHash: z.string(),
  isActive: z.boolean().default(true),
});

export type CreateUserSyncApiKey = z.infer<typeof CreateUserSyncApiKeySchema>;

/**
 * Response when creating a new API key - includes the plaintext key (shown only once)
 */
export interface CreateApiKeyResponse {
  key: UserSyncApiKey;
  plaintextKey: string; // Only returned on creation, never stored
}

/**
 * API key format: qt_sync_{32 random hex chars}
 * Total length: 40 characters
 */
export const API_KEY_PREFIX = 'qt_sync_';
export const API_KEY_RANDOM_LENGTH = 32;
