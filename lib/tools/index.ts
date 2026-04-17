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

// Wardrobe Tools (Modular Wardrobe System)
export {
  wardrobeListToolDefinition,
  validateWardrobeListInput,
  type WardrobeListToolInput,
  type WardrobeListToolOutput,
  type WardrobeListItemResult,
} from './wardrobe-list-tool';

export {
  executeWardrobeListTool,
  formatWardrobeListResults,
  WardrobeListError,
  type WardrobeListToolContext,
} from './handlers/wardrobe-list-handler';

export {
  wardrobeUpdateOutfitToolDefinition,
  validateWardrobeUpdateOutfitInput,
  type WardrobeUpdateOutfitToolInput,
  type WardrobeUpdateOutfitToolOutput,
} from './wardrobe-update-outfit-tool';

export {
  executeWardrobeUpdateOutfitTool,
  formatWardrobeUpdateOutfitResults,
  WardrobeUpdateOutfitError,
  type WardrobeUpdateOutfitToolContext,
} from './handlers/wardrobe-update-outfit-handler';

export {
  wardrobeCreateItemToolDefinition,
  validateWardrobeCreateItemInput,
  type WardrobeCreateItemToolInput,
  type WardrobeCreateItemToolOutput,
} from './wardrobe-create-item-tool';

export {
  executeWardrobeCreateItemTool,
  formatWardrobeCreateItemResults,
  WardrobeCreateItemError,
  type WardrobeCreateItemToolContext,
} from './handlers/wardrobe-create-item-handler';

// Scriptorium Tools (Conversation Rendering + Annotations)
export {
  readConversationToolDefinition,
  validateReadConversationInput,
  type ReadConversationToolInput,
  type ReadConversationToolOutput,
} from './read-conversation-tool';

export {
  upsertAnnotationToolDefinition,
  validateUpsertAnnotationInput,
  type UpsertAnnotationToolInput,
  type UpsertAnnotationToolOutput,
} from './upsert-annotation-tool';

export {
  deleteAnnotationToolDefinition,
  validateDeleteAnnotationInput,
  type DeleteAnnotationToolInput,
  type DeleteAnnotationToolOutput,
} from './delete-annotation-tool';

export {
  searchScriptoriumToolDefinition,
  validateSearchScriptoriumInput,
  type SearchScriptoriumToolInput,
  type SearchScriptoriumToolOutput,
  type SearchScriptoriumResult,
} from './search-scriptorium-tool';

export {
  executeSearchScriptoriumTool,
  formatSearchScriptoriumResults,
  type SearchScriptoriumToolContext,
} from './handlers/search-scriptorium-handler';

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

// Document Editing Tools (Scriptorium Phase 3.3)
export { docReadFileTool, validateDocReadFileInput, type DocReadFileInput, type DocReadFileOutput } from './doc-read-file-tool';
export { docWriteFileTool, validateDocWriteFileInput, type DocWriteFileInput, type DocWriteFileOutput } from './doc-write-file-tool';
export { docStrReplaceTool, validateDocStrReplaceInput, type DocStrReplaceInput, type DocStrReplaceOutput } from './doc-str-replace-tool';
export { docInsertTextTool, validateDocInsertTextInput, type DocInsertTextInput, type DocInsertTextOutput } from './doc-insert-text-tool';
export { docGrepTool, validateDocGrepInput, type DocGrepInput, type DocGrepOutput, type DocGrepMatch } from './doc-grep-tool';
export { docListFilesTool, validateDocListFilesInput, type DocListFilesInput, type DocListFilesOutput, type DocFileInfo } from './doc-list-files-tool';
export { docReadFrontmatterTool, validateDocReadFrontmatterInput, type DocReadFrontmatterInput, type DocReadFrontmatterOutput } from './doc-read-frontmatter-tool';
export { docUpdateFrontmatterTool, validateDocUpdateFrontmatterInput, type DocUpdateFrontmatterInput, type DocUpdateFrontmatterOutput } from './doc-update-frontmatter-tool';
export { docReadHeadingTool, validateDocReadHeadingInput, type DocReadHeadingInput, type DocReadHeadingOutput } from './doc-read-heading-tool';
export { docUpdateHeadingTool, validateDocUpdateHeadingInput, type DocUpdateHeadingInput, type DocUpdateHeadingOutput } from './doc-update-heading-tool';

// Document File Management Tools (Scriptorium Phase 3.4)
export { docMoveFileTool, validateDocMoveFileInput, type DocMoveFileInput, type DocMoveFileOutput } from './doc-move-file-tool';
export { docDeleteFileTool, validateDocDeleteFileInput, type DocDeleteFileInput, type DocDeleteFileOutput } from './doc-delete-file-tool';
export { docCreateFolderTool, validateDocCreateFolderInput, type DocCreateFolderInput, type DocCreateFolderOutput } from './doc-create-folder-tool';
export { docDeleteFolderTool, validateDocDeleteFolderInput, type DocDeleteFolderInput, type DocDeleteFolderOutput } from './doc-delete-folder-tool';

// Document Folder Management Tool (Scriptorium Phase 4.0 Deliverable 3 - Phase B)
export { docMoveFolderTool, validateDocMoveFolderInput, type DocMoveFolderInput, type DocMoveFolderOutput } from './doc-move-folder-tool';

// Document Blob Tools (database-backed stores + universal blob layer)
export { docWriteBlobTool, validateDocWriteBlobInput, type DocWriteBlobInput, type DocWriteBlobOutput } from './doc-write-blob-tool';
export { docReadBlobTool, validateDocReadBlobInput, type DocReadBlobInput, type DocReadBlobOutput } from './doc-read-blob-tool';
export { docListBlobsTool, validateDocListBlobsInput, type DocListBlobsInput, type DocListBlobsOutput, type DocBlobSummary } from './doc-list-blobs-tool';
export { docDeleteBlobTool, validateDocDeleteBlobInput, type DocDeleteBlobInput, type DocDeleteBlobOutput } from './doc-delete-blob-tool';

// Document UI Tools (Scriptorium Phase 3.5)
export { docOpenDocumentTool, validateDocOpenDocumentInput, type DocOpenDocumentInput, type DocOpenDocumentOutput } from './doc-open-document-tool';
export { docCloseDocumentTool, validateDocCloseDocumentInput, type DocCloseDocumentInput, type DocCloseDocumentOutput } from './doc-close-document-tool';
export { docFocusTool, validateDocFocusInput, type DocFocusInput, type DocFocusOutput } from './doc-focus-tool';

export {
  executeDocEditTool,
  formatDocEditResults,
  isDocEditTool,
  DOC_EDIT_TOOL_NAMES,
  type DocEditToolContext,
} from './handlers/doc-edit-handler';
