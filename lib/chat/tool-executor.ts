/**
 * Tool Execution Handler for Chat
 * Detects and executes LLM tool calls during message processing
 */

import { logger } from '@/lib/logger'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { toolRegistry } from '@/lib/plugins/tool-registry'
import { getRepositories } from '@/lib/repositories/factory'
import type { ToolExecutionContext as PluginToolContext } from '@/lib/plugins/interfaces/tool-plugin'
import {
  executeImageGenerationTool,
  executeMemorySearchTool,
  formatMemorySearchResults,
  type ImageToolExecutionContext,
  type MemorySearchToolContext,
} from '@/lib/tools';
import {
  executeWebSearchTool,
  formatWebSearchResults,
  type WebSearchToolContext,
} from '@/lib/tools/handlers/web-search-handler';
import {
  executeProjectInfoTool,
  formatProjectInfoResults,
  type ProjectInfoToolContext,
} from '@/lib/tools/handlers/project-info-handler';
import {
  executeFileManagementTool,
  formatFileManagementResults,
  type FileManagementToolContext,
} from '@/lib/tools/handlers/file-management-handler';
import {
  executeRequestFullContextTool,
  formatRequestFullContextResults,
  type RequestFullContextToolContext,
} from '@/lib/tools/handlers/request-full-context-handler';
import {
  executeHelpSearchTool,
  formatHelpSearchResults,
  type HelpSearchToolContext,
} from '@/lib/tools/handlers/help-search-handler';
import {
  executeHelpSettingsTool,
  formatHelpSettingsResults,
  type HelpSettingsToolContext,
} from '@/lib/tools/handlers/help-settings-handler';
import {
  executeHelpNavigateTool,
  formatHelpNavigateResults,
  type HelpNavigateToolContext,
} from '@/lib/tools/handlers/help-navigate-handler';
import {
  executeRngTool,
  formatRngResults,
  type RngToolContext,
} from '@/lib/tools/handlers/rng-handler';
import {
  executeStateTool,
  formatStateResults,
  type StateToolContext,
} from '@/lib/tools/handlers/state-handler';
import {
  executeSubmitFinalResponseTool,
  formatSubmitFinalResponseResults,
  type SubmitFinalResponseToolContext,
} from '@/lib/tools/handlers/submit-final-response-handler';
import {
  executeWhisperTool,
  formatWhisperResults,
  type WhisperToolContext,
} from '@/lib/tools/handlers/whisper-handler';
import {
  executeShellTool,
  formatShellResults,
  isShellTool,
  type ShellToolContext,
} from '@/lib/tools/shell';
import {
  executeWardrobeListTool,
  formatWardrobeListResults,
  type WardrobeListToolContext,
} from '@/lib/tools/handlers/wardrobe-list-handler';
import {
  executeWardrobeUpdateOutfitTool,
  formatWardrobeUpdateOutfitResults,
  type WardrobeUpdateOutfitToolContext,
} from '@/lib/tools/handlers/wardrobe-update-outfit-handler';
import {
  executeWardrobeCreateItemTool,
  formatWardrobeCreateItemResults,
  type WardrobeCreateItemToolContext,
} from '@/lib/tools/handlers/wardrobe-create-item-handler';
import {
  executeReadConversationTool,
  formatReadConversationResults,
  type ReadConversationToolContext,
} from '@/lib/tools/handlers/read-conversation-handler';
import {
  executeSearchScriptoriumTool,
  formatSearchScriptoriumResults,
  type SearchScriptoriumToolContext,
} from '@/lib/tools/handlers/search-scriptorium-handler';
import {
  executeUpsertAnnotationTool,
  formatUpsertAnnotationResults,
  type UpsertAnnotationToolContext,
} from '@/lib/tools/handlers/upsert-annotation-handler';
import {
  executeDeleteAnnotationTool,
  formatDeleteAnnotationResults,
  type DeleteAnnotationToolContext,
} from '@/lib/tools/handlers/delete-annotation-handler';

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  /** Provider-assigned call ID for correlating results to calls */
  callId?: string;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
  /** Human-readable error message with more details than the error code */
  message?: string;
  /** For file_management: indicates permission is required for this write */
  requiresPermission?: boolean;
  /** Pending write details when requiresPermission is true */
  pendingWrite?: {
    filename: string;
    content?: string;
    mimeType?: string;
    folderPath?: string;
    projectId?: string | null;
  };
  /** For sudo_sync: indicates user approval is required */
  requiresSudoApproval?: boolean;
  /** For sudo_sync: the pending command details */
  pendingSudoCommand?: {
    command: string;
    parameters?: string[];
    timeout_ms?: number;
  };
  /** For shell tools: indicates workspace acknowledgement is required */
  requiresWorkspaceAcknowledgement?: boolean;
  metadata?: {
    provider?: string;
    model?: string;
    /** For image generation, the expanded prompt with {{me}} etc. resolved */
    expandedPrompt?: string;
  };
}

