/**
 * Persona Type Definitions
 *
 * Contains the persona schema for user-defined personas that
 * can interact with characters.
 *
 * @module schemas/persona.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
} from './common.types';
import { PhysicalDescriptionSchema } from './character.types';

// ============================================================================
// PERSONA
// ============================================================================

export const PersonaSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string(),
  personalityTraits: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  sillyTavernData: JsonSchema.nullable().optional(),

  // Relationships
  characterLinks: z.array(UUIDSchema).default([]),
  tags: z.array(UUIDSchema).default([]),
  physicalDescriptions: z.array(PhysicalDescriptionSchema).default([]),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Persona = z.infer<typeof PersonaSchema>;
