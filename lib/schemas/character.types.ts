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
import { TimestampConfigSchema } from './settings.types';

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
// CHARACTER SCENARIOS
// ============================================================================

// Character Scenario (embedded in Character) - named scenarios for roleplay context
export const CharacterScenarioSchema = z.object({
  id: UUIDSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type CharacterScenario = z.infer<typeof CharacterScenarioSchema>;

// ============================================================================
// PHYSICAL DESCRIPTIONS
// ============================================================================

// Physical Description for image generation prompts
export const PhysicalDescriptionSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),
  usageContext: z.string().max(200).nullable().optional(),
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
// CLOTHING RECORDS
// ============================================================================

// Clothing Record for outfit descriptions
export const ClothingRecordSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),
  usageContext: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ClothingRecord = z.infer<typeof ClothingRecordSchema>;

// ============================================================================
// CHARACTER PRONOUNS
// ============================================================================

export const PronounsSchema = z.object({
  subject: z.string().min(1).max(20),
  object: z.string().min(1).max(20),
  possessive: z.string().min(1).max(20),
});

export type Pronouns = z.infer<typeof PronounsSchema>;

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
  scenarios: z.array(CharacterScenarioSchema).default([]),  // Named scenarios array
  firstMessage: z.string().nullable().optional(),
  exampleDialogues: z.string().nullable().optional(),
  systemPrompts: z.array(CharacterSystemPromptSchema).default([]),  // Named system prompts array
  avatarUrl: z.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  defaultConnectionProfileId: UUIDSchema.nullable().optional(),
  defaultPartnerId: UUIDSchema.nullable().optional(),  // Default user-controlled character to pair with when chatting
  defaultRoleplayTemplateId: UUIDSchema.nullable().optional(),  // Default roleplay template for this character
  defaultImageProfileId: UUIDSchema.nullable().optional(),  // Default image generation profile for this character
  sillyTavernData: JsonSchema.nullable().optional(),
  isFavorite: z.boolean().default(false),
  npc: z.boolean().default(false),  // NPC flag - true for ad-hoc NPCs created in chat
  talkativeness: z.number().min(0.1).max(1.0).default(0.5),
  controlledBy: ControlledByEnum.default('llm'),  // Who controls this character: 'llm' (AI) or 'user' (player)

  /** Default agent mode enabled state for chats with this character (null = inherit from global) */
  defaultAgentModeEnabled: z.boolean().nullable().optional(),

  /** Default help tools enabled state for chats with this character (null = inherit from global, default disabled) */
  defaultHelpToolsEnabled: z.boolean().nullable().optional(),

  /** Default timestamp configuration for chats with this character (null = use global default / disabled) */
  defaultTimestampConfig: TimestampConfigSchema.nullable().optional(),

  /** Default scenario ID for chats with this character (null = no default scenario) */
  defaultScenarioId: UUIDSchema.nullable().optional(),

  /** Default system prompt ID for chats with this character (null = use first/isDefault prompt) */
  defaultSystemPromptId: UUIDSchema.nullable().optional(),

  // Relationships
  personaLinks: z.array(z.object({
    personaId: UUIDSchema,
    isDefault: z.boolean(),
  })).default([]),
  aliases: z.array(z.string()).default([]),
  pronouns: PronounsSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  avatarOverrides: z.array(z.object({
    chatId: UUIDSchema,
    imageId: UUIDSchema,
  })).default([]),
  physicalDescriptions: z.array(PhysicalDescriptionSchema).default([]),
  clothingRecords: z.array(ClothingRecordSchema).default([]),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Character = z.infer<typeof CharacterSchema>;

// Input type for creating characters - makes fields with defaults optional
export type CharacterInput = z.input<typeof CharacterSchema>;
