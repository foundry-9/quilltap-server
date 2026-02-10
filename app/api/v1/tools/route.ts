/**
 * Tools API v1
 *
 * GET /api/v1/tools - List all available LLM tools for per-chat settings
 * GET /api/v1/tools?chatId=xxx - List tools with availability info for a specific chat
 *
 * Returns both built-in tools and plugin-provided tools.
 * Excludes request_full_context which is never user-toggleable.
 *
 * When chatId is provided, includes availability status for context-dependent tools:
 * - generate_image: requires image profile on character participant
 * - project_info: requires chat to be in a project
 * - search_web: requires connection profile to allow web search
 */

import { NextRequest } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { toolRegistry } from '@/lib/plugins/tool-registry';
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler';

/**
 * Built-in tool definitions (these are always available)
 */
const BUILT_IN_TOOLS = [
  {
    id: 'generate_image',
    name: 'Generate Image',
    description: 'Generate images using AI image generation providers',
    source: 'built-in' as const,
    category: 'media',
  },
  {
    id: 'search_memories',
    name: 'Search Memories',
    description: 'Search through character memories and past conversations',
    source: 'built-in' as const,
    category: 'memory',
  },
  {
    id: 'search_web',
    name: 'Search Web',
    description: 'Search the web for current information',
    source: 'built-in' as const,
    category: 'search',
  },
  {
    id: 'project_info',
    name: 'Project Info',
    description: 'Access project information and files',
    source: 'built-in' as const,
    category: 'project',
  },
  {
    id: 'manage_files',
    name: 'Manage Files',
    description: 'Read, write, and manage files in the file system',
    source: 'built-in' as const,
    category: 'files',
  },
  {
    id: 'search_help',
    name: 'Search Help',
    description: 'Search Quilltap help documentation for features, settings, and usage guidance',
    source: 'built-in' as const,
    category: 'help',
  },
  {
    id: 'rng',
    name: 'Random Number Generator',
    description: 'Roll dice, flip coins, or randomly select a chat participant (spin the bottle)',
    source: 'built-in' as const,
    category: 'utility',
  },
  // Note: request_full_context is intentionally excluded - it's a safety valve
  // that should always be available when context compression is enabled
];

export interface AvailableTool {
  id: string;
  name: string;
  description: string;
  source: 'built-in' | 'plugin';
  category?: string;
  pluginName?: string;
  /** Subgroup identifier within the plugin (e.g., MCP server name) */
  subgroupId?: string;
  /** Human-readable subgroup name */
  subgroupDisplayName?: string;
  /** Whether the tool is actually available in the current context (only set when chatId provided) */
  available?: boolean;
  /** Reason why the tool is unavailable (only set when available is false) */
  unavailableReason?: string;
}

