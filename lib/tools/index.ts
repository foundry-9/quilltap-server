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

// Plugin-Based Tool Builder (Phase 3)
export {
  buildToolsForProvider,
  type BuildToolsOptions,
} from './plugin-tool-builder';

// Pseudo-Tool Support (for models without native function calling)
export {
  checkModelSupportsTools,
  shouldUsePseudoTools,
  buildPseudoToolConfig,
  type PseudoToolConfig,
  type ToolMode,
} from './pseudo-tool-support';

export {
  buildPseudoToolInstructions,
  type PseudoToolOptions,
} from './pseudo-tool-prompt';

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
