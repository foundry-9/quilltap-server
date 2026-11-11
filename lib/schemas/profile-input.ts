/**
 * Input pieces shared by the three profile kinds' request schemas
 * (connection, image, embedding): the forms an editor sends for "cleared" and
 * for a number, the identity fields every profile has, and the one database
 * check every kind makes of a named API key.
 *
 * @module schemas/profile-input
 */

import { z } from 'zod';
import { UUIDSchema } from '@/lib/schemas/common.types';
import type { RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

/** `''` means "cleared": an editor sends an empty field as an empty string. */
export function emptyToNull(value: unknown): unknown {
  return value === '' ? null : value;
}

/** A number sent as a numeric string (an older client, a hand call) is the number. */
export function numericString(value: unknown): unknown {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
}

/**
 * The fields every profile kind has, in their write-side form: the three
 * required strings trimmed and non-empty (with the messages the editors
 * show), the key and URL cleared by `''` or `null`.
 */
export const profileIdentityInputShape = {
  name: z.string().trim().min(1, 'Name is required'),
  provider: z.string().trim().min(1, 'Provider is required'),
  modelName: z.string().trim().min(1, 'Model name is required'),
  apiKeyId: z.preprocess(emptyToNull, UUIDSchema.nullable().optional()),
  baseUrl: z.preprocess(emptyToNull, z.string().nullable().optional()),
};

/**
 * Whether a named API key exists. Returns `false` only for a key that was
 * named and is not there; an absent or cleared key is fine.
 */
export async function apiKeyExists(
  apiKeyId: string | null | undefined,
  repos: RequestContext['repos'],
): Promise<boolean> {
  if (!apiKeyId) return true;
  const key = await repos.connections.findApiKeyById(apiKeyId);
  if (!key) {
    logger.debug('[Profile input] Named API key not found', { apiKeyId });
  }
  return Boolean(key);
}