/**
 * GET /api/v1/tools
 * GET /api/v1/tools?chatId=xxx
 * List all available LLM tools that can be enabled/disabled per chat
 */
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const chatId = req.nextUrl.searchParams.get('chatId');
    const tools: AvailableTool[] = [...BUILT_IN_TOOLS];

    // If chatId provided, get chat context for availability checks
    let chatContext: {
      hasImageProfile: boolean;
      hasProject: boolean;
      allowsWebSearch: boolean;
    } | null = null;

    if (chatId) {
      try {
        const chat = await repos.chats.findById(chatId);
        if (chat && chat.userId === user.id) {
          // Check for image profile on character participant
          const characterParticipant = chat.participants.find(
            p => p.type === 'CHARACTER' && p.isActive
          );
          const hasImageProfile = !!characterParticipant?.imageProfileId;

          // Check if chat is in a project
          const hasProject = !!chat.projectId;

          // Check if connection profile allows web search
          let allowsWebSearch = false;
          if (characterParticipant?.connectionProfileId) {
            const connectionProfile = await repos.connections.findById(
              characterParticipant.connectionProfileId
            );
            allowsWebSearch = !!connectionProfile?.allowWebSearch;
          }

          chatContext = { hasImageProfile, hasProject, allowsWebSearch };
        }
      } catch (chatError) {
        logger.warn('[Tools v1] Failed to load chat for availability check', {
          chatId,
          error: chatError instanceof Error ? chatError.message : String(chatError),
        });
      }
    }

    // Add plugin tools from the tool registry
    const pluginToolConfigs = new Map<string, Record<string, unknown>>();

    // Load user's plugin configurations to get properly configured tools
    try {
      const userPluginConfigs = await repos.pluginConfigs.findByUserId(user.id);
      for (const config of userPluginConfigs) {
        const toolName = config.pluginName.replace(/^qtap-plugin-/, '');
        pluginToolConfigs.set(toolName, config.config);
      }
    } catch (configError) {
      logger.warn('[Tools v1] Failed to load user plugin configs', {
        userId: user.id,
        error: configError instanceof Error ? configError.message : String(configError),
      });
    }

    // Get configured tool definitions from plugins
    const pluginToolDefs = await toolRegistry.getConfiguredToolDefinitions(pluginToolConfigs);

    for (const toolDef of pluginToolDefs) {
      const toolName = toolDef.function.name;

      // Skip request_full_context - it's not user-toggleable
      if (toolName === 'request_full_context') {
        continue;
      }

      // Skip if this tool is already in built-in tools
      if (BUILT_IN_TOOLS.some(t => t.id === toolName)) {
        continue;
      }

      tools.push({
        id: toolName,
        name: toolDef.function.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: toolDef.function.description || 'Plugin-provided tool',
        source: 'plugin',
        category: 'plugin',
      });
    }

    // Also get metadata from registered plugins for better display names
    const pluginMetadata = toolRegistry.getAllPluginMetadata();
    for (const metadata of pluginMetadata) {
      // Find any tools in our list that might have come from this plugin
      // and enhance them with better metadata
      const existingTool = tools.find(t => t.source === 'plugin' && t.id === metadata.toolName);
      if (existingTool) {
        existingTool.name = metadata.displayName || existingTool.name;
        existingTool.description = metadata.description || existingTool.description;
        existingTool.category = metadata.category || existingTool.category;
        existingTool.pluginName = metadata.toolName;
      }
    }

    // Get tool hierarchy info from plugins that support it
    // This allows grouping tools by subgroup (e.g., MCP server)
    const allPlugins = toolRegistry.getAllPlugins();
    for (const plugin of allPlugins) {
      if (typeof plugin.getToolHierarchy === 'function') {
        try {
          const pluginName = plugin.metadata.toolName;
          const config = pluginToolConfigs.get(pluginName) || {};
          const hierarchy = await plugin.getToolHierarchy(config);

          // Merge hierarchy info into the corresponding tools
          for (const hierarchyInfo of hierarchy) {
            const tool = tools.find(t => t.id === hierarchyInfo.toolId);
            if (tool) {
              tool.pluginName = pluginName;
              tool.subgroupId = hierarchyInfo.subgroupId;
              tool.subgroupDisplayName = hierarchyInfo.subgroupDisplayName;
            }
          }
        } catch (hierarchyError) {
          logger.warn('[Tools v1] Failed to get tool hierarchy from plugin', {
            pluginName: plugin.metadata.toolName,
            error: hierarchyError instanceof Error ? hierarchyError.message : String(hierarchyError),
          });
        }
      }
    }

    // Set availability status for context-dependent tools
    if (chatContext) {
      for (const tool of tools) {
        // Default to available
        tool.available = true;

        // Check specific tool requirements
        switch (tool.id) {
          case 'generate_image':
            if (!chatContext.hasImageProfile) {
              tool.available = false;
              tool.unavailableReason = 'Requires an image generation profile to be configured for the character';
            }
            break;
          case 'project_info':
            if (!chatContext.hasProject) {
              tool.available = false;
              tool.unavailableReason = 'Chat must be associated with a project';
            }
            break;
          case 'search_web':
            if (!chatContext.allowsWebSearch) {
              tool.available = false;
              tool.unavailableReason = 'Web search must be enabled in the connection profile';
            } else if (!isWebSearchConfigured()) {
              tool.available = false;
              tool.unavailableReason = 'No search provider configured. Please add a search provider API key in Settings > API Keys.';
            }
            break;
        }
      }
    }

    return successResponse({
      tools,
      count: tools.length,
    });
  } catch (error) {
    logger.error('[Tools v1] Error listing tools', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list available tools');
  }
});
