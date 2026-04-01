/**
 * Chat Message Service Types
 *
 * Shared interfaces for the chat message service layer.
 */

import type { ChatMetadataBase, ChatParticipantBase, Character, ConnectionProfile, MessageEvent, TimestampConfig } from '@/lib/schemas/types'
import type { BuiltContext } from '@/lib/chat/context-manager'
import type { FallbackResult } from '@/lib/chat/file-attachment-fallback'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { getRepositories } from '@/lib/repositories/factory'

/**
 * Context passed through the message handling pipeline
 */
export interface MessageServiceContext {
  /** Chat ID */
  chatId: string
  /** User ID */
  userId: string
  /** Repository access */
  repos: ReturnType<typeof getRepositories>
  /** Chat metadata */
  chat: ChatMetadataBase
  /** User participant (persona) */
  userParticipant: ChatParticipantBase | null
  /** Responding character participant */
  characterParticipant: ChatParticipantBase
  /** Character data */
  character: Character
  /** Persona data (if available) - kept for backward compatibility */
  persona: { name: string; description: string } | null
  /** Connection profile for the LLM */
  connectionProfile: ConnectionProfile
  /** Decrypted API key (empty for providers that don't require it) */
  apiKey: string
  /** Image profile ID (if configured) */
  imageProfileId: string | null
  /** Whether this is a continue/nudge mode message */
  isContinueMode: boolean
  /** Whether this is a multi-character chat */
  isMultiCharacter: boolean
  /** All participants in multi-character chats */
  allParticipants?: ChatParticipantBase[]
  /** Map of character IDs to Character data */
  participantCharacters?: Map<string, Character>
  /** Timestamp configuration */
  timestampConfig?: TimestampConfig | null
  /** Chat settings */
  chatSettings?: {
    cheapLLMSettings?: {
      embeddingProfileId?: string
    }
    defaultRoleplayTemplateId?: string
    defaultTimestampConfig?: TimestampConfig | null
  } | null
  /** Roleplay template (if configured) */
  roleplayTemplate?: { systemPrompt: string } | null
}

/**
 * Pending tool result from user-initiated tool calls (shown in composer before sending)
 */
export interface PendingToolResultInput {
  tool: string
  success: boolean
  result: string
  prompt: string
  arguments: Record<string, unknown>
  createdAt: string
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** User message content (undefined in continue mode) */
  content?: string
  /** File IDs attached to the message */
  fileIds?: string[]
  /** Continue mode (nudge) - trigger character response without user message */
  continueMode?: boolean
  /** Specific participant to respond (for multi-character continue mode) */
  respondingParticipantId?: string
  /** Pending tool results to be saved as TOOL messages before the user message */
  pendingToolResults?: PendingToolResultInput[]
  /** Target participant IDs for whisper messages (null = visible to all) */
  targetParticipantIds?: string[] | null
  /** Browser User-Agent string from the originating request (scrubbed of Electron/Quilltap tokens) */
  browserUserAgent?: string
}

/**
 * File attachment with loaded data
 */
export interface AttachedFile {
  id: string
  filepath: string
  filename: string
  mimeType: string
  size: number
}

/**
 * Tool message saved to the chat
 */
export interface ToolMessage {
  toolName: string
  success: boolean
  content: string
  arguments?: Record<string, unknown>
  /** Provider-assigned call ID for native tool result formatting */
  callId?: string
  metadata?: {
    provider?: string
    model?: string
    expandedPrompt?: string
  }
}

/**
 * Generated image metadata
 */
export interface GeneratedImage {
  id: string
  filename: string
  filepath: string
  mimeType: string
  size: number
  width?: number
  height?: number
  sha256?: string
}

/**
 * Result of processing tool calls
 */
export interface ToolProcessingResult {
  toolMessages: ToolMessage[]
  generatedImagePaths: GeneratedImage[]
}

/**
 * Streaming result data
 */
export interface StreamingResult {
  fullResponse: string
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } | null
  rawResponse: unknown
  thoughtSignature?: string
}

/**
 * Next speaker information for multi-character chats
 */
export interface NextSpeakerInfo {
  nextSpeakerId: string | null
  reason: string
  cycleComplete: boolean
  isUsersTurn: boolean
}

/**
 * SSE event: A chained turn is starting for a new character
 */
export interface TurnStartEvent {
  turnStart: true
  participantId: string
  characterName: string
  chainDepth: number
}

/**
 * SSE event: A chained turn completed for a character
 */
export interface TurnCompleteEvent {
  turnComplete: true
  participantId: string
  messageId: string
  chainDepth: number
}

/**
 * SSE event: The chain of turns has finished
 */
export interface ChainCompleteEvent {
  chainComplete: true
  reason: 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete'
  nextSpeakerId: string | null
  chainDepth: number
}

/**
 * Data sent to the client via SSE stream
 */
export interface StreamChunkData {
  content?: string
  done?: boolean
  messageId?: string | null
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  cacheUsage?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } | null
  attachmentResults?: { sent: string[]; failed: { id: string; error: string }[] } | null
  toolsExecuted?: boolean
  toolsDetected?: number
  toolNames?: string[]
  toolArguments?: Record<string, unknown>[]
  toolResult?: {
    index: number
    name: string
    success: boolean
    result: unknown
  }
  turn?: NextSpeakerInfo
  emptyResponse?: boolean
  emptyResponseReason?: string
  error?: string
  errorType?: string
  details?: string
  debugLLMRequest?: Record<string, unknown>
  fileProcessing?: Array<{
    filename: string
    type: string
    usedImageDescriptionLLM: boolean
    error?: string
  }>
  turnStart?: TurnStartEvent
  turnComplete?: TurnCompleteEvent
  chainComplete?: ChainCompleteEvent
}

/**
 * Context for tool execution within a message
 */
export type { ToolExecutionContext }

/**
 * Built context from context manager
 */
export type { BuiltContext }

/**
 * Fallback result from file attachment processing
 */
export type { FallbackResult }

/**
 * Recovery context and result types
 */
export type { RecoveryContext, RecoveryResult } from './recovery.service'
