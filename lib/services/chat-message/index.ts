/**
 * Chat Message Service
 *
 * Barrel exports for the chat message service layer.
 */

// Types
export type {
  MessageServiceContext,
  SendMessageOptions,
  AttachedFile,
  ToolMessage,
  GeneratedImage,
  ToolProcessingResult,
  StreamingResult,
  NextSpeakerInfo,
  StreamChunkData,
} from './types'

// Orchestrator (main entry point)
export {
  handleSendMessage,
  sendMessageSchema,
  continueMessageSchema,
} from './orchestrator.service'

// Participant Resolution
export {
  resolveRespondingParticipant,
  loadAllParticipantData,
  getRoleplayTemplate,
  getActiveCharacterParticipants,
  type ParticipantResolutionResult,
  type AllParticipantsData,
} from './participant-resolver.service'

// Context Building
export {
  loadAndProcessFiles,
  buildConversationMessages,
  buildMessageContext,
  type BuildMessageContextOptions,
  type MessageContextResult,
  type FileProcessingResult,
} from './context-builder.service'

// Tool Execution
export {
  processToolCalls,
  saveToolMessages,
  detectToolCallsInResponse,
  createToolContext,
  type StreamController,
} from './tool-execution.service'

// Streaming
export {
  buildTools,
  streamMessage,
  encodeDebugInfo,
  encodeFallbackInfo,
  encodeContentChunk,
  encodeDoneEvent,
  encodeErrorEvent,
  encodeKeepAlive,
  safeEnqueue,
  safeClose,
  createStreamingResult,
  type StreamOptions,
  type StreamDebugInfo,
  type StreamChunkCallback,
} from './streaming.service'

// Pseudo-tools
export {
  checkShouldUsePseudoTools,
  buildPseudoToolSystemInstructions,
  parsePseudoToolsFromResponse,
  stripPseudoToolMarkersFromResponse,
  determineEnabledToolOptions,
  logPseudoToolUsage,
  type EnabledToolOptions,
  type PseudoToolCall,
} from './pseudo-tool.service'

// Memory Triggers
export {
  triggerMemoryExtraction,
  triggerInterCharacterMemory,
  triggerUserControlledCharacterMemory,
  triggerContextSummaryCheck,
  type MemoryChatSettings,
} from './memory-trigger.service'
