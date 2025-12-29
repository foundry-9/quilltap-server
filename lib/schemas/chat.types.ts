/**
 * Chat Type Definitions
 *
 * Contains schemas for chat messages, events, participants,
 * and chat metadata.
 *
 * @module schemas/chat.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
  RoleEnum,
} from './common.types';
import { TimestampConfigSchema } from './settings.types';

// ============================================================================
// MESSAGE EVENTS
// ============================================================================

export const MessageEventSchema = z.object({
  type: z.literal('message'),
  id: UUIDSchema,
  role: RoleEnum,
  content: z.string(),
  rawResponse: JsonSchema.nullable().optional(),
  tokenCount: z.number().nullable().optional(),
  swipeGroupId: z.string().nullable().optional(),
  swipeIndex: z.number().nullable().optional(),
  attachments: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  // Debug: Memory extraction logs (Sprint 6)
  debugMemoryLogs: z.array(z.string()).optional(),
  // Google Gemini thought signature for thinking models (e.g., gemini-3-pro)
  // Must be preserved and passed back for multi-turn conversations with function calling
  thoughtSignature: z.string().nullable().optional(),
  // Multi-character chat: which participant sent this message
  participantId: UUIDSchema.nullable().optional(),
});

export type MessageEvent = z.infer<typeof MessageEventSchema>;

export const ContextSummaryEventSchema = z.object({
  type: z.literal('context-summary'),
  id: UUIDSchema,
  context: z.string(),
  createdAt: TimestampSchema,
});

export type ContextSummaryEvent = z.infer<typeof ContextSummaryEventSchema>;

export const ChatEventSchema = z.union([
  MessageEventSchema,
  ContextSummaryEventSchema,
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;

// ============================================================================
// CHAT PARTICIPANTS
// ============================================================================

export const ParticipantTypeEnum = z.enum(['CHARACTER', 'PERSONA']);
export type ParticipantType = z.infer<typeof ParticipantTypeEnum>;

export const ChatParticipantSchema = z.object({
  id: UUIDSchema,

  // Participant type and identity
  type: ParticipantTypeEnum,
  characterId: UUIDSchema.nullable().optional(),  // Set when type is CHARACTER
  personaId: UUIDSchema.nullable().optional(),    // Set when type is PERSONA

  // LLM configuration (for AI characters only)
  connectionProfileId: UUIDSchema.nullable().optional(),  // Required for CHARACTER, null for PERSONA
  imageProfileId: UUIDSchema.nullable().optional(),       // Image generation profile
  roleplayTemplateId: z.string().nullable().optional(),   // Roleplay template override - can be UUID or 'plugin:*' format

  // Per-chat customization
  systemPromptOverride: z.string().nullable().optional(),  // Custom scenario/context for this chat
  selectedSystemPromptId: UUIDSchema.nullable().optional(),  // Selected system prompt from character's prompts array

  // Display and state
  displayOrder: z.number().default(0),   // For ordering in UI
  isActive: z.boolean().default(true),   // Temporarily disable without removing

  // Multi-character chat fields
  hasHistoryAccess: z.boolean().default(false),  // Whether this participant can see messages from before they joined
  joinScenario: z.string().nullable().optional(), // Custom scenario text for how they joined the chat

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => {
    // Must have characterId if type is CHARACTER
    if (data.type === 'CHARACTER') {
      return data.characterId != null;
    }
    // Must have personaId if type is PERSONA
    if (data.type === 'PERSONA') {
      return data.personaId != null;
    }
    return false;
  },
  { message: 'CHARACTER participants must have characterId, PERSONA participants must have personaId' }
);

export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;

// Schema without refinements for internal use (e.g., parsing before validation)
export const ChatParticipantBaseSchema = z.object({
  id: UUIDSchema,
  type: ParticipantTypeEnum,
  characterId: UUIDSchema.nullable().optional(),
  personaId: UUIDSchema.nullable().optional(),
  connectionProfileId: UUIDSchema.nullable().optional(),
  imageProfileId: UUIDSchema.nullable().optional(),
  roleplayTemplateId: z.string().nullable().optional(),  // Roleplay template override - can be UUID or 'plugin:*' format
  systemPromptOverride: z.string().nullable().optional(),
  selectedSystemPromptId: UUIDSchema.nullable().optional(),  // Selected system prompt from character's prompts array
  displayOrder: z.number().default(0),
  isActive: z.boolean().default(true),
  hasHistoryAccess: z.boolean().default(false),
  joinScenario: z.string().nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatParticipantBase = z.infer<typeof ChatParticipantBaseSchema>;

// Input type for creating chat participants - makes fields with defaults optional
export type ChatParticipantBaseInput = z.input<typeof ChatParticipantBaseSchema>;

// ============================================================================
// CHAT METADATA
// ============================================================================

export const ChatMetadataSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,

  // Participants array (replaces characterId, personaId, connectionProfileId, imageProfileId)
  participants: z.array(ChatParticipantBaseSchema).default([]),

  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  /** Roleplay template for this chat - can be UUID or 'plugin:*' format */
  roleplayTemplateId: z.string().nullable().optional(),
  /** Timestamp configuration for this chat (overrides user default) */
  timestampConfig: TimestampConfigSchema.nullable().optional(),
  /** Last participant whose turn it was (null = user's turn). Used to restore turn state when returning to chat. */
  lastTurnParticipantId: UUIDSchema.nullable().optional(),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: z.number().default(0),
  /** Whether auto-responses are paused in multi-character chats */
  isPaused: z.boolean().default(false),
  /** Whether the user has manually renamed this chat (disables auto-renaming) */
  isManuallyRenamed: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => data.participants.length > 0,
  { message: 'Chat must have at least one participant' }
);

export type ChatMetadata = z.infer<typeof ChatMetadataSchema>;

// Schema without participant validation for migration/backwards compatibility
export const ChatMetadataBaseSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  participants: z.array(ChatParticipantBaseSchema).default([]),
  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  /** Roleplay template for this chat - can be UUID or 'plugin:*' format */
  roleplayTemplateId: z.string().nullable().optional(),
  /** Timestamp configuration for this chat (overrides user default) */
  timestampConfig: TimestampConfigSchema.nullable().optional(),
  /** Last participant whose turn it was (null = user's turn). Used to restore turn state when returning to chat. */
  lastTurnParticipantId: UUIDSchema.nullable().optional(),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: z.number().default(0),
  /** Whether auto-responses are paused in multi-character chats */
  isPaused: z.boolean().default(false),
  /** Whether the user has manually renamed this chat (disables auto-renaming) */
  isManuallyRenamed: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatMetadataBase = z.infer<typeof ChatMetadataBaseSchema>;

// Input type for creating chats - makes fields with defaults optional
export type ChatMetadataInput = z.input<typeof ChatMetadataBaseSchema>;

// ============================================================================
// LEGACY CHAT METADATA (for migration)
// ============================================================================

// Legacy schema for migration (matches old format)
export const ChatMetadataLegacySchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  characterId: UUIDSchema,
  personaId: UUIDSchema.nullable().optional(),
  connectionProfileId: UUIDSchema,
  imageProfileId: UUIDSchema.nullable().optional(),
  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: z.number().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatMetadataLegacy = z.infer<typeof ChatMetadataLegacySchema>;
