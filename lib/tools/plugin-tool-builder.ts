/**
 * Plugin-Based Tool Builder
 *
 * Constructs provider-specific tools by:
 * 1. Taking provider name and enabled tool options
 * 2. Getting the plugin from the provider registry
 * 3. Building an array of universal tools based on what's enabled
 * 4. Calling the plugin's formatTools() method to convert to provider-specific format
 *
 * All provider plugins are expected to implement formatTools().
 *
 * @module tools/plugin-tool-builder
 */

import { logger } from '@/lib/logger';
import { getProvider, getImageProviderConstraints } from '@/lib/plugins/provider-registry';
import { toolRegistry } from '@/lib/plugins/tool-registry';
import {
  imageGenerationToolDefinition,
  webSearchToolDefinition,
  projectInfoToolDefinition,
  fileManagementToolDefinition,
  requestFullContextToolDefinition,
  submitFinalResponseToolDefinition,
  helpSearchToolDefinition,
  helpSettingsToolDefinition,
  helpNavigateToolDefinition,
  rngToolDefinition,
  stateToolDefinition,
  whisperToolDefinition,
  getAllShellToolDefinitions,
} from '@/lib/tools';
import {
  readConversationToolDefinition,
} from '@/lib/tools/read-conversation-tool';
import {
  upsertAnnotationToolDefinition,
} from '@/lib/tools/upsert-annotation-tool';
import {
  deleteAnnotationToolDefinition,
} from '@/lib/tools/delete-annotation-tool';
import {
  searchScriptoriumToolDefinition,
} from '@/lib/tools/search-scriptorium-tool';
import {
  wardrobeListToolDefinition,
} from '@/lib/tools/wardrobe-list-tool';
import {
  wardrobeUpdateOutfitToolDefinition,
} from '@/lib/tools/wardrobe-update-outfit-tool';
import {
  wardrobeCreateItemToolDefinition,
} from '@/lib/tools/wardrobe-create-item-tool';
import { docReadFileTool } from '@/lib/tools/doc-read-file-tool';
import { docWriteFileTool } from '@/lib/tools/doc-write-file-tool';
import { docStrReplaceTool } from '@/lib/tools/doc-str-replace-tool';
import { docInsertTextTool } from '@/lib/tools/doc-insert-text-tool';
import { docGrepTool } from '@/lib/tools/doc-grep-tool';
import { docListFilesTool } from '@/lib/tools/doc-list-files-tool';
import { docReadFrontmatterTool } from '@/lib/tools/doc-read-frontmatter-tool';
import { docUpdateFrontmatterTool } from '@/lib/tools/doc-update-frontmatter-tool';
import { docReadHeadingTool } from '@/lib/tools/doc-read-heading-tool';
import { docUpdateHeadingTool } from '@/lib/tools/doc-update-heading-tool';
import { docMoveFileTool } from '@/lib/tools/doc-move-file-tool';
import { docDeleteFileTool } from '@/lib/tools/doc-delete-file-tool';
import { docCreateFolderTool } from '@/lib/tools/doc-create-folder-tool';
import { docDeleteFolderTool } from '@/lib/tools/doc-delete-folder-tool';
import type { UniversalTool, ImageProviderConstraints } from '@/lib/plugins/interfaces';

/**
 * Apply image provider constraints to the image generation tool
 *
 * This function enriches the tool definition with provider-specific information:
 * - promptingGuidance: Added to the main tool description to help the LLM
 *   understand how to write effective prompts for this specific provider
 * - promptConstraintWarning: Added to the prompt parameter description
 *   for length/format warnings
 *
 * @param baseTool The base image generation tool definition
 * @param constraints The image provider constraints to apply
 * @param moduleLogger Logger instance for debug output
 * @returns Modified tool with constraints applied, or original tool if no constraints
 */
