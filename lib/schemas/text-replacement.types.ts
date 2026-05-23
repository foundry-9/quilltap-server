/**
 * Text Replacement Type Definitions
 *
 * Schemas and types for the Lexical text-replacement feature (Layer 1.5 of
 * the composer spellcheck/autocorrect plan). Pure word-boundary replacements:
 * literal `from` → literal `to`, fired only on typed input.
 *
 * @module schemas/text-replacement.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// DATABASE SCHEMA
// ============================================================================

/**
 * A single text-replacement rule as stored in the database.
 */
export const TextReplacementRuleSchema = z.object({
  id: UUIDSchema,
  fromText: z
    .string()
    .min(1)
    .max(100)
    .refine((v) => v === v.trim(), {
      message: 'fromText cannot have leading or trailing whitespace',
    }),
  toText: z.string().min(1).max(1000),
  caseSensitive: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type TextReplacementRule = z.infer<typeof TextReplacementRuleSchema>;

// ============================================================================
// API INPUT SHAPES
// ============================================================================

/**
 * Shape accepted by `POST /api/v1/settings/text-replacements` for creating a
 * new rule. `caseSensitive`, `enabled`, and `sortOrder` default to sensible
 * values so the simplest payload is `{ fromText, toText }`.
 */
export const TextReplacementRuleInputSchema = z.object({
  fromText: z
    .string()
    .min(1)
    .max(100)
    .refine((v) => v === v.trim(), {
      message: 'fromText cannot have leading or trailing whitespace',
    }),
  toText: z.string().min(1).max(1000),
  caseSensitive: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type TextReplacementRuleInput = z.infer<typeof TextReplacementRuleInputSchema>;

/**
 * Shape accepted by `PATCH /api/v1/settings/text-replacements/[id]`. All
 * fields optional; only the supplied ones are written.
 */
export const TextReplacementRulePatchSchema = TextReplacementRuleInputSchema.partial();

export type TextReplacementRulePatch = z.infer<typeof TextReplacementRulePatchSchema>;