/**
 * Extended context for tool execution
 */
export interface ToolExecutionContext {
  chatId: string;
  userId: string;
  imageProfileId?: string;
  characterId?: string;
  embeddingProfileId?: string;
  /** Participant ID of who is calling the tool (for {{me}} resolution in image prompts) */
  callingParticipantId?: string;
  /** Project ID for project_info tool */
  projectId?: string;
  /** Browser User-Agent from the originating request (scrubbed of Electron/Quilltap tokens) */
  browserUserAgent?: string;
}

/**
 * Execute a tool call (legacy signature for backwards compatibility)
 */
export async function executeToolCall(
  toolCall: ToolCallRequest,
  chatId: string,
  userId: string,
  imageProfileId?: string
): Promise<ToolResult> {
  return executeToolCallWithContext(toolCall, {
    chatId,
    userId,
    imageProfileId,
  });
}

/**
 * Execute a tool call with full context
 */
// Built-in tool names that are handled directly by this module
// These should NOT be routed to the plugin registry
const BUILT_IN_TOOLS = new Set([
  'generate_image',
  'search_memories',
  'search_web',
  'project_info',
  'file_management',
  'request_full_context',
  'help_search',
  'help_settings',
  'help_navigate',
  'rng',
  'state',
  'submit_final_response',
  'whisper',
  // Scriptorium tools
  'read_conversation',
  'upsert_annotation',
  'delete_annotation',
  'search_scriptorium',
  // Wardrobe tools
  'list_wardrobe',
  'update_outfit_item',
  'create_wardrobe_item',
  // Shell interactivity tools
  'chdir',
  'exec_sync',
  'exec_async',
  'async_result',
  'sudo_sync',
  'cp_host',
]);

