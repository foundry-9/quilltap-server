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

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
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
}

/**
 * Format tool result for inclusion in conversation context
 * Different LLM providers may have different formats
 */
export function formatToolResult(
  toolResult: ToolResult,
  provider: string
): { role: string; content: string } {
  const resultText = toolResult.success
    ? JSON.stringify(toolResult.result, null, 2)
    : `Error: ${toolResult.error || 'Unknown error'}`;

  // Different providers may want different formatting
  switch (provider) {
    case 'ANTHROPIC':
      // Anthropic expects tool results in a specific format
      return {
        role: 'user',
        content: `Tool Result: ${toolResult.toolName}\n\n${resultText}`,
      };

    case 'OPENAI':
      // OpenAI format
      return {
        role: 'user',
        content: `Tool Result: ${toolResult.toolName}\n\n${resultText}`,
      };

    default:
      return {
        role: 'user',
        content: `Tool Result: ${toolResult.toolName}\n\n${resultText}`,
      };
  }
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
    // hasTool checks if plugin with that name exists, hasMultiToolPlugins checks if any plugins exist
    const isStaticTool = !isBuiltInTool && toolRegistry.hasTool(toolCall.name);
    const isMultiToolPluginTool = !isBuiltInTool && !isStaticTool && toolRegistry.hasMultiToolPlugins();

    if (isStaticTool || isMultiToolPluginTool) {
      logger.debug('Executing plugin tool', {
        context: 'tool-executor',
        toolName: toolCall.name,
        isStaticTool,
        isMultiToolPluginTool,
      });

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
            logger.debug('Loaded static tool config from database', {
              context: 'tool-executor',
              toolName: toolCall.name,
              pluginName,
              configKeys: Object.keys(toolConfig),
            });
          } else {
            toolConfig = toolRegistry.getDefaultConfig(toolCall.name);
            logger.debug('Using default static tool config', {
              context: 'tool-executor',
              toolName: toolCall.name,
              configKeys: Object.keys(toolConfig),
            });
          }
        } else {
          // For multi-tool plugins (like MCP), we need to load configs for all multi-tool plugins
          // The tool registry's executeTool will find the right plugin
          const multiToolPluginNames = toolRegistry.getMultiToolPluginNames();
          for (const pluginName of multiToolPluginNames) {
            const fullPluginName = `qtap-plugin-${pluginName}`;
            const userConfig = await repos.pluginConfigs.findByUserAndPlugin(userId, fullPluginName);
            if (userConfig) {
              // Pass the config under the plugin name key so executeTool can find it
              toolConfig[pluginName] = userConfig.config;
              logger.debug('Loaded multi-tool plugin config', {
                context: 'tool-executor',
                toolName: toolCall.name,
                pluginName: fullPluginName,
              });
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
      logger.debug('File management tool result', {
        success: result.success,
        action: result.action,
        requiresPermission: result.requiresPermission,
        hasError: !!result.error,
        error: result.error,
        hasData: !!result.data,
        dataKeys: result.data ? Object.keys(result.data) : [],
      });

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
 * Uses plugin's parseToolCalls method when available, with fallback to legacy detection
 */
export function detectToolCalls(
  response: unknown,
  provider: string
): ToolCallRequest[] {
  logger.debug('Detecting tool calls', { context: 'tool-executor', provider })

  try {
    // Try to use plugin's parseToolCalls method
    const plugin = providerRegistry.getProvider(provider)
    if (plugin?.parseToolCalls) {
      logger.debug('Using plugin parseToolCalls', { context: 'tool-executor', provider })
      const toolCalls = plugin.parseToolCalls(response)
      logger.debug('Detected tool calls via plugin', { context: 'tool-executor', count: toolCalls.length, provider })
      return toolCalls
    }

    // Fallback to legacy detection for backwards compatibility
    logger.debug('Plugin parseToolCalls not available, using fallback', { context: 'tool-executor', provider })

    const toolCalls: ToolCallRequest[] = [];

    // OpenAI format - supports both direct tool_calls and nested in choices[0].message
    if (provider === 'OPENAI') {
      let toolCallsArray = (response as any)?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && (response as any)?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = (response as any).choices[0].message.tool_calls;
      }

      if (toolCallsArray && toolCallsArray.length > 0) {
        for (const toolCall of toolCallsArray) {
          if (toolCall.type === 'function' && toolCall.function) {
            toolCalls.push({
              name: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments || '{}'),
            });
          }
        }
      }
    }

    // Anthropic format
    if (provider === 'ANTHROPIC' && (response as any)?.content) {
      for (const block of (response as any).content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name,
            arguments: block.input || {},
          });
        }
      }
    }

    // Grok format (similar to OpenAI)
    if (provider === 'GROK') {
      let toolCallsArray = (response as any)?.tool_calls;

      // Check nested structure from streaming responses
      if (!toolCallsArray && (response as any)?.choices?.[0]?.message?.tool_calls) {
        toolCallsArray = (response as any).choices[0].message.tool_calls;
      }

      if (toolCallsArray && toolCallsArray.length > 0) {
        for (const toolCall of toolCallsArray) {
          if (toolCall.type === 'function' && toolCall.function) {
            toolCalls.push({
              name: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments || '{}'),
            });
          }
        }
      }
    }

    // Google/Gemini format
    if (provider === 'GOOGLE' && (response as any)?.candidates?.[0]?.content?.parts) {
      const parts = (response as any).candidates[0].content.parts;
      for (const part of parts) {
        if (part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            arguments: part.functionCall.args || {},
          });
        }
      }
    }

    logger.debug('Detected tool calls via fallback', { context: 'tool-executor', count: toolCalls.length, provider })
    return toolCalls;
  } catch (error) {
    logger.error('Error detecting tool calls', { context: 'tool-executor', provider }, error instanceof Error ? error : undefined);
    return [];
  }
}
