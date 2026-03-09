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
  anthropicImageGenerationToolDefinition,
  getOpenAIImageGenerationTool,
  getAnthropicImageGenerationTool,
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
  anthropicMemorySearchToolDefinition,
  getOpenAIMemorySearchTool,
  getAnthropicMemorySearchTool,
  getGoogleMemorySearchTool,
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
  anthropicWebSearchToolDefinition,
  getOpenAIWebSearchTool,
  getAnthropicWebSearchTool,
  getGoogleWebSearchTool,
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
  anthropicProjectInfoToolDefinition,
  getOpenAIProjectInfoTool,
  getAnthropicProjectInfoTool,
  getGoogleProjectInfoTool,
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
  anthropicFileManagementToolDefinition,
  getOpenAIFileManagementTool,
  getAnthropicFileManagementTool,
  getGoogleFileManagementTool,
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
  anthropicRequestFullContextToolDefinition,
  getOpenAIRequestFullContextTool,
  getAnthropicRequestFullContextTool,
  getGoogleRequestFullContextTool,
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
  anthropicSubmitFinalResponseToolDefinition,
  getOpenAISubmitFinalResponseTool,
  getAnthropicSubmitFinalResponseTool,
  getGoogleSubmitFinalResponseTool,
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
  anthropicHelpSearchToolDefinition,
  getOpenAIHelpSearchTool,
  getAnthropicHelpSearchTool,
  getGoogleHelpSearchTool,
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

// RNG (Random Number Generator) Tool
export {
  rngToolDefinition,
  anthropicRngToolDefinition,
  getOpenAIRngTool,
  getAnthropicRngTool,
  getGoogleRngTool,
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
  anthropicWhisperToolDefinition,
  getOpenAIWhisperTool,
  getAnthropicWhisperTool,
  getGoogleWhisperTool,
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
  anthropicStateToolDefinition,
  getOpenAIStateTool,
  getAnthropicStateTool,
  getGoogleStateTool,
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

// Pseudo-Tool Support (for models without native function calling)
export {
  checkModelSupportsTools,
  shouldUsePseudoTools,
  shouldUseTextBlockTools,
  buildPseudoToolConfig,
  type PseudoToolConfig,
  type ToolMode,
} from './pseudo-tool-support';

export {
  buildPseudoToolInstructions,
  type PseudoToolOptions,
} from './pseudo-tool-prompt'

export {
  buildNativeToolInstructions,
} from './native-tool-prompt';

export {
  parsePseudoToolCalls,
  convertToToolCallRequest,
  stripPseudoToolMarkers,
  hasPseudoToolMarkers,
  type ParsedPseudoTool,
  type ToolCallRequest,
} from './pseudo-tool-parser';

// XML Tool Call Parser (for LLMs that emit XML-style tool calls)
export {
  parseXMLToolCalls,
  convertXMLToToolCallRequest,
  stripXMLToolMarkers,
  hasXMLToolMarkers,
  mapXMLToolName,
  type ParsedXMLTool,
} from './xml-tool-parser';

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
