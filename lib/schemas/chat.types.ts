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
import { ControlledByEnum } from './character.types';

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
  /** Input/prompt tokens for this message */
  promptTokens: z.number().nullable().optional(),
  /** Output/completion tokens for this message */
  completionTokens: z.number().nullable().optional(),
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
  // Recovery type: indicates this message was generated as an error recovery response
  // 'token_limit' = LLM-generated recovery response for token limit errors
  // 'token_limit_static' = Static fallback message when LLM recovery also failed
  // 'content_limit' = LLM-generated recovery response for content limit errors (PDF pages, etc.)
  // 'content_limit_static' = Static fallback message when LLM recovery for content limit also failed
  recoveryType: z.enum(['token_limit', 'token_limit_static', 'content_limit', 'content_limit_static']).nullable().optional(),
});

export type MessageEvent = z.infer<typeof MessageEventSchema>;

export const ContextSummaryEventSchema = z.object({
  type: z.literal('context-summary'),
  id: UUIDSchema,
  context: z.string(),
  createdAt: TimestampSchema,
});

export type ContextSummaryEvent = z.infer<typeof ContextSummaryEventSchema>;

// ============================================================================
// SYSTEM EVENTS (Cheap LLM Operations)
// ============================================================================

export const SystemEventTypeEnum = z.enum([
  'MEMORY_EXTRACTION',
  'SUMMARIZATION',
  'TITLE_GENERATION',
  'CONTEXT_SUMMARY',
  'IMAGE_PROMPT_CRAFTING',
  'CONTEXT_COMPRESSION',
]);

export type SystemEventType = z.infer<typeof SystemEventTypeEnum>;

export const SystemEventSchema = z.object({
  type: z.literal('system'),
  id: UUIDSchema,
  /** Type of system operation */
  systemEventType: SystemEventTypeEnum,
  /** Human-readable description of what the system did */
  description: z.string(),
  /** Input/prompt tokens used for this operation */
  promptTokens: z.number().nullable().optional(),
  /** Output/completion tokens used for this operation */
  completionTokens: z.number().nullable().optional(),
  /** Total tokens used (promptTokens + completionTokens) */
  totalTokens: z.number().nullable().optional(),
  /** Provider used for this operation */
  provider: z.string().nullable().optional(),
  /** Model name used for this operation */
  modelName: z.string().nullable().optional(),
  /** Estimated cost in USD for this operation */
  estimatedCostUSD: z.number().nullable().optional(),
  createdAt: TimestampSchema,
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;

export const ChatEventSchema = z.union([
  MessageEventSchema,
  ContextSummaryEventSchema,
  SystemEventSchema,
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;

// ============================================================================
// CHAT PARTICIPANTS
// ============================================================================

export const ParticipantTypeEnum = z.enum(['CHARACTER']);
export type ParticipantType = z.infer<typeof ParticipantTypeEnum>;

export const ChatParticipantSchema = z.object({
  id: UUIDSchema,

  // Participant type and identity
  type: ParticipantTypeEnum,
  characterId: UUIDSchema,  // Required for all participants

  // Control mode - who controls this participant in this chat
  // 'llm' = AI-controlled, 'user' = player-controlled (impersonating)
  // Optional for backwards compatibility - defaults to 'llm' for existing participants
  controlledBy: ControlledByEnum.optional().default('llm'),

  // LLM configuration (for AI characters only, ignored when controlledBy is 'user')
  connectionProfileId: UUIDSchema.nullable().optional(),  // Required for LLM control, null for user control
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
  (data) => data.characterId != null,
  {
      error: 'Participants must have characterId'
}
);

export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;

// Schema without refinements for internal use (e.g., parsing before validation)
export const ChatParticipantBaseSchema = z.object({
  id: UUIDSchema,
  type: ParticipantTypeEnum,
  characterId: UUIDSchema,
  controlledBy: ControlledByEnum.optional().default('llm'),  // Who controls: 'llm' or 'user'
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

  // Impersonation state - for when user temporarily takes control of characters
  /** Array of participant IDs the user is currently impersonating (can be multiple) */
  impersonatingParticipantIds: z.array(UUIDSchema).default([]),
  /** Which impersonated participant is currently "active" for typing (user switches between controlled characters) */
  activeTypingParticipantId: UUIDSchema.nullable().optional(),
  /** Turns since last user input or pause (for all-LLM pause logic) */
  allLLMPauseTurnCount: z.number().default(0),

  /** Whether document editing mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode: z.boolean().default(false),

  /** Project this chat belongs to (optional) */
  projectId: UUIDSchema.nullable().optional(),

  // Token usage tracking (aggregate totals for this chat)
  /** Total prompt/input tokens used in this chat */
  totalPromptTokens: z.number().default(0),
  /** Total completion/output tokens used in this chat */
  totalCompletionTokens: z.number().default(0),
  /** Estimated total cost in USD for this chat */
  estimatedCostUSD: z.number().nullable().optional(),
  /** Source of pricing data for cost estimate */
  priceSource: z.enum(['openrouter', 'registry', 'fallback', 'openrouter-estimate', 'unavailable']).nullable().optional(),
  /** Per-chat override for showing system events (null = use global setting) */
  showSystemEventsOverride: z.boolean().nullable().optional(),

  /** Flag set when AI calls request_full_context tool - bypasses compression on next message */
  requestFullContextOnNextMessage: z.boolean().default(false),

  /** List of tool IDs that are disabled for this chat (empty = all enabled) */
  disabledTools: z.array(z.string()).default([]),

  /** Groups of tools that are disabled (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem") */
  disabledToolGroups: z.array(z.string()).default([]),

  /** Force tools to be sent with next message (set when tool settings change) */
  forceToolsOnNextMessage: z.boolean().default(false),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => data.participants.length > 0,
  {
      error: 'Chat must have at least one participant'
}
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
  // Impersonation state
  impersonatingParticipantIds: z.array(UUIDSchema).default([]),
  activeTypingParticipantId: UUIDSchema.nullable().optional(),
  allLLMPauseTurnCount: z.number().default(0),
  /** Whether document editing mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode: z.boolean().default(false),

  /** Project this chat belongs to (optional) */
  projectId: UUIDSchema.nullable().optional(),

  // Token usage tracking (aggregate totals for this chat)
  /** Total prompt/input tokens used in this chat */
  totalPromptTokens: z.number().default(0),
  /** Total completion/output tokens used in this chat */
  totalCompletionTokens: z.number().default(0),
  /** Estimated total cost in USD for this chat */
  estimatedCostUSD: z.number().nullable().optional(),
  /** Source of pricing data for cost estimate */
  priceSource: z.enum(['openrouter', 'registry', 'fallback', 'openrouter-estimate', 'unavailable']).nullable().optional(),
  /** Per-chat override for showing system events (null = use global setting) */
  showSystemEventsOverride: z.boolean().nullable().optional(),

  /** Flag set when AI calls request_full_context tool - bypasses compression on next message */
  requestFullContextOnNextMessage: z.boolean().default(false),

  /** List of tool IDs that are disabled for this chat (empty = all enabled) */
  disabledTools: z.array(z.string()).default([]),

  /** Groups of tools that are disabled (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem") */
  disabledToolGroups: z.array(z.string()).default([]),

  /** Force tools to be sent with next message (set when tool settings change) */
  forceToolsOnNextMessage: z.boolean().default(false),

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