function applyImageConstraintsToTool(
  baseTool: UniversalTool,
  constraints: ImageProviderConstraints | null,
  moduleLogger: ReturnType<typeof logger.child>
): UniversalTool {
  // If no constraints at all, return the base tool unchanged
  if (!constraints) {
    return baseTool;
  }

  const hasGuidance = !!constraints.promptingGuidance;
  const hasWarning = !!constraints.promptConstraintWarning;

  // If no relevant constraints, return unchanged
  if (!hasGuidance && !hasWarning) {
    return baseTool;
  }

  moduleLogger.debug('Applying image provider constraints to tool', {
    hasGuidance,
    hasWarning,
  });

  let result = { ...baseTool };
  let functionDef = { ...baseTool.function };

  // Apply prompting guidance to the main tool description
  if (hasGuidance) {
    const existingToolDescription = functionDef.description || '';
    functionDef = {
      ...functionDef,
      description: existingToolDescription +
        '\n\n**Provider-Specific Prompting Guidance:**\n' +
        constraints.promptingGuidance,
    };
  }

  // Apply prompt constraint warning to the prompt parameter
  if (hasWarning) {
    const properties = functionDef.parameters.properties as Record<string, Record<string, string>>;
    const existingPromptDescription = properties.prompt?.description || '';

    functionDef = {
      ...functionDef,
      parameters: {
        ...functionDef.parameters,
        properties: {
          ...functionDef.parameters.properties,
          prompt: {
            ...properties.prompt,
            description: existingPromptDescription + ' ' + constraints.promptConstraintWarning,
          },
        },
      },
    };
  }

  result.function = functionDef;
  return result;
}

/**
 * Options for building tools for a provider
 */
export interface BuildToolsOptions {
  /** Whether to enable image generation tool */
  imageGeneration?: boolean;

  /** The image provider type (e.g., 'GROK', 'OPENAI') */
  imageProviderType?: string;

  /** Whether to enable web search tool */
  webSearch?: boolean;

  /** Whether to enable project info tool */
  projectInfo?: boolean;

  /** Whether to enable file management tool (always enabled by default) */
  fileManagement?: boolean;

  /** Whether to enable request_full_context tool (enabled when context compression is active) */
  requestFullContext?: boolean;

  /** Whether to enable help search tool (gated by character help tools setting) */
  helpSearch?: boolean;

  /** Whether to enable help settings tool (gated by character help tools setting) */
  helpSettings?: boolean;

  /** Whether to enable help navigate tool (gated by character help tools setting) */
  helpNavigate?: boolean;

  /** Whether to enable RNG (random number generator) tool (enabled by default) */
  rng?: boolean;

  /** Whether to enable state (persistent state management) tool (enabled by default) */
  state?: boolean;

  /** Whether to enable whisper tool (for multi-character private messaging) */
  whisper?: boolean;

  /** Whether to enable list_wardrobe tool (gated by canDressThemselves) */
  wardrobeList?: boolean;

  /** Whether to enable update_outfit_item tool (gated by canDressThemselves) */
  wardrobeUpdateOutfit?: boolean;

  /** Whether to enable create_wardrobe_item tool (gated by canCreateOutfits) */
  wardrobeCreateItem?: boolean;

  /** Whether to enable submit_final_response tool (for agent mode) */
  agentMode?: boolean;

  /** Whether to enable shell interactivity tools (only in VM/Docker environments) */
  shellInteractivity?: boolean;

  /** Whether to enable document editing tools (Scriptorium Phase 3.3) */
  documentEditing?: boolean;

  /** Whether to include tools from the tool registry (plugin tools) */
  includePluginTools?: boolean;

  /** Tool configurations for plugin tools (keyed by tool name) */
  toolConfigs?: Map<string, Record<string, unknown>>;
}

