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
// DANGER FLAGS
// ============================================================================

export const DangerFlagSchema = z.object({
  /** Category of dangerous content detected (e.g., 'nsfw', 'violence', 'hate_speech') */
  category: z.string(),
  /** Confidence score from 0 to 1 */
  score: z.number().min(0).max(1),
  /** Whether the user has manually overridden this flag (marked as not dangerous) */
  userOverridden: z.boolean().default(false),
  /** Whether the message was rerouted to an uncensored provider */
  wasRerouted: z.boolean().default(false),
  /** Provider name if rerouted */
  reroutedProvider: z.string().nullable().optional(),
  /** Model name if rerouted */
  reroutedModel: z.string().nullable().optional(),
});

export type DangerFlag = z.infer<typeof DangerFlagSchema>;

// ============================================================================
// SCENE STATE
// ============================================================================

export const SceneStateCharacterSchema = z.object({
  characterId: z.string(),
  characterName: z.string(),
  action: z.string(),
  appearance: z.string().nullable(),
  clothing: z.string().nullable(),
});

export type SceneStateCharacter = z.infer<typeof SceneStateCharacterSchema>;

export const SceneStateSchema = z.object({
  location: z.string(),
  characters: z.array(SceneStateCharacterSchema),
  updatedAt: TimestampSchema,
  updatedAtMessageCount: z.number(),
});

export type SceneState = z.infer<typeof SceneStateSchema>;

// ============================================================================
// CHAT TYPE
// ============================================================================

export const ChatTypeEnum = z.enum(['salon', 'help']);
export type ChatType = z.infer<typeof ChatTypeEnum>;

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
  debugMemoryLogs: z.array(z.string()).nullable().optional(),
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
  // Server-side pre-rendered HTML for simple messages (no tools, no attachments)
  // Used to avoid client-side markdown processing overhead on chat load
  renderedHtml: z.string().nullable().optional(),
  // Danger content flags from gatekeeper classification
  dangerFlags: z.array(DangerFlagSchema).nullable().optional(),
  /** Provider that generated this message (e.g., 'openai', 'anthropic') */
  provider: z.string().nullable().optional(),
  /** Model name that generated this message (e.g., 'gpt-4o', 'claude-sonnet-4-20250514') */
  modelName: z.string().nullable().optional(),
  /** Target participant IDs for whisper messages (null = public message, array = private to sender and targets) */
  targetParticipantIds: z.array(UUIDSchema).nullable().optional(),
  /** Whether this message was generated while the character was in silent mode */
  isSilentMessage: z.boolean().nullable().optional(),
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
  'DANGER_CLASSIFICATION',
  'SCENE_STATE_TRACKING',
  'STATUS_CHANGE',
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

// ============================================================================
// PARTICIPANT STATUS
// ============================================================================

/**
 * Four-state participation model for characters in a chat:
 * - active: Present and participating normally (speaks and roleplays)
 * - silent: Gets turns, but must not speak aloud. May have inner thoughts,
 *           physical reactions, and actions — but no audible dialogue.
 * - absent: Turn manager skips them. Still "in" the chat but away from the scene.
 * - removed: No longer part of the chat. Cannot be whispered to, unaware of
 *            events after leaving.
 */
export const ParticipantStatusEnum = z.enum(['active', 'silent', 'absent', 'removed']);
export type ParticipantStatus = z.infer<typeof ParticipantStatusEnum>;

/**
 * Check if a participant is present in the scene (active or silent).
 * Both states participate in turns and can perceive what happens.
 */
export function isParticipantPresent(status: ParticipantStatus): boolean {
  return status === 'active' || status === 'silent';
}

/**
 * Check if a participant can receive whispers (must be present).
 */
export function canReceiveWhisper(status: ParticipantStatus): boolean {
  return status === 'active' || status === 'silent';
}

/**
 * Convert legacy isActive/removedAt to the new status enum.
 * Used during migration and for backward compatibility.
 */
