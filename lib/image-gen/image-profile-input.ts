/**
 * Image profiles — the request-body shapes both the create and the update
 * route validate with. The two used to check field by field, each with its own
 * copy of the LoRA-list rule; an empty `apiKeyId` on update was looked up as a
 * key and answered 404.
 *
 * Strict (an unknown key is a 400); the update is `patchSchemaOf`, so an absent
 * key is left alone and `null` clears a nullable one. Provider availability is
 * a plugin question and stays in the routes.
 *
 * @module image-gen/image-profile-input
 */

import { z } from 'zod';
import { ImageProfileSchema } from '@/lib/schemas/profile.types';
import { patchSchemaOf } from '@/lib/schemas/patch-schema';
import { profileIdentityInputShape } from '@/lib/schemas/profile-input';
import { validateProfileLoras } from '@/lib/image-gen/lora-validation';

/**
 * `parameters` is free-form per provider except for the reserved `loras` key,
 * which must be a well-formed adapter list before anything is written — a
 * malformed one would save cleanly and fail at generation.
 */
const imageParametersInput = ImageProfileSchema.shape.parameters.superRefine((parameters, ctx) => {
  const loraError = validateProfileLoras(parameters);
  for (const issue of loraError?.issues ?? []) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: ['loras', ...issue.path] });
  }
});

const ImageProfileInputObject = ImageProfileSchema.pick({
  isDefault: true,
  isDangerousCompatible: true,
}).extend({
  ...profileIdentityInputShape,
  parameters: imageParametersInput,
});

/** POST body: `name`, `provider` and `modelName` required; the rest take the entity defaults. */
export const ImageProfileCreateSchema = ImageProfileInputObject.strict();

/** PUT body: any subset, nothing defaulted. */
export const ImageProfileUpdateSchema = patchSchemaOf(ImageProfileInputObject).strict();

export type ImageProfileCreateInput = z.infer<typeof ImageProfileCreateSchema>;
export type ImageProfileUpdateInput = z.infer<typeof ImageProfileUpdateSchema>;
