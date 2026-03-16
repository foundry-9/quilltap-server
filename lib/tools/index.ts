/**
 * Tools Module
 * Exports tool definitions, registry, handlers, and utilities
 */

export {
  getToolRegistry,
  resetToolRegistry,
  ToolRegistry,
  type ToolDefinition,
  type ToolContext,
} from './registry';

export {
  imageGenerationToolDefinition,
  validateImageGenerationInput,
  getProviderConstraints,
  type ImageGenerationToolConfig,
  type ImageGenerationToolInput,
  type ImageGenerationToolOutput,
  type GeneratedImageResult,
} from './image-generation-tool';

export {
  executeImageGenerationTool,
  validateImageProfile,
  getDefaultImageProfile,
  ImageGenerationError,
  type ImageToolExecutionContext,
} from './handlers/image-generation-handler';

// Memory Search Tool (Sprint 6)
export {
  memorySearchToolDefinition,
  validateMemorySearchInput,
  type MemorySearchToolInput,
  type MemorySearchToolOutput,
  type MemorySearchResult,
} from './memory-search-tool';

export {
  executeMemorySearchTool,
  formatMemorySearchResults,
  MemorySearchError,
  type MemorySearchToolContext,
} from './handlers/memory-search-handler';

// Web Search Tool
export {
  webSearchToolDefinition,
  validateWebSearchInput,
  type WebSearchToolInput,
  type WebSearchToolOutput,
  type WebSearchResult,
} from './web-search-tool';

export {
  executeWebSearchTool,
  formatWebSearchResults,
  WebSearchError,
  type WebSearchToolContext,
} from './handlers/web-search-handler';

// Project Info Tool
export {
  projectInfoToolDefinition,
  validateProjectInfoInput,
  type ProjectInfoAction,
  type ProjectInfoToolInput,
  type ProjectInfoToolOutput,
  type ProjectInfoResult,
  type ProjectInstructionsResult,
  type ProjectFilesListResult,
  type ProjectReadFileResult,
  type ProjectSearchFilesResult,
} from './project-info-tool';

export {
  executeProjectInfoTool,
  formatProjectInfoResults,
  ProjectInfoError,
  type ProjectInfoToolContext,
} from './handlers/project-info-handler';

// File Management Tool
export {
  fileManagementToolDefinition,
  validateFileManagementInput,
  type FileManagementAction,
  type FileScope,
  type FileManagementToolInput,
  type FileManagementToolOutput,
  type FileInfo,
  type FolderInfo,
  type FileListResult,
  type FolderListResult,
  type FileReadResult,
  type FileWriteResult,
  type FolderCreateResult,
  type AttachmentPromoteResult,
} from './file-management-tool';

export {
  executeFileManagementTool,
  formatFileManagementResults,
  FileManagementError,
  type FileManagementToolContext,
} from './handlers/file-management-handler';

// Request Full Context Tool (Context Compression Feature)
export {
  requestFullContextToolDefinition,
  validateRequestFullContextInput,
  type RequestFullContextToolInput,
  type RequestFullContextToolOutput,
} from './request-full-context-tool';

export {
  executeRequestFullContextTool,
  formatRequestFullContextResults,
  type RequestFullContextToolContext,
} from './handlers/request-full-context-handler';

// Submit Final Response Tool (Agent Mode Feature)
export {
  submitFinalResponseToolDefinition,
  validateSubmitFinalResponseInput,
  type SubmitFinalResponseToolInput,
  type SubmitFinalResponseToolOutput,
} from './submit-final-response-tool';

export {
  executeSubmitFinalResponseTool,
  formatSubmitFinalResponseResults,
  type SubmitFinalResponseToolContext,
} from './handlers/submit-final-response-handler';

// Help Search Tool
export {
  helpSearchToolDefinition,
  validateHelpSearchInput,
  type HelpSearchToolInput,
  type HelpSearchToolOutput,
  type HelpSearchResult,
} from './help-search-tool';

export {
  executeHelpSearchTool,
  formatHelpSearchResults,
  HelpSearchError,
  type HelpSearchToolContext,
} from './handlers/help-search-handler';

// Help Settings Tool
export {
  helpSettingsToolDefinition,
  validateHelpSettingsInput,
  type HelpSettingsCategory,
  type HelpSettingsToolInput,
  type HelpSettingsToolOutput,
} from './help-settings-tool';

export {
  executeHelpSettingsTool,
  formatHelpSettingsResults,
  HelpSettingsError,
  type HelpSettingsToolContext,
} from './handlers/help-settings-handler';

// Help Navigate Tool
export {
  helpNavigateToolDefinition,
  validateHelpNavigateInput,
  type HelpNavigateToolInput,
  type HelpNavigateToolOutput,
} from './help-navigate-tool';

export {
  executeHelpNavigateTool,
  formatHelpNavigateResults,
  type HelpNavigateToolContext,
} from './handlers/help-navigate-handler';

// RNG (Random Number Generator) Tool
export {
  rngToolDefinition,
  validateRngInput,
  type RngType,
  type RngToolInput,
  type RngToolOutput,
  type RngResult,
} from './rng-tool';

export {
  executeRngTool,
  formatRngResults,
  RngError,
  type RngToolContext,
} from './handlers/rng-handler';

// Whisper Tool (Private Messages in Multi-Character Chats)
export {
  whisperToolDefinition,
  validateWhisperInput,
  type WhisperToolInput,
  type WhisperToolOutput,
} from './whisper-tool';

export {
  executeWhisperTool,
  formatWhisperResults,
  WhisperError,
  type WhisperToolContext,
} from './handlers/whisper-handler';

// State (Persistent State Management) Tool
export {
  stateToolDefinition,
  validateStateInput,
  type StateOperation,
  type StateContext,
  type StateToolInput,
  type StateToolOutput,
} from './state-tool';

export {
  executeStateTool,
  formatStateResults,
  StateError,
  type StateToolContext,
} from './handlers/state-handler';

// Shell Interactivity Tools
export {
  shellChdirToolDefinition,
  shellExecSyncToolDefinition,
  shellExecAsyncToolDefinition,
  shellAsyncResultToolDefinition,
  shellSudoSyncToolDefinition,
  shellCpHostToolDefinition,
  getAllShellToolDefinitions,
  SHELL_TOOL_NAMES,
  isShellTool,
  type ShellToolName,
  type ShellToolContext,
  type ShellToolOutput,
  type ShellCommandResult,
  type ShellAsyncCommandResult,
  type ShellSessionState,
} from './shell';

export {
  executeShellTool,
  executeSudoCommand,
  formatShellResults,
  ShellError,
} from './shell';

// Plugin-Based Tool Builder (Phase 3)
export {
  buildToolsForProvider,
  type BuildToolsOptions,
} from './plugin-tool-builder';

// Tool Support (for checking model capabilities and tool mode)
export {
  checkModelSupportsTools,
  shouldUseTextBlockTools,
  type ToolMode,
} from './pseudo-tool-support';

export {
  buildNativeToolInstructions,
} from './native-tool-prompt';

// Text-Block Tool Call Parser (rich text-based tool invocation for all tools)
export {
  parseTextBlockCalls,
  convertTextBlockToToolCallRequest,
  stripTextBlockMarkers,
  hasTextBlockMarkers,
  mapTextBlockToolName,
  type ParsedTextBlock,
} from './text-block-parser';

export {
  buildTextBlockInstructions,
  type TextBlockPromptOptions,
} from './text-block-prompt';