export function migrateIsActiveToStatus(isActive: boolean, removedAt?: string | null): ParticipantStatus {
  if (isActive) return 'active';
  if (removedAt) return 'removed';
  return 'absent';
}

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
  roleplayTemplateId: z.string().nullable().optional(),   // Roleplay template override

  // Per-chat customization
  selectedSystemPromptId: UUIDSchema.nullable().optional(),  // Selected system prompt from character's prompts array

  // Display and state
  displayOrder: z.number().default(0),   // For ordering in UI
  /** @deprecated Use `status` field instead. Kept as computed compat field (true when status is active or silent). */
  isActive: z.boolean().default(true),
  /** Participation status: active, silent, absent, or removed */
  status: ParticipantStatusEnum.default('active'),
  removedAt: TimestampSchema.nullable().optional(),  // Soft-delete timestamp — set when participant is removed from chat

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
  roleplayTemplateId: z.string().nullable().optional(),  // Roleplay template override
  selectedSystemPromptId: UUIDSchema.nullable().optional(),  // Selected system prompt from character's prompts array
  displayOrder: z.number().default(0),
  /** @deprecated Use `status` field instead. Kept as computed compat field (true when status is active or silent). */
  isActive: z.boolean().default(true),
  /** Participation status: active, silent, absent, or removed */
  status: ParticipantStatusEnum.default('active'),
  removedAt: TimestampSchema.nullable().optional(),  // Soft-delete timestamp
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
  /** Server-side turn queue for chained responses (JSON array of participant IDs) */
  turnQueue: z.string().default('[]'),

  /** Whether composition mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode: z.boolean().default(false),

  /** Document Mode layout state: normal (chat only), split (chat + document), focus (document only) */
  documentMode: z.enum(['normal', 'split', 'focus']).default('normal'),

  /** Divider position for split mode as percentage of main area width (20-80) */
  dividerPosition: z.number().min(20).max(80).default(45),

  /** Project this chat belongs to (optional) */
  projectId: UUIDSchema.nullable().optional(),

  /** Resolved scenario text selected at chat creation (preset or custom) */
  scenarioText: z.string().nullable().optional(),

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

  /** Flag to trigger tool change notification on next message (set when tool settings change) */
  forceToolsOnNextMessage: z.boolean().default(false),

  /** Pending outfit change notifications keyed by characterId, cleared after delivery */
  pendingOutfitNotifications: JsonSchema.nullable().optional(),

  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  /** Cached compression result for context compression (persisted across restarts) */
  compressionCache: JsonSchema.nullable().optional(),

  /** Whether agent mode is enabled for this chat (null = inherit from project/character/global) */
  agentModeEnabled: z.boolean().nullable().optional(),

  /** Current agent turn count within the current message processing (resets on new user message) */
  agentTurnCount: z.number().default(0),

  /** Story background image file ID (from file system) */
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  /** When the story background was last generated */
  lastBackgroundGeneratedAt: TimestampSchema.nullable().optional(),

  /** Image generation profile for this chat (shared by all participants) */
  imageProfileId: UUIDSchema.nullable().optional(),

  /** When an image is generated in this chat, inject an assistant message announcing it (null = inherit from project/global) */
  alertCharactersOfLanternImages: z.boolean().nullable().optional(),

  /** Whether this chat has been classified as dangerous (null = not yet classified) */
  isDangerousChat: z.boolean().nullable().optional(),
  /** Overall danger score for this chat (0-1), null = not yet classified */
  dangerScore: z.number().min(0).max(1).nullable().optional(),
  /** Categories of dangerous content detected at chat level (JSON array of strings) */
  dangerCategories: z.array(z.string()).default([]),
  /** When the chat danger classification last ran */
  dangerClassifiedAt: TimestampSchema.nullable().optional(),
  /** Message count at which danger was last classified (to detect changes for re-check) */
  dangerClassifiedAtMessageCount: z.number().nullable().optional(),

  /** Scene state tracker: structured summary of current scene (location, character actions, appearance, clothing) */
  sceneState: JsonSchema.nullable().optional(),

  /** Scriptorium: deterministic Markdown rendering of the full conversation */
  renderedMarkdown: z.string().nullable().optional(),

  /** Equipped outfit state per character: { [characterId]: { top, bottom, footwear, accessories } } */
  equippedOutfit: JsonSchema.nullable().optional(),

  /** Per-character generated avatars reflecting current outfit: { [characterId]: { imageId, generatedAt, afterMessageCount } } */
  characterAvatars: JsonSchema.nullable().optional(),

  /** Whether to auto-generate character avatars when outfits change (null = disabled) */
  avatarGenerationEnabled: z.boolean().nullable().optional(),

  /** Chat type discriminator: 'salon' for regular chats, 'help' for help assistant chats */
  chatType: z.enum(['salon', 'help']).default('salon'),
  /** For help chats: the current page URL being viewed (for context resolution) */
  helpPageUrl: z.string().nullable().optional(),

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
  /** Server-side turn queue for chained responses (JSON array of participant IDs) */
  turnQueue: z.string().default('[]'),
  /** Whether composition mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode: z.boolean().default(false),

  /** Document Mode layout state: normal (chat only), split (chat + document), focus (document only) */
  documentMode: z.enum(['normal', 'split', 'focus']).default('normal'),

  /** Divider position for split mode as percentage of main area width (20-80) */
  dividerPosition: z.number().min(20).max(80).default(45),

  /** Project this chat belongs to (optional) */
  projectId: UUIDSchema.nullable().optional(),

  /** Resolved scenario text selected at chat creation (preset or custom) */
  scenarioText: z.string().nullable().optional(),

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

  /** Flag to trigger tool change notification on next message (set when tool settings change) */
  forceToolsOnNextMessage: z.boolean().default(false),

  /** Pending outfit change notifications keyed by characterId, cleared after delivery */
  pendingOutfitNotifications: JsonSchema.nullable().optional(),

  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  /** Cached compression result for context compression (persisted across restarts) */
  compressionCache: JsonSchema.nullable().optional(),

  /** Whether agent mode is enabled for this chat (null = inherit from project/character/global) */
  agentModeEnabled: z.boolean().nullable().optional(),

  /** Current agent turn count within the current message processing (resets on new user message) */
  agentTurnCount: z.number().default(0),

  /** Story background image file ID (from file system) */
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  /** When the story background was last generated */
  lastBackgroundGeneratedAt: TimestampSchema.nullable().optional(),

  /** Image generation profile for this chat (shared by all participants) */
  imageProfileId: UUIDSchema.nullable().optional(),

  /** When an image is generated in this chat, inject an assistant message announcing it (null = inherit from project/global) */
  alertCharactersOfLanternImages: z.boolean().nullable().optional(),

  /** Whether this chat has been classified as dangerous (null = not yet classified) */
  isDangerousChat: z.boolean().nullable().optional(),
  /** Overall danger score for this chat (0-1), null = not yet classified */
  dangerScore: z.number().min(0).max(1).nullable().optional(),
  /** Categories of dangerous content detected at chat level (JSON array of strings) */
  dangerCategories: z.array(z.string()).default([]),
  /** When the chat danger classification last ran */
  dangerClassifiedAt: TimestampSchema.nullable().optional(),
  /** Message count at which danger was last classified (to detect changes for re-check) */
  dangerClassifiedAtMessageCount: z.number().nullable().optional(),

  /** Scene state tracker: structured summary of current scene (location, character actions, appearance, clothing) */
  sceneState: JsonSchema.nullable().optional(),

  /** Scriptorium: deterministic Markdown rendering of the full conversation */
  renderedMarkdown: z.string().nullable().optional(),

  /** Equipped outfit state per character: { [characterId]: { top, bottom, footwear, accessories } } */
  equippedOutfit: JsonSchema.nullable().optional(),

  /** Per-character generated avatars reflecting current outfit: { [characterId]: { imageId, generatedAt, afterMessageCount } } */
  characterAvatars: JsonSchema.nullable().optional(),

  /** Whether to auto-generate character avatars when outfits change (null = disabled) */
  avatarGenerationEnabled: z.boolean().nullable().optional(),

  /** Chat type discriminator: 'salon' for regular chats, 'help' for help assistant chats */
  chatType: z.enum(['salon', 'help']).default('salon'),
  /** For help chats: the current page URL being viewed (for context resolution) */
  helpPageUrl: z.string().nullable().optional(),

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
