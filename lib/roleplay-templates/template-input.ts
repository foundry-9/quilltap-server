/**
 * Roleplay templates — the request-body shapes for create and update.
 *
 * The create route checked each field by hand and validated the formatting
 * fields one `safeParse` at a time; the update route had its own schema. Both
 * now derive from one input object: create requires `name`, `systemPrompt` and
 * `narrationDelimiters` (an explicit `null` means narration is unmarked
 * prose), update takes any subset (`patchSchemaOf`). Both are strict.
 *
 * @module roleplay-templates/template-input
 */

import { z } from 'zod';
import { patchSchemaOf } from '@/lib/schemas/patch-schema';
import {
  NarrationDelimitersSchema,
  StrictDialogueDetectionSchema,
  StrictRenderingPatternSchema,
  TemplateDelimiterSchema,
  UnmarkedStyleSchema,
} from '@/lib/schemas/template.types';

const RoleplayTemplateInputObject = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  /** Blank means none. */
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or less')
    .transform((v) => (v.length > 0 ? v : null))
    .nullable()
    .optional(),
  systemPrompt: z.string().trim().min(1, 'System prompt is required'),
  tags: z.array(z.uuid()),
  delimiters: z.array(TemplateDelimiterSchema),
  renderingPatterns: z.array(StrictRenderingPatternSchema),
  dialogueDetection: StrictDialogueDetectionSchema.nullable().optional(),
  /** `null` = narration is unmarked plain prose. */
  narrationDelimiters: NarrationDelimitersSchema.nullable(),
  unmarkedStyle: UnmarkedStyleSchema.nullable().optional(),
  markdownAsterisks: z.boolean(),
});

/** POST body. Tags are attached afterwards through the tag actions, so a sent list is refused. */
export const RoleplayTemplateCreateSchema = RoleplayTemplateInputObject.omit({ tags: true })
  .partial({ delimiters: true, renderingPatterns: true, markdownAsterisks: true })
  .extend({
    narrationDelimiters: z.union([NarrationDelimitersSchema, z.null()], {
      error: 'Narration delimiters are required (null for unmarked prose)',
    }),
  })
  .strict();

/** PUT body: any subset. */
export const RoleplayTemplateUpdateSchema = patchSchemaOf(RoleplayTemplateInputObject).strict();

export type RoleplayTemplateCreateInput = z.infer<typeof RoleplayTemplateCreateSchema>;
export type RoleplayTemplateUpdateInput = z.infer<typeof RoleplayTemplateUpdateSchema>;
