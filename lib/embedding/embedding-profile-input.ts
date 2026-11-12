/**
 * Embedding profiles — the request-body shapes both the create and the update
 * route validate with. The two used to check field by field; `provider` was
 * cast to the enum rather than checked against it.
 *
 * Strict (an unknown key is a 400); the update is `patchSchemaOf`, so an absent
 * key is left alone and `null` clears a nullable one.
 *
 * @module embedding/embedding-profile-input
 */

import { z } from 'zod';
import { EmbeddingProfileSchema } from '@/lib/schemas/profile.types';
import { EmbeddingProfileProviderEnum } from '@/lib/schemas/common.types';
import { patchSchemaOf } from '@/lib/schemas/patch-schema';
import { profileIdentityInputShape } from '@/lib/schemas/profile-input';

const EmbeddingProfileInputObject = EmbeddingProfileSchema.pick({
  normalizeL2: true,
  isDefault: true,
}).extend({
  ...profileIdentityInputShape,
  provider: EmbeddingProfileProviderEnum,
  dimensions: z.number().positive('Dimensions must be a positive number').nullable().optional(),
  truncateToDimensions: z
    .number()
    .int('truncateToDimensions must be a positive integer')
    .positive('truncateToDimensions must be a positive integer')
    .nullable()
    .optional(),
});

/** POST body: `name`, `provider` and `modelName` required; the rest take the entity defaults. */
export const EmbeddingProfileCreateSchema = EmbeddingProfileInputObject.strict();

/** PUT body: any subset, nothing defaulted. */
export const EmbeddingProfileUpdateSchema = patchSchemaOf(EmbeddingProfileInputObject).strict();

/**
 * POST `?action=test` body: the fields that decide whether an embedding call
 * can succeed, for a profile not yet saved (the setup wizard's Test All).
 */
export const EmbeddingProfileTestSchema = EmbeddingProfileInputObject.pick({
  provider: true,
  modelName: true,
  apiKeyId: true,
  baseUrl: true,
  dimensions: true,
}).strict();

export type EmbeddingProfileCreateInput = z.infer<typeof EmbeddingProfileCreateSchema>;
export type EmbeddingProfileUpdateInput = z.infer<typeof EmbeddingProfileUpdateSchema>;
export type EmbeddingProfileTestInput = z.infer<typeof EmbeddingProfileTestSchema>;
