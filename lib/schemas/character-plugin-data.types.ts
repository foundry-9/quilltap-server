/**
 * Character Plugin Data Type Definitions
 *
 * Contains schemas for per-character, per-plugin metadata storage.
 * Each plugin can store arbitrary JSON data associated with a character.
 * Quilltap only enforces that the data field is valid JSON.
 *
 * @module schemas/character-plugin-data.types
 */

import { z } from 'zod';
import { UUIDSchema, TimestampSchema } from './common.types';

// ============================================================================
// CHARACTER PLUGIN DATA
// ============================================================================

/**
 * Schema for a single character plugin data entry.
 * Stores arbitrary JSON metadata for a specific plugin on a specific character.
 */
export const CharacterPluginDataSchema = z.object({
  /** Unique ID for this entry */
  id: UUIDSchema,

  /** Character this data belongs to */
  characterId: UUIDSchema,

  /** Plugin name (e.g., "qtap-plugin-curl") */
  pluginName: z.string().min(1).max(200),

  /** Arbitrary JSON data — any valid JSON value */
  data: z.unknown(),

  /** ISO-8601 timestamp when this entry was created */
  createdAt: TimestampSchema,

  /** ISO-8601 timestamp when this entry was last updated */
  updatedAt: TimestampSchema,
});

export type CharacterPluginData = z.infer<typeof CharacterPluginDataSchema>;

/**
 * Schema for creating or updating character plugin data.
 * Does not include id, createdAt, updatedAt which are managed by the repository.
 */
export const CharacterPluginDataInputSchema = CharacterPluginDataSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CharacterPluginDataInput = z.infer<typeof CharacterPluginDataInputSchema>;