/**
 * Build tools for a specific provider using plugin-based formatting
 *
 * This function:
 * 1. Builds an array of universal tools based on enabled options
 * 2. Gets the provider plugin from the registry
 * 3. If the plugin has formatTools(), converts tools to provider-specific format
 * 4. If not, falls back to old behavior (returns tools in OpenAI format)
 *
 * @param providerName The provider name (e.g., 'OPENAI', 'ANTHROPIC', 'GOOGLE')
 * @param options Configuration for which tools to include
 * @returns Array of tools formatted for the provider (or empty array if no provider/tools)
 *
 * @example
 * ```typescript
 * const tools = buildToolsForProvider('OPENAI', {
 *   imageGeneration: true,
 *   imageProviderType: 'OPENAI',
 *   webSearch: true,
 * });
 * ```
 */
export async function buildToolsForProvider(
  providerName: string,
  options: BuildToolsOptions
): Promise<unknown[]> {
  const logger_ = logger.child({
    module: 'plugin-tool-builder',
    provider: providerName,
  });

  logger_.debug('buildToolsForProvider called', {
    options: {
      imageGeneration: options.imageGeneration,
      webSearch: options.webSearch,
      projectInfo: options.projectInfo,
      fileManagement: options.fileManagement,
      requestFullContext: options.requestFullContext,
      agentMode: options.agentMode,
      helpSearch: options.helpSearch,
      helpSettings: options.helpSettings,
      helpNavigate: options.helpNavigate,
      rng: options.rng,
      state: options.state,
      whisper: options.whisper,
      wardrobeList: options.wardrobeList,
      wardrobeUpdateOutfit: options.wardrobeUpdateOutfit,
      wardrobeCreateItem: options.wardrobeCreateItem,
      shellInteractivity: options.shellInteractivity,
      documentEditing: options.documentEditing,
      includePluginTools: options.includePluginTools,
    },
  });

  // Step 1: Build array of universal tools based on enabled options
  const universalTools: UniversalTool[] = [];

  // Add image generation tool if enabled
  if (options.imageGeneration) {
    const baseTool = imageGenerationToolDefinition as UniversalTool;
    const constraints = options.imageProviderType
      ? getImageProviderConstraints(options.imageProviderType)
      : null;

    const imageTool = applyImageConstraintsToTool(baseTool, constraints, logger_);
    universalTools.push(imageTool);
  }

  // Add web search tool if enabled
  if (options.webSearch) {
    universalTools.push(webSearchToolDefinition as UniversalTool);
  }

  // Add project info tool if enabled
  if (options.projectInfo) {
    universalTools.push(projectInfoToolDefinition as UniversalTool);
  }

  // Add file management tool if enabled (defaults to true when not specified)
  if (options.fileManagement !== false) {
    universalTools.push(fileManagementToolDefinition as UniversalTool);
  }

  // Add request_full_context tool if enabled (for context compression bypass)
  if (options.requestFullContext) {
    universalTools.push(requestFullContextToolDefinition as UniversalTool);
  }

  // Add help search tool if enabled (gated by character help tools setting)
  if (options.helpSearch) {
    universalTools.push(helpSearchToolDefinition as UniversalTool);
  }

  // Add help settings tool if enabled (gated by character help tools setting)
  if (options.helpSettings) {
    universalTools.push(helpSettingsToolDefinition as UniversalTool);
  }

  // Add help navigate tool if enabled (gated by character help tools setting)
  if (options.helpNavigate) {
    universalTools.push(helpNavigateToolDefinition as UniversalTool);
  }

  // Add RNG tool if enabled (defaults to true when not specified)
  if (options.rng !== false) {
    universalTools.push(rngToolDefinition as UniversalTool);
  }

  // Add state tool if enabled (defaults to true when not specified)
  if (options.state !== false) {
    universalTools.push(stateToolDefinition as UniversalTool);
  }

  // Scriptorium tools (always enabled - conversation reading, annotations, and search)
  universalTools.push(readConversationToolDefinition as UniversalTool);
  universalTools.push(upsertAnnotationToolDefinition as UniversalTool);
  universalTools.push(deleteAnnotationToolDefinition as UniversalTool);
  universalTools.push(searchScriptoriumToolDefinition as UniversalTool);

  // Add whisper tool if enabled (multi-character chats only)
  if (options.whisper) {
    universalTools.push(whisperToolDefinition as UniversalTool);
  }

  // Add wardrobe tools if enabled (gated by character wardrobe flags)
  if (options.wardrobeList) {
    universalTools.push(wardrobeListToolDefinition as UniversalTool);
  }
  if (options.wardrobeUpdateOutfit) {
    universalTools.push(wardrobeUpdateOutfitToolDefinition as UniversalTool);
  }
  if (options.wardrobeCreateItem) {
    universalTools.push(wardrobeCreateItemToolDefinition as UniversalTool);
  }

  // Add submit_final_response tool if agent mode is enabled
  if (options.agentMode) {
    universalTools.push(submitFinalResponseToolDefinition as UniversalTool);
  }

  // Add document editing tools if enabled (Scriptorium Phase 3.3)
  if (options.documentEditing) {
    universalTools.push(docReadFileTool as UniversalTool);
    universalTools.push(docWriteFileTool as UniversalTool);
    universalTools.push(docStrReplaceTool as UniversalTool);
    universalTools.push(docInsertTextTool as UniversalTool);
    universalTools.push(docGrepTool as UniversalTool);
    universalTools.push(docListFilesTool as UniversalTool);
    universalTools.push(docReadFrontmatterTool as UniversalTool);
    universalTools.push(docUpdateFrontmatterTool as UniversalTool);
    universalTools.push(docReadHeadingTool as UniversalTool);
    universalTools.push(docUpdateHeadingTool as UniversalTool);
    universalTools.push(docMoveFileTool as UniversalTool);
    universalTools.push(docDeleteFileTool as UniversalTool);
    universalTools.push(docCreateFolderTool as UniversalTool);
    universalTools.push(docDeleteFolderTool as UniversalTool);
  }

  // Add shell interactivity tools if enabled (only in VM/Docker environments)
  if (options.shellInteractivity) {
    const shellTools = getAllShellToolDefinitions();
    universalTools.push(...(shellTools as UniversalTool[]));
  }

  // Add plugin tools if enabled (defaults to true when not specified)
  if (options.includePluginTools !== false) {
    // Get configured tool definitions from the tool registry (async for multi-tool plugins)
    const toolConfigs = options.toolConfigs || new Map();
    const pluginToolDefs = await toolRegistry.getConfiguredToolDefinitions(toolConfigs);

    if (pluginToolDefs.length > 0) {
      universalTools.push(...pluginToolDefs);
    }
  }

  // If no tools are enabled, return empty array
  if (universalTools.length === 0) {
    return [];
  }

  // Log the tools being built
  logger_.info('Built universal tools', {
    count: universalTools.length,
    toolNames: universalTools.map(t => t.function.name),
  });

  // Step 2: Get the provider plugin from registry
  const plugin = getProvider(providerName);

  if (!plugin) {
    logger_.warn('Provider not found in registry, returning tools in OpenAI format', {
      provider: providerName,
    });
    // Backwards compatibility: return tools in OpenAI format if provider not found
    return universalTools;
  }

  // Step 3 & 4: Check if plugin has formatTools() method
  if (plugin.formatTools && typeof plugin.formatTools === 'function') {
    try {
      // Call plugin's formatTools with the entire array of tools
      const formattedTools = plugin.formatTools(universalTools, {
        imageProviderType: options.imageProviderType,
      });
      return formattedTools;
    } catch (error) {
      logger_.error('Error formatting tools with plugin, falling back to universal format', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Step 5: Fallback to old behavior (return tools in OpenAI format)
      return universalTools;
    }
  }

  // Step 5: Plugin doesn't have formatTools, return tools in universal (OpenAI) format
  // All plugins should implement formatTools() - if not, log a warning
  logger_.warn('Plugin does not have formatTools(), returning tools in universal format', {
    provider: providerName,
  });

  return universalTools;
}