export async function executeToolCallWithContext(
  toolCall: ToolCallRequest,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const { chatId, userId, imageProfileId, characterId, embeddingProfileId } = context;

  try {
    // Check if this is a built-in tool - these are handled later in this function
    const isBuiltInTool = BUILT_IN_TOOLS.has(toolCall.name);

    // Check tool registry for plugin-provided tools (static or multi-tool)
    // Only route to plugins if this is NOT a built-in tool
    // hasPlugin checks if plugin with that name exists, getAllPlugins checks if any plugins exist
    const isStaticTool = !isBuiltInTool && toolRegistry.hasPlugin(toolCall.name);
    const isMultiToolPluginTool = !isBuiltInTool && !isStaticTool && toolRegistry.getAllPlugins().length > 0;

    if (isStaticTool || isMultiToolPluginTool) {
      // Fetch user's tool configuration from database
      let toolConfig: Record<string, unknown> = {};
      try {
        const repos = getRepositories();

        if (isStaticTool) {
          // For static tools, look up config by tool name pattern
          const pluginName = `qtap-plugin-${toolCall.name}`;
          const userConfig = await repos.pluginConfigs.findByUserAndPlugin(userId, pluginName);
          if (userConfig) {
            toolConfig = userConfig.config;
          } else {
            toolConfig = toolRegistry.getDefaultConfig(toolCall.name);
          }
        } else {
          // For multi-tool plugins (like MCP), we need to load configs for all multi-tool plugins
          // The tool registry's executeTool will find the right plugin
          const multiToolPluginNames = toolRegistry.getPluginNames();
          for (const pluginName of multiToolPluginNames) {
            const fullPluginName = `qtap-plugin-${pluginName}`;
            const userConfig = await repos.pluginConfigs.findByUserAndPlugin(userId, fullPluginName);
            if (userConfig) {
              // Pass the config under the plugin name key so executeTool can find it
              toolConfig[pluginName] = userConfig.config;
            }
          }
        }
      } catch (configError) {
        logger.warn('Failed to load tool config, using defaults', {
          context: 'tool-executor',
          toolName: toolCall.name,
          error: configError instanceof Error ? configError.message : String(configError),
        });
        if (isStaticTool) {
          toolConfig = toolRegistry.getDefaultConfig(toolCall.name);
        }
      }

      // Build context for plugin tool execution
      const pluginContext: PluginToolContext = {
        userId,
        chatId,
        projectId: context.projectId,
        characterId,
        callingParticipantId: context.callingParticipantId,
        toolConfig,
        browserUserAgent: context.browserUserAgent,
      };

      const result = await toolRegistry.executeTool(
        toolCall.name,
        toolCall.arguments,
        pluginContext
      );

      // Format results for LLM
      const formattedResult = toolRegistry.formatToolResults(toolCall.name, result);

      // Build result object - only spread if result.result is a plain object
      const resultData = result.success ? {
        formattedText: formattedResult,
        ...(result.result && typeof result.result === 'object' && !Array.isArray(result.result)
          ? result.result as object
          : { rawResult: result.result }),
      } : null;

      return {
        toolName: toolCall.name,
        success: result.success,
        result: resultData,
        error: result.success ? undefined : result.error,
        metadata: result.metadata,
      };
    }

    // Handle image generation (built-in tool)
    if (toolCall.name === 'generate_image') {
      // If no image profile is configured, return error
      if (!imageProfileId) {
        return {
          toolName: 'generate_image',
          success: false,
          result: null,
          error: 'Image generation is not enabled for this chat',
        };
      }

      // Execute image generation tool
      // Pass callingParticipantId so {{me}} resolves to the character (who's calling the tool)
      const imageContext: ImageToolExecutionContext = {
        userId,
        profileId: imageProfileId,
        chatId,
        callingParticipantId: context.callingParticipantId,
      };

      const result = await executeImageGenerationTool(toolCall.arguments, imageContext);

      return {
        toolName: 'generate_image',
        success: result.success,
        result: result.success ? result.images : null,
        error: result.success ? undefined : result.error,
        message: result.success ? undefined : result.message,
        metadata: {
          provider: result.provider,
          model: result.model,
          expandedPrompt: result.expandedPrompt,
        },
      };
    }

    // Handle memory search
    if (toolCall.name === 'search_memories') {
      // If no character is configured, return error
      if (!characterId) {
        return {
          toolName: 'search_memories',
          success: false,
          result: null,
          error: 'Memory search requires a character context',
        };
      }

      // Execute memory search tool
      const memoryContext: MemorySearchToolContext = {
        userId,
        characterId,
        embeddingProfileId,
      };

      const result = await executeMemorySearchTool(toolCall.arguments, memoryContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.memories
        ? formatMemorySearchResults(result.memories)
        : result.error || 'No memories found';

      return {
        toolName: 'search_memories',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          memories: result.memories,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle web search
    if (toolCall.name === 'search_web') {
      // Execute web search tool
      const webSearchContext: WebSearchToolContext = {
        userId,
      };

      const result = await executeWebSearchTool(toolCall.arguments, webSearchContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.results
        ? formatWebSearchResults(result.results)
        : result.error || 'No search results found';

      return {
        toolName: 'search_web',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle project info
    if (toolCall.name === 'project_info') {
      // If no project is configured, return error
      if (!context.projectId) {
        return {
          toolName: 'project_info',
          success: false,
          result: null,
          error: 'Project info requires a project context',
        };
      }

      // Execute project info tool
      const projectContext: ProjectInfoToolContext = {
        userId,
        projectId: context.projectId,
        embeddingProfileId,
      };

      const result = await executeProjectInfoTool(toolCall.arguments, projectContext);

      // Format results for LLM consumption
      const formattedResult = formatProjectInfoResults(result);

      return {
        toolName: 'project_info',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          action: result.action,
          data: result.data,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle file management
    if (toolCall.name === 'file_management') {
      // Execute file management tool
      const fileContext: FileManagementToolContext = {
        userId,
        chatId,
        projectId: context.projectId || null,
        characterIds: characterId ? [characterId] : [],
      };

      const result = await executeFileManagementTool(toolCall.arguments, fileContext);

      // Debug: Log the file management result structure
      // Format results for LLM consumption
      const formattedResult = formatFileManagementResults(result);

      // Check if permission is required for write operations
      if (result.requiresPermission) {
        logger.info('File management requires permission, returning pendingWrite', {
          filename: result.filename,
          folderPath: result.folderPath,
        });
        const args = toolCall.arguments as Record<string, unknown>;
        return {
          toolName: 'file_management',
          success: false,
          result: null,
          error: result.message || 'File write permission required',
          requiresPermission: true,
          pendingWrite: {
            filename: result.filename || (args.filename as string) || 'unknown',
            content: args.content as string | undefined,
            mimeType: args.mimeType as string | undefined,
            folderPath: result.folderPath || (args.targetFolderPath as string) || '/',
            projectId: context.projectId || null,
          },
        };
      }

      return {
        toolName: 'file_management',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          action: result.action,
          data: result.data,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle request_full_context (context compression bypass)
    if (toolCall.name === 'request_full_context') {
      // Execute request full context tool
      const requestContext: RequestFullContextToolContext = {
        chatId,
      };

      const result = await executeRequestFullContextTool(toolCall.arguments, requestContext);

      // Format results for LLM consumption
      const formattedResult = formatRequestFullContextResults(result);

      return {
        toolName: 'request_full_context',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
        } : null,
        error: result.success ? undefined : result.message,
      };
    }

    // Handle help_search (help documentation search)
    if (toolCall.name === 'help_search') {
      // Execute help search tool
      const helpContext: HelpSearchToolContext = {
        userId,
      };

      const result = await executeHelpSearchTool(toolCall.arguments, helpContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.results
        ? formatHelpSearchResults(result.results)
        : result.error || 'No help documentation found';

      return {
        toolName: 'help_search',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle help_settings (settings reader for help characters)
    if (toolCall.name === 'help_settings') {
      const helpSettingsContext: HelpSettingsToolContext = {
        userId,
      };

      const result = await executeHelpSettingsTool(toolCall.arguments, helpSettingsContext);

      const formattedResult = result.success && result.data
        ? formatHelpSettingsResults(result)
        : result.error || 'Failed to read settings';

      return {
        toolName: 'help_settings',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          category: result.category,
          data: result.data,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle help_navigate (navigate user's browser to a Quilltap page)
    if (toolCall.name === 'help_navigate') {
      const helpNavContext: HelpNavigateToolContext = {
        userId,
      };

      const result = await executeHelpNavigateTool(toolCall.arguments, helpNavContext);

      const formattedResult = result.success
        ? formatHelpNavigateResults(result)
        : result.error || 'Failed to navigate';

      return {
        toolName: 'help_navigate',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          navigationUrl: result.url,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle rng (random number generator)
    if (toolCall.name === 'rng') {
      // Execute RNG tool
      const rngContext: RngToolContext = {
        userId,
        chatId,
      };

      const result = await executeRngTool(toolCall.arguments, rngContext);

      // Format results for LLM consumption
      const formattedResult = formatRngResults(result);

      return {
        toolName: 'rng',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          type: result.type,
          rollCount: result.rollCount,
          results: result.results,
          sum: result.sum,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle state (persistent state management)
    if (toolCall.name === 'state') {
      // Execute state tool
      const stateContext: StateToolContext = {
        userId,
        chatId,
        projectId: context.projectId,
      };

      const result = await executeStateTool(toolCall.arguments, stateContext);

      // Format results for LLM consumption
      const formattedResult = formatStateResults(result);

      return {
        toolName: 'state',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          operation: result.operation,
          context: result.context,
          path: result.path,
          value: result.value,
          previousValue: result.previousValue,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle list_wardrobe
    if (toolCall.name === 'list_wardrobe') {
      const wardrobeContext: WardrobeListToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeListTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeListResults(result);

      return {
        toolName: 'list_wardrobe',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          items: result.items,
          total_count: result.total_count,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle update_outfit_item
    if (toolCall.name === 'update_outfit_item') {
      const wardrobeContext: WardrobeUpdateOutfitToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeUpdateOutfitTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeUpdateOutfitResults(result);

      return {
        toolName: 'update_outfit_item',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          action: result.action,
          slot: result.slot,
          item: result.item,
          current_state: result.current_state,
          coverage_summary: result.coverage_summary,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle create_wardrobe_item
    if (toolCall.name === 'create_wardrobe_item') {
      const wardrobeContext: WardrobeCreateItemToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeCreateItemTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeCreateItemResults(result);

      return {
        toolName: 'create_wardrobe_item',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          item_id: result.item_id,
          title: result.title,
          equipped: result.equipped,
          recipient_name: result.recipient_name,
          current_state: result.current_state,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle read_conversation (Scriptorium)
    if (toolCall.name === 'read_conversation') {
      const readContext: ReadConversationToolContext = {
        userId,
        chatId,
        characterId,
      };

      const result = await executeReadConversationTool(toolCall.arguments, readContext);
      const formattedResult = formatReadConversationResults(result);

      return {
        toolName: 'read_conversation',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          messageCount: result.messageCount,
          interchangeCount: result.interchangeCount,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle upsert_annotation (Scriptorium)
    if (toolCall.name === 'upsert_annotation') {
      // Resolve character name from calling participant
      let characterName = 'Unknown';
      if (context.callingParticipantId) {
        const repos = getRepositories();
        const chat = await repos.chats.findById(chatId);
        if (chat) {
          const participant = chat.participants.find(p => p.id === context.callingParticipantId);
          if (participant?.characterId) {
            const character = await repos.characters.findById(participant.characterId);
            if (character) {
              characterName = character.name;
            }
          }
        }
      }

      const annotationContext: UpsertAnnotationToolContext = {
        userId,
        chatId,
        characterName,
      };

      const result = await executeUpsertAnnotationTool(toolCall.arguments, annotationContext);
      const formattedResult = formatUpsertAnnotationResults(result);

      return {
        toolName: 'upsert_annotation',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          message_index: result.message_index,
          character_name: result.character_name,
          action: result.action,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle delete_annotation (Scriptorium)
    if (toolCall.name === 'delete_annotation') {
      // Resolve character name from calling participant (same as upsert)
      let characterName = 'Unknown';
      if (context.callingParticipantId) {
        const repos = getRepositories();
        const chat = await repos.chats.findById(chatId);
        if (chat) {
          const participant = chat.participants.find(p => p.id === context.callingParticipantId);
          if (participant?.characterId) {
            const character = await repos.characters.findById(participant.characterId);
            if (character) {
              characterName = character.name;
            }
          }
        }
      }

      const deleteContext: DeleteAnnotationToolContext = {
        userId,
        chatId,
        characterName,
      };

      const result = await executeDeleteAnnotationTool(toolCall.arguments, deleteContext);
      const formattedResult = formatDeleteAnnotationResults(result);

      return {
        toolName: 'delete_annotation',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          message_index: result.message_index,
          character_name: result.character_name,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle search_scriptorium (Scriptorium unified search)
    if (toolCall.name === 'search_scriptorium') {
      if (!characterId) {
        return {
          toolName: 'search_scriptorium',
          success: false,
          result: null,
          error: 'Search requires a character context',
        };
      }

      const searchContext: SearchScriptoriumToolContext = {
        userId,
        characterId,
        embeddingProfileId,
      };

      const result = await executeSearchScriptoriumTool(toolCall.arguments, searchContext);

      const formattedResult = result.success && result.results
        ? formatSearchScriptoriumResults(result.results)
        : result.error || 'No results found';

      return {
        toolName: 'search_scriptorium',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle submit_final_response (agent mode completion)
    if (toolCall.name === 'submit_final_response') {
      // Execute submit final response tool
      const submitContext: SubmitFinalResponseToolContext = {
        chatId,
      };

      const result = await executeSubmitFinalResponseTool(toolCall.arguments, submitContext);

      // Format results for LLM consumption
      const formattedResult = formatSubmitFinalResponseResults(result);

      return {
        toolName: 'submit_final_response',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          finalResponse: result.finalResponse,
          summary: result.summary,
          confidence: result.confidence,
        } : null,
        error: result.success ? undefined : result.message,
      };
    }

    // Handle whisper (private message in multi-character chats)
    if (toolCall.name === 'whisper') {
      if (!context.callingParticipantId) {
        return {
          toolName: 'whisper',
          success: false,
          result: null,
          error: 'Whisper requires a multi-character chat context',
        };
      }

      const whisperContext: WhisperToolContext = {
        userId,
        chatId,
        callingParticipantId: context.callingParticipantId,
      };

      const result = await executeWhisperTool(toolCall.arguments, whisperContext);
      const formattedResult = formatWhisperResults(result);

      return {
        toolName: 'whisper',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          targetName: result.targetName,
          targetParticipantId: result.targetParticipantId,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle shell interactivity tools
    if (isShellTool(toolCall.name)) {
      const shellContext: ShellToolContext = {
        userId,
        chatId,
        projectId: context.projectId,
        characterId,
      };

      const result = await executeShellTool(toolCall.name, toolCall.arguments, shellContext);

      // Handle sudo approval requirement
      if (result.requiresSudoApproval) {
        return {
          toolName: toolCall.name,
          success: false,
          result: null,
          error: 'Sudo command requires user approval',
          requiresSudoApproval: true,
          pendingSudoCommand: result.pendingSudoCommand,
        };
      }

      // Handle workspace acknowledgement requirement
      if (result.requiresWorkspaceAcknowledgement) {
        return {
          toolName: toolCall.name,
          success: false,
          result: null,
          error: 'Workspace acknowledgement required',
          requiresWorkspaceAcknowledgement: true,
        };
      }

      return {
        toolName: toolCall.name,
        success: result.success,
        result: result.success ? {
          formattedText: formatShellResults(result),
          ...result.result,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Unknown tool
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: `Unknown tool: ${toolCall.name}`,
    };
  } catch (error) {
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Detect tool calls in LLM response
 * Delegates to the provider plugin's parseToolCalls method
 */
export function detectToolCalls(
  response: unknown,
  provider: string
): ToolCallRequest[] {
  try {
    const plugin = providerRegistry.getProvider(provider)
    if (plugin?.parseToolCalls) {
      return plugin.parseToolCalls(response)
    }

    logger.warn('No provider plugin found for tool call parsing', { context: 'tool-executor', provider })
    return []
  } catch (error) {
    logger.error('Error detecting tool calls', { context: 'tool-executor', provider }, error instanceof Error ? error : undefined);
    return [];
  }
}
