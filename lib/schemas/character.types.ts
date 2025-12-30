/**
 * Character Type Definitions
 *
 * Contains schemas for characters, character system prompts,
 * and physical descriptions used for image generation.
 *
 * @module schemas/character.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
} from './common.types';

// ============================================================================
// CHARACTER SYSTEM PROMPTS
// ============================================================================

// Character System Prompt (embedded in Character) - named system prompts for characters
export const CharacterSystemPromptSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type CharacterSystemPrompt = z.infer<typeof CharacterSystemPromptSchema>;

// ============================================================================
// PHYSICAL DESCRIPTIONS
// ============================================================================

// Physical Description for image generation prompts
export const PhysicalDescriptionSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),
  shortPrompt: z.string().max(350).nullable().optional(),
  mediumPrompt: z.string().max(500).nullable().optional(),
  longPrompt: z.string().max(750).nullable().optional(),
  completePrompt: z.string().max(1000).nullable().optional(),
  fullDescription: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type PhysicalDescription = z.infer<typeof PhysicalDescriptionSchema>;

// ============================================================================
// CHARACTER
// ============================================================================

// Control mode for characters
export const ControlledByEnum = z.enum(['llm', 'user']);
export type ControlledBy = z.infer<typeof ControlledByEnum>;

export const CharacterSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  scenario: z.string().nullable().optional(),
  firstMessage: z.string().nullable().optional(),
  exampleDialogues: z.string().nullable().optional(),
  systemPrompts: z.array(CharacterSystemPromptSchema).default([]),  // Named system prompts array
  avatarUrl: z.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  defaultConnectionProfileId: UUIDSchema.nullable().optional(),
  defaultPartnerId: UUIDSchema.nullable().optional(),  // Default user-controlled character to pair with when chatting
  defaultRoleplayTemplateId: UUIDSchema.nullable().optional(),  // Default roleplay template for this character
  sillyTavernData: JsonSchema.nullable().optional(),
  isFavorite: z.boolean().default(false),
  npc: z.boolean().default(false),  // NPC flag - true for ad-hoc NPCs created in chat
  talkativeness: z.number().min(0.1).max(1.0).default(0.5),
  controlledBy: ControlledByEnum.default('llm'),  // Who controls this character: 'llm' (AI) or 'user' (player)

  // Relationships
  personaLinks: z.array(z.object({
    personaId: UUIDSchema,
    isDefault: z.boolean(),
  })).default([]),
  tags: z.array(UUIDSchema).default([]),
  avatarOverrides: z.array(z.object({
    chatId: UUIDSchema,
    imageId: UUIDSchema,
  })).default([]),
  physicalDescriptions: z.array(PhysicalDescriptionSchema).default([]),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Character = z.infer<typeof CharacterSchema>;

// Input type for creating characters - makes fields with defaults optional
export type CharacterInput = z.input<typeof CharacterSchema>;
