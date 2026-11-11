/**
 * Tools API v1
 *
 * GET /api/v1/tools - List all available LLM tools for per-chat settings
 * GET /api/v1/tools?chatId=xxx - List tools with availability info for a specific chat
 *
 * Returns both built-in tools and plugin-provided tools. The built-ins — which
 * are listed, their display metadata, definitions and availability rules — are
 * `BUILT_IN_TOOL_PICKER` (`lib/tools/tool-picker.ts`), beside the tool
 * definitions; this route maps over it and adds the plugin tools.
 *
 * When chatId is provided, each tool carries `available` (and
 * `unavailableReason`) from the picker entry's `requires` list.
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { toolRegistry } from '@/lib/plugins/tool-registry';
import type { UniversalTool } from '@/lib/plugins/interfaces/tool-plugin';
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler';
import {
  BUILT_IN_TOOL_PICKER,
  listedPickerTools,
  toolAvailability,
  type ToolAvailabilityContext,
} from '@/lib/tools/tool-picker';

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
  /** Whether the tool can be invoked directly by the user (false for internal-only tools) */
  userInvocable?: boolean;
  /** JSON Schema for the tool's parameters (only included when includeSchemas=true) */
  parameters?: Record<string, unknown>;
}

/**
 * GET /api/v1/tools
 * GET /api/v1/tools?chatId=xxx
 * List all available LLM tools that can be enabled/disabled per chat
 */
export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const chatId = req.nextUrl.searchParams.get('chatId');
    const includeSchemas = req.nextUrl.searchParams.get('includeSchemas') === 'true';
    // Built-in tools come from the picker table beside their definitions
    // (`lib/tools/tool-picker.ts`); this route only maps over it.
    const tools: AvailableTool[] = listedPickerTools().map(([id, entry]) => ({
      id,
      name: entry.name,
      description: entry.description,
      source: 'built-in' as const,
      category: entry.category,
      userInvocable: true,
      ...(includeSchemas && entry.definition.function.parameters
        ? { parameters: entry.definition.function.parameters }
        : {}),
    }));

    // If chatId provided, get chat context for availability checks
    let chatContext: ToolAvailabilityContext | null = null;

    if (chatId) {
      try {
        const chat = await repos.chats.findById(chatId);
        if (chat && chat.userId === user.id) {
          // Check for image profile on character participant
          const characterParticipant = chat.participants.find(
            p => p.type === 'CHARACTER' && p.isActive
          );
          const hasImageProfile = !!chat.imageProfileId || !!characterParticipant?.imageProfileId;

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

          // Check if chat has multiple active character participants (for whisper)
          const activeCharacterCount = chat.participants.filter(
            p => p.type === 'CHARACTER' && p.isActive
          ).length;
          const isMultiCharacter = activeCharacterCount > 1;

          // Check wardrobe capability flags from character (default: enabled when null)
          let canDressThemselves = true;
          let canCreateOutfits = true;
          let canManageInventory = true;
          if (characterParticipant?.characterId) {
            try {
              const character = await repos.characters.findById(characterParticipant.characterId);
              if (character) {
                canDressThemselves = character.canDressThemselves !== false;
                canCreateOutfits = character.canCreateOutfits !== false;
                canManageInventory = character.canManageInventory !== false;
              }
            } catch (charError) {
              logger.warn('[Tools v1] Failed to load character for wardrobe check', {
                characterId: characterParticipant.characterId,
                error: charError instanceof Error ? charError.message : String(charError),
              });
            }
          }

          // Check if project has linked document stores
          let hasDocumentStores = false;
          if (hasProject && chat.projectId) {
            try {
              const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
              hasDocumentStores = mountLinks.length > 0;
            } catch {
              // Non-critical, default to false
            }
          }

          chatContext = {
            hasImageProfile,
            hasProject,
            hasDocumentStores,
            allowsWebSearch,
            webSearchConfigured: allowsWebSearch && isWebSearchConfigured(),
            isMultiCharacter,
            canDressThemselves,
            canCreateOutfits,
            canManageInventory,
          };
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

    // Iterate plugins individually to track which plugin each tool comes from
    // (Previously used getConfiguredToolDefinitions which lost the plugin→tool mapping,
    // causing multi-tool plugins to have tools without pluginName, which were then
    // silently dropped by the UI hierarchy builder)
    const allPlugins = toolRegistry.getAllPlugins();
    const pluginMetadataMap = new Map<string, { displayName?: string; description?: string; category?: string }>();

    for (const plugin of allPlugins) {
      const pluginName = plugin.metadata.toolName;
      const config = pluginToolConfigs.get(pluginName) || {};

      // Check if plugin is configured (if it requires configuration)
      if (plugin.isConfigured && !plugin.isConfigured(config)) {
        continue;
      }

      // Store metadata for later enhancement
      pluginMetadataMap.set(pluginName, {
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        category: plugin.metadata.category,
      });

      try {
        // Get tool definitions using the same method the registry uses internally
        let pluginToolDefs: UniversalTool[] = [];
        if (typeof plugin.getToolDefinitions === 'function') {
          pluginToolDefs = await plugin.getToolDefinitions(config);
        } else if (typeof plugin.getMultipleToolDefinitions === 'function') {
          pluginToolDefs = await plugin.getMultipleToolDefinitions(config);
        } else if (typeof plugin.getToolDefinition === 'function') {
          pluginToolDefs = [plugin.getToolDefinition()];
        }

        for (const toolDef of pluginToolDefs) {
          const toolName = toolDef.function.name;

          // Skip internal-only tools
          if (toolName === 'request_full_context' || toolName === 'submit_final_response') {
            continue;
          }

          // Skip if this tool is a built-in (listed or deliberately unlisted)
          if (toolName in BUILT_IN_TOOL_PICKER) {
            continue;
          }

          tools.push({
            id: toolName,
            name: toolDef.function.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            description: toolDef.function.description || 'Plugin-provided tool',
            source: 'plugin',
            category: 'plugin',
            pluginName,
            userInvocable: true,
            ...(includeSchemas && toolDef.function.parameters
              ? { parameters: toolDef.function.parameters as Record<string, unknown> }
              : {}),
          });
        }
      } catch (error) {
        logger.error('[Tools v1] Error getting tools from plugin', {
          pluginName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Enhance single-tool plugins with better metadata from plugin registration
    for (const [pluginName, metadata] of pluginMetadataMap) {
      const existingTool = tools.find(t => t.source === 'plugin' && t.id === pluginName);
      if (existingTool) {
        existingTool.name = metadata.displayName || existingTool.name;
        existingTool.description = metadata.description || existingTool.description;
        existingTool.category = metadata.category || existingTool.category;
      }
    }

    // Get tool hierarchy info from plugins that support it
    // This allows grouping tools by subgroup (e.g., MCP server)
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

    // Availability for context-dependent tools: each built-in names its own
    // requirements in the picker table; plugin tools are always available.
    if (chatContext) {
      for (const tool of tools) {
        const entry = tool.source === 'built-in' ? BUILT_IN_TOOL_PICKER[tool.id] : undefined;
        const availability = entry?.listed ? toolAvailability(entry, chatContext) : { available: true as const };
        tool.available = availability.available;
        if (!availability.available) {
          tool.unavailableReason = availability.unavailableReason;
        }
      }
      logger.debug('[Tools v1] Availability resolved', {
        chatId,
        unavailable: tools.filter((t) => t.available === false).length,
      });
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
