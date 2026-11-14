/**
 * Connection profiles — the request-body shapes and the rules both the create
 * and the update route apply.
 *
 * The two handlers used to validate by hand, field by field, and had drifted:
 * create never type-checked `parameters`, `isDefault`, `isCheap` or
 * `sortIndex`, and resolved a bad `pseudoToolMode` to `'auto'` silently, while
 * update refused both; update type-checked `courierDeltaMode` and create
 * coerced it; the fallback-profile rules were written twice. Here the body is
 * one schema derived from `ConnectionProfileSchema` (strict — an unknown key is
 * a 400), the update is its `patchSchemaOf`, and the rules that need the
 * database or the stored row live in two functions both routes call.
 *
 * Where the copies disagreed, the stricter behaviour won. The profile editor
 * (`components/settings/connection-profiles/hooks/useProfileForm.ts`) and the
 * setup wizard send only values this accepts.
 *
 * @module llm/connection-profile-input
 */

import { z } from 'zod';
import { ConnectionProfileSchema, type ConnectionProfile } from '@/lib/schemas/profile.types';
import { patchSchemaOf } from '@/lib/schemas/patch-schema';
import { emptyToNull, numericString, profileIdentityInputShape } from '@/lib/schemas/profile-input';
import { isValidModelClassName } from '@/lib/llm/model-classes';
import { logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/api/middleware';

const entity = ConnectionProfileSchema.shape;

/**
 * Every field an operator may write, with the input forms the routes have
 * always accepted (`''` for a cleared id or URL, `0` or `''` for no context
 * override, a numeric string for a number).
 */
const ConnectionProfileInputObject = ConnectionProfileSchema.pick({
  transport: true,
  courierDeltaMode: true,
  isDefault: true,
  isCheap: true,
  isDangerousCompatible: true,
  allowWebSearch: true,
  useNativeWebSearch: true,
  allowToolUse: true,
  pseudoToolMode: true,
  multiCharacterPrefill: true,
  allowTierFallback: true,
  parameters: true,
}).extend({
  // No default here: an unsent value means "derive it from the provider" on
  // create (see the route) and "leave it" on update.
  supportsImageUpload: z.boolean(),
  ...profileIdentityInputShape,
  fallbackProfileId: z.preprocess(emptyToNull, entity.fallbackProfileId),
  modelClass: z.preprocess(
    emptyToNull,
    z
      .string()
      .refine((value) => isValidModelClassName(value), { error: (issue) => `Invalid model class: ${String(issue.input)}` })
      .nullable()
      .optional(),
  ),
  maxContext: z.preprocess(
    (value) => (value === 0 || value === '' ? null : numericString(value)),
    z.number().int('maxContext must be a positive integer').positive('maxContext must be a positive integer').nullable().optional(),
  ),
  // The entity's bounds without its default — a default inside a preprocess
  // is invisible to `patchSchemaOf` and would be written on every update.
  // The create route supplies the default for an unsent value.
  maxImagesPerRequest: z.preprocess(numericString, entity.maxImagesPerRequest.unwrap().nullable().optional()),
  toolResultVerbatimTurns: z.preprocess(numericString, entity.toolResultVerbatimTurns.unwrap().nullable().optional()),
  sortIndex: z.number().int('sortIndex must be a non-negative integer').min(0, 'sortIndex must be a non-negative integer'),
});

/**
 * POST body. `name`, `provider` and `modelName` are required; everything else
 * takes the entity default (`sortIndex` is assigned by the route, so a sent
 * one is validated and ignored).
 */
export const ConnectionProfileCreateSchema = ConnectionProfileInputObject.partial({
  sortIndex: true,
  apiKeyId: true,
  baseUrl: true,
  fallbackProfileId: true,
  modelClass: true,
  maxContext: true,
  multiCharacterPrefill: true,
  supportsImageUpload: true,
}).strict();

/**
 * PUT body: any subset, nothing defaulted, so an absent key is left alone and
 * `null` clears a nullable column. `maxImagesPerRequest` and
 * `toolResultVerbatimTurns` are never cleared: `null` for them means "not
 * sent" (`withoutNullCounters`).
 */
export const ConnectionProfileUpdateSchema = patchSchemaOf(ConnectionProfileInputObject).strict();

/** Drop a `null` image cap or verbatim window: both columns always hold a number. */
export function withoutNullCounters<T extends { maxImagesPerRequest?: number | null; toolResultVerbatimTurns?: number | null }>(
  input: T,
): Omit<T, 'maxImagesPerRequest' | 'toolResultVerbatimTurns'> & { maxImagesPerRequest?: number; toolResultVerbatimTurns?: number } {
  const { maxImagesPerRequest, toolResultVerbatimTurns, ...rest } = input;
  return {
    ...rest,
    ...(maxImagesPerRequest != null ? { maxImagesPerRequest } : {}),
    ...(toolResultVerbatimTurns != null ? { toolResultVerbatimTurns } : {}),
  };
}

export type ConnectionProfileCreateInput = z.infer<typeof ConnectionProfileCreateSchema>;
export type ConnectionProfileUpdateInput = z.infer<typeof ConnectionProfileUpdateSchema>;

/** Fields a Courier profile never carries, and what they are forced to. */
export const COURIER_FORCED_FIELDS = {
  apiKeyId: null,
  baseUrl: null,
  allowToolUse: false,
  allowWebSearch: false,
  useNativeWebSearch: false,
  supportsImageUpload: false,
  isDangerousCompatible: false,
  pseudoToolMode: 'auto',
} as const satisfies Partial<ConnectionProfile>;

/**
 * A Courier request is carried by a human to an external LLM, which can reach
 * no key, URL, tool or image. Whatever the client sent, those fields are
 * forced off.
 */
export function applyCourierForcing<T extends Record<string, unknown>>(data: T, isCourier: boolean): T {
  if (!isCourier) return data;
  return { ...data, ...COURIER_FORCED_FIELDS };
}

/**
 * The checks that need the database: the named fallback (not the profile
 * itself, the user's own, not a Courier profile) and the API key (exists,
 * same provider). Returns the message for a 400, or `null` when the input is
 * sound. `profileId` is the row being updated (absent on create); `provider`
 * the profile's effective provider after this write.
 */
export async function checkConnectionProfileReferences(
  input: { fallbackProfileId?: string | null; apiKeyId?: string | null },
  ctx: Pick<RequestContext, 'repos' | 'user'>,
  options: { profileId?: string; provider: string; isCourier: boolean },
): Promise<{ status: 400 | 404; message: string } | null> {
  const { fallbackProfileId, apiKeyId } = input;

  // The fallback chain's named understudy. Two rules, both structural: a
  // profile cannot understudy itself (the chain would be one attempt wearing
  // two names), and a Courier profile cannot stand in for anyone (its
  // transport is a human carrying the request by hand, which is no kind of
  // automatic failover). A cycle A->B / B->A is legal; chains never recurse.
  if (fallbackProfileId) {
    if (options.profileId && fallbackProfileId === options.profileId) {
      return { status: 400, message: 'A connection profile cannot be its own fallback' };
    }
    const target = await ctx.repos.connections.findById(fallbackProfileId);
    if (!target || target.userId !== ctx.user.id) {
      return { status: 400, message: 'Fallback profile not found' };
    }
    if (target.transport === 'courier') {
      return {
        status: 400,
        message:
          'A Courier profile cannot be used as a fallback — its requests are carried by hand, so it cannot stand in automatically',
      };
    }
  }

  // Courier profiles never carry a key, so there is nothing to check.
  if (apiKeyId && !options.isCourier) {
    const apiKey = await ctx.repos.connections.findApiKeyById(apiKeyId);
    if (!apiKey) {
      return { status: 404, message: 'API key not found' };
    }
    if (apiKey.provider !== options.provider) {
      return { status: 400, message: 'API key provider does not match profile provider' };
    }
  }

  logger.debug('[Connection profile input] References checked', {
    profileId: options.profileId ?? null,
    hasFallback: Boolean(fallbackProfileId),
    hasApiKey: Boolean(apiKeyId),
  });
  return null;
}
