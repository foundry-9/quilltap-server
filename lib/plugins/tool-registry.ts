/**
 * Tool Registry
 *
 * Singleton registry for managing LLM tool plugins.
 * Provides centralized access to tool plugins, metadata, and execution methods.
 *
 * This registry integrates with the main plugin system, automatically discovering
 * and registering plugins with the TOOL_PROVIDER capability.
 *
 * @module plugins/tool-registry
 */

import { logger } from '@/lib/logger';
import type {
  ToolPlugin,
  ToolMetadata,
  UniversalTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from './interfaces/tool-plugin';
import { getErrorMessage } from '@/lib/errors';

// ============================================================================
// TYPES
// ============================================================================

export interface ToolRegistryState {
  initialized: boolean;
  tools: Map<string, ToolPlugin>;
  /** Multi-tool plugins that provide tools dynamically based on configuration */
  multiToolPlugins: Map<string, ToolPlugin>;
  errors: Map<string, string>;
  lastInitTime: Date | null;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ToolRegistry {
  private state: ToolRegistryState = {
    initialized: false,
    tools: new Map(),
    multiToolPlugins: new Map(),
    errors: new Map(),
    lastInitTime: null,
  };

  private logger = logger.child({
    module: 'tool-registry',
  });

  /**
   * Register a tool plugin
   *
   * @param plugin The tool plugin to register
   * @throws Error if tool with same name is already registered
   */
  registerTool(plugin: ToolPlugin): void {
    const toolName = plugin.metadata.toolName;

    if (this.state.tools.has(toolName)) {
      const error = `Tool '${toolName}' is already registered`;
      this.logger.warn(error);
      throw new Error(error);
    }

    this.state.tools.set(toolName, plugin);
    this.logger.debug('Tool registered', {
      name: toolName,
      displayName: plugin.metadata.displayName,
    });
  }

  /**
   * Register a multi-tool plugin
   *
   * For plugins that implement getMultipleToolDefinitions(), this method
   * stores a reference to the plugin. Tools are dynamically generated when
   * getConfiguredToolDefinitions() is called with user configuration.
   *
   * This allows plugins like MCP to discover tools based on user-configured
   * servers rather than at startup time.
   *
   * @param plugin The multi-tool plugin to register
   * @throws Error if plugin doesn't implement required methods
   */
  registerMultiToolPlugin(plugin: ToolPlugin): void {
    if (!plugin.getMultipleToolDefinitions || !plugin.executeByName) {
      throw new Error(
        'Multi-tool plugin must implement getMultipleToolDefinitions and executeByName'
      );
    }

    const pluginName = plugin.metadata.toolName;

    this.logger.info('Registering multi-tool plugin', {
      pluginName,
    });

    // Store the plugin reference - tools will be generated dynamically
    this.state.multiToolPlugins.set(pluginName, plugin);

    this.logger.debug('Multi-tool plugin registered for dynamic tool generation', {
      pluginName,
    });
  }

  /**
   * Unregister all tools from a multi-tool plugin
   *
   * Used when reconfiguring a multi-tool plugin to remove old tools
   * before registering updated tools.
   *
   * @param toolPrefix Prefix to match tool names (e.g., 'mcp_servername_')
   * @returns Number of tools unregistered
   */
  unregisterToolsByPrefix(toolPrefix: string): number {
    let count = 0;
    const toRemove: string[] = [];

    for (const toolName of this.state.tools.keys()) {
      if (toolName.startsWith(toolPrefix)) {
        toRemove.push(toolName);
      }
    }

    for (const toolName of toRemove) {
      this.state.tools.delete(toolName);
      count++;
      this.logger.debug('Tool unregistered', { toolName });
    }

    if (count > 0) {
      this.logger.info('Tools unregistered by prefix', {
        prefix: toolPrefix,
        count,
      });
    }

    return count;
  }

  /**
   * Get a specific tool plugin by name
   *
   * @param name The tool name (e.g., 'curl')
   * @returns The tool plugin or null if not found
   */
  getTool(name: string): ToolPlugin | null {
    return this.state.tools.get(name) || null;
  }

  /**
   * Get all registered tool plugins
   *
   * @returns Array of all registered tool plugins
   */
  getAllTools(): ToolPlugin[] {
    return Array.from(this.state.tools.values());
  }

  /**
   * Check if a tool is registered
   *
   * @param name The tool name
   * @returns true if tool is registered, false otherwise
   */
  hasTool(name: string): boolean {
    return this.state.tools.has(name);
  }

  /**
   * Check if any multi-tool plugins are registered
   *
   * Multi-tool plugins (like MCP) provide tools dynamically
   * and need special handling for config lookup.
   *
   * @returns true if any multi-tool plugins are registered
   */
  hasMultiToolPlugins(): boolean {
    return this.state.multiToolPlugins.size > 0;
  }

  /**
   * Get names of all registered multi-tool plugins
   *
   * Used for loading configs for all multi-tool plugins.
   *
   * @returns Array of plugin names (e.g., ['mcp'])
   */
  getMultiToolPluginNames(): string[] {
    return Array.from(this.state.multiToolPlugins.keys());
  }

  /**
   * Get list of all registered tool names
   *
   * Useful for populating UI elements and tool selection
   *
   * @returns Array of tool names (e.g., ['curl', 'calculator', ...])
   */
  getToolNames(): string[] {
    return Array.from(this.state.tools.keys());
  }

  /**
   * Get metadata for a specific tool
   *
   * Metadata includes display name, description, category, etc.
   * Useful for UI rendering and tool identification.
   *
   * @param name The tool name
   * @returns The tool metadata or null if not found
   */
  getToolMetadata(name: string): ToolMetadata | null {
    const plugin = this.getTool(name);
    return plugin?.metadata || null;
  }

  /**
   * Get the plugin name that owns a tool
   *
   * For static tools, returns the tool's plugin name.
   * For multi-tool plugins (like MCP), returns the parent plugin name.
   *
   * @param toolName The tool name to look up
   * @returns The plugin name (e.g., 'mcp') or null if not found
   */
  getPluginNameForTool(toolName: string): string | null {
    // Check static tools first
    const staticTool = this.getTool(toolName);
    if (staticTool) {
      return staticTool.metadata.toolName;
    }

    // Check multi-tool plugins
    for (const [pluginName] of this.state.multiToolPlugins) {
      // For multi-tool plugins, the plugin name is the key
      // We can't check tool ownership here without async, so we store that
      // info when tools are discovered. For now, return the plugin name
      // if this tool might belong to it (we'll verify in executeTool)
    }

    // Return null - the tool executor will need to check multi-tool plugins
    return null;
  }

  /**
   * Get metadata for all registered tools
   *
   * @returns Array of tool metadata objects
   */
  getAllToolMetadata(): ToolMetadata[] {
    return this.getAllTools().map(t => t.metadata);
  }

  /**
   * Get tool definitions in universal (OpenAI) format
   *
   * Returns all tool definitions for sending to LLMs.
   * Used by plugin-tool-builder to include plugin tools.
   *
   * @returns Array of tool definitions in universal format
   */
  getToolDefinitions(): UniversalTool[] {
    return this.getAllTools().map(tool => tool.getToolDefinition());
  }

  /**
   * Get tool definitions for tools that are properly configured
   *
   * Filters out tools that require configuration but haven't been configured.
   * Also generates tools dynamically from multi-tool plugins.
   *
   * @param toolConfigs Map of tool name to user configuration
   * @returns Promise resolving to array of tool definitions for configured tools
   */
  async getConfiguredToolDefinitions(toolConfigs: Map<string, Record<string, unknown>>): Promise<UniversalTool[]> {
    const tools: UniversalTool[] = [];

    // Get tools from statically registered plugins
    for (const tool of this.getAllTools()) {
      // If tool doesn't require configuration check, include it
      if (!tool.isConfigured) {
        tools.push(tool.getToolDefinition());
        continue;
      }
      // Otherwise check if it's configured
      const config = toolConfigs.get(tool.metadata.toolName) || {};
      if (tool.isConfigured(config)) {
        tools.push(tool.getToolDefinition());
      }
    }

    // Get tools dynamically from multi-tool plugins
    for (const [pluginName, plugin] of this.state.multiToolPlugins) {
      const config = toolConfigs.get(pluginName) || {};

      // Check if plugin is configured
      if (plugin.isConfigured && !plugin.isConfigured(config)) {
        this.logger.debug('Multi-tool plugin not configured, skipping', { pluginName });
        continue;
      }

      try {
        // Get tools dynamically - pass config to allow discovery (async)
        const pluginTools = await plugin.getMultipleToolDefinitions!(config);

        this.logger.debug('Got dynamic tools from multi-tool plugin', {
          pluginName,
          toolCount: pluginTools.length,
          tools: pluginTools.map(t => t.function.name),
        });

        tools.push(...pluginTools);
      } catch (error) {
        this.logger.error('Error getting tools from multi-tool plugin', {
          pluginName,
          error: getErrorMessage(error),
        });
      }
    }

    return tools;
  }

  /**
   * Execute a tool with the given input and context
   *
   * This is the main entry point for tool execution from the tool-executor.
   *
   * @param toolName The name of the tool to execute
   * @param input The input arguments from the LLM
   * @param context Execution context with user/chat info
   * @returns Promise resolving to the execution result
   * @throws Error if tool not found or execution fails
   */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // First, try to find in statically registered tools
    const tool = this.getTool(toolName);

    if (tool) {
      // Check configuration if required
      if (tool.isConfigured && !tool.isConfigured(context.toolConfig)) {
        const error = `Tool '${toolName}' is not properly configured`;
        this.logger.warn(error, { toolName });
        return {
          success: false,
          error,
        };
      }

      // Validate input
      if (!tool.validateInput(input)) {
        const error = `Invalid input for tool '${toolName}'`;
        this.logger.warn(error, { toolName, input });
        return {
          success: false,
          error,
        };
      }

      try {
        this.logger.debug('Executing tool', {
          toolName,
          inputKeys: Object.keys(input),
        });

        const result = await tool.execute(input, context);

        this.logger.debug('Tool execution completed', {
          toolName,
          success: result.success,
        });

        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Tool execution failed', {
          toolName,
          error: errorMessage,
        });
        return {
          success: false,
          error: errorMessage,
        };
      }
    }

    // Tool not in static registry - check multi-tool plugins
    for (const [pluginName, plugin] of this.state.multiToolPlugins) {
      if (!plugin.executeByName) continue;

      // Get config for this specific plugin
      // Config may be passed directly or nested under the plugin name key
      const rawConfig = context.toolConfig || {};
      const pluginConfig = (rawConfig[pluginName] as Record<string, unknown>) || rawConfig;

      // Skip if plugin is not configured
      if (plugin.isConfigured && !plugin.isConfigured(pluginConfig)) {
        this.logger.debug('Skipping unconfigured multi-tool plugin', {
          pluginName,
          toolName,
        });
        continue;
      }

      // Get tools from this plugin to check if it owns this tool
      try {
        const pluginTools = await plugin.getMultipleToolDefinitions!(pluginConfig);
        const ownsTool = pluginTools.some((t) => t.function.name === toolName);

        if (ownsTool) {
          this.logger.debug('Routing to multi-tool plugin', {
            toolName,
            pluginName,
          });

          // Validate input
          if (!plugin.validateInput(input)) {
            const error = `Invalid input for tool '${toolName}'`;
            this.logger.warn(error, { toolName, input });
            return {
              success: false,
              error,
            };
          }

          try {
            // Pass context with plugin-specific config
            const pluginContext = {
              ...context,
              toolConfig: pluginConfig,
            };
            const result = await plugin.executeByName(toolName, input, pluginContext);

            this.logger.debug('Multi-tool execution completed', {
              toolName,
              pluginName,
              success: result.success,
            });

            return result;
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.logger.error('Multi-tool execution failed', {
              toolName,
              pluginName,
              error: errorMessage,
            });
            return {
              success: false,
              error: errorMessage,
            };
          }
        }
      } catch (error) {
        this.logger.warn('Error checking multi-tool plugin for tool', {
          toolName,
          pluginName,
          error: getErrorMessage(error),
        });
      }
    }

    // Tool not found anywhere
    const error = `Tool '${toolName}' not found in registry or multi-tool plugins`;
    this.logger.error(error);
    return {
      success: false,
      error,
    };
  }

  /**
   * Format tool results for LLM consumption
   *
   * @param toolName The name of the tool
   * @param result The execution result to format
   * @returns Formatted string for LLM consumption
   */
  formatToolResults(toolName: string, result: ToolExecutionResult): string {
    // Check static tools first
    const tool = this.getTool(toolName);
    if (tool) {
      return tool.formatResults(result);
    }

    // Check multi-tool plugins - use their formatResults method
    for (const [, plugin] of this.state.multiToolPlugins) {
      if (plugin.formatResults) {
        return plugin.formatResults(result);
      }
    }

    // Fallback: if result has formattedText, use it directly
    if (result.formattedText) {
      return result.formattedText;
    }

    // Last resort: stringify the result
    return JSON.stringify(result);
  }

  /**
   * Get default configuration for a tool
   *
   * @param toolName The tool name
   * @returns Default configuration or empty object
   */
  getDefaultConfig(toolName: string): Record<string, unknown> {
    const tool = this.getTool(toolName);
    return tool?.getDefaultConfig?.() || {};
  }

  /**
   * Initialize the registry (called by the plugin system)
   *
   * Automatically detects multi-tool plugins (those with getMultipleToolDefinitions)
   * and registers them appropriately.
   *
   * @param tools Array of tool plugins to register
   */
  async initialize(tools: ToolPlugin[]): Promise<void> {
    this.logger.info('Initializing tool registry', {
      toolCount: tools.length,
    });

    // Clear existing state
    this.state.tools.clear();
    this.state.errors.clear();

    // Separate single-tool and multi-tool plugins
    const singleToolPlugins: ToolPlugin[] = [];
    const multiToolPlugins: ToolPlugin[] = [];

    for (const plugin of tools) {
      if (plugin.getMultipleToolDefinitions && plugin.executeByName) {
        multiToolPlugins.push(plugin);
      } else {
        singleToolPlugins.push(plugin);
      }
    }

    // Register single-tool plugins
    for (const tool of singleToolPlugins) {
      try {
        this.registerTool(tool);
      } catch (error) {
        const toolName = tool.metadata.toolName;
        const errorMessage = getErrorMessage(error);
        this.state.errors.set(toolName, errorMessage);
        this.logger.warn('Failed to register tool', {
          name: toolName,
          error: errorMessage,
        });
      }
    }

    // Register multi-tool plugins
    for (const plugin of multiToolPlugins) {
      try {
        this.registerMultiToolPlugin(plugin);
      } catch (error) {
        const pluginName = plugin.metadata.toolName;
        const errorMessage = getErrorMessage(error);
        this.state.errors.set(pluginName, errorMessage);
        this.logger.warn('Failed to register multi-tool plugin', {
          name: pluginName,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();

    this.logger.info('Tool registry initialized', {
      registered: this.state.tools.size,
      singleToolPlugins: singleToolPlugins.length,
      multiToolPlugins: multiToolPlugins.length,
      errors: this.state.errors.size,
    });
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered tools
   */
  getStats() {
    return {
      total: this.state.tools.size,
      errors: this.state.errors.size,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      tools: Array.from(this.state.tools.keys()),
    };
  }

  /**
   * Get all errors from tool registration
   *
   * @returns Array of registration errors
   */
  getErrors(): Array<{ tool: string; error: string }> {
    return Array.from(this.state.errors.entries()).map(([tool, error]) => ({
      tool,
      error,
    }));
  }

  /**
   * Check if registry is initialized
   *
   * @returns true if registry has been initialized
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * Reset the registry (for testing)
   *
   * @internal
   */
  reset(): void {
    this.state.initialized = false;
    this.state.tools.clear();
    this.state.errors.clear();
    this.state.lastInitTime = null;
    this.logger.debug('Tool registry reset');
  }

  /**
   * Export registry state for debugging/admin UI
   *
   * @returns Complete registry state
   */
  exportState() {
    return {
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      tools: Array.from(this.state.tools.entries()).map(([name, plugin]) => ({
        name,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        category: plugin.metadata.category,
        hasIcon: !!plugin.renderIcon,
        requiresConfiguration: !!plugin.isConfigured,
      })),
      errors: Array.from(this.state.errors.entries()).map(([tool, error]) => ({
        tool,
        error,
      })),
      stats: this.getStats(),
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global tool registry instance
 */
export const toolRegistry = new ToolRegistry();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a tool plugin
 *
 * @param plugin The tool plugin to register
 */
export function registerTool(plugin: ToolPlugin): void {
  toolRegistry.registerTool(plugin);
}

/**
 * Get a tool plugin by name
 *
 * @param name The tool name
 * @returns The tool plugin or null
 */
export function getTool(name: string): ToolPlugin | null {
  return toolRegistry.getTool(name);
}

/**
 * Get all registered tool plugins
 *
 * @returns Array of all registered tools
 */
export function getAllTools(): ToolPlugin[] {
  return toolRegistry.getAllTools();
}

/**
 * Check if a tool is registered
 *
 * @param name The tool name
 * @returns true if tool exists
 */
export function hasTool(name: string): boolean {
  return toolRegistry.hasTool(name);
}

/**
 * Check if any multi-tool plugins are registered
 *
 * @returns true if any multi-tool plugins exist
 */
export function hasMultiToolPlugins(): boolean {
  return toolRegistry.hasMultiToolPlugins();
}

/**
 * Get names of all registered multi-tool plugins
 *
 * @returns Array of plugin names
 */
export function getMultiToolPluginNames(): string[] {
  return toolRegistry.getMultiToolPluginNames();
}

/**
 * Get list of tool names
 *
 * @returns Array of tool names
 */
export function getToolNames(): string[] {
  return toolRegistry.getToolNames();
}

/**
 * Get tool metadata
 *
 * @param name The tool name
 * @returns Tool metadata or null
 */
export function getToolMetadata(name: string): ToolMetadata | null {
  return toolRegistry.getToolMetadata(name);
}

/**
 * Get all tool metadata
 *
 * @returns Array of metadata for all tools
 */
export function getAllToolMetadata(): ToolMetadata[] {
  return toolRegistry.getAllToolMetadata();
}

/**
 * Get all tool definitions in universal format
 *
 * @returns Array of tool definitions
 */
export function getToolDefinitions(): UniversalTool[] {
  return toolRegistry.getToolDefinitions();
}

/**
 * Get tool definitions for configured tools only
 *
 * @param toolConfigs Map of tool name to user configuration
 * @returns Promise resolving to array of tool definitions
 */
export async function getConfiguredToolDefinitions(
  toolConfigs: Map<string, Record<string, unknown>>
): Promise<UniversalTool[]> {
  return toolRegistry.getConfiguredToolDefinitions(toolConfigs);
}

/**
 * Execute a tool
 *
 * @param toolName The tool name
 * @param input The input arguments
 * @param context Execution context
 * @returns Execution result
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return toolRegistry.executeTool(toolName, input, context);
}

/**
 * Format tool results for LLM
 *
 * @param toolName The tool name
 * @param result The execution result
 * @returns Formatted string
 */
export function formatToolResults(toolName: string, result: ToolExecutionResult): string {
  return toolRegistry.formatToolResults(toolName, result);
}

/**
 * Get default configuration for a tool
 *
 * @param toolName The tool name
 * @returns Default configuration
 */
export function getDefaultToolConfig(toolName: string): Record<string, unknown> {
  return toolRegistry.getDefaultConfig(toolName);
}

/**
 * Initialize the tool registry
 *
 * @param tools Array of tool plugins to register
 */
export async function initializeToolRegistry(tools: ToolPlugin[]): Promise<void> {
  return toolRegistry.initialize(tools);
}

/**
 * Get registry statistics
 *
 * @returns Statistics about registered tools
 */
export function getToolRegistryStats() {
  return toolRegistry.getStats();
}

/**
 * Get registry errors
 *
 * @returns Array of registration errors
 */
export function getToolRegistryErrors() {
  return toolRegistry.getErrors();
}

/**
 * Check if registry is initialized
 *
 * @returns true if initialized
 */
export function isToolRegistryInitialized(): boolean {
  return toolRegistry.isInitialized();
}

/**
 * Register a multi-tool plugin
 *
 * For plugins that provide multiple tools dynamically.
 *
 * @param plugin The multi-tool plugin to register
 */
export function registerMultiToolPlugin(plugin: ToolPlugin): void {
  toolRegistry.registerMultiToolPlugin(plugin);
}

/**
 * Unregister tools by prefix
 *
 * Removes all tools whose names start with the given prefix.
 *
 * @param toolPrefix The prefix to match
 * @returns Number of tools unregistered
 */
export function unregisterToolsByPrefix(toolPrefix: string): number {
  return toolRegistry.unregisterToolsByPrefix(toolPrefix);
}

/**
 * Check if a plugin is a multi-tool plugin
 *
 * @param plugin The plugin to check
 * @returns true if plugin implements multi-tool methods
 */
export function isMultiToolPlugin(plugin: ToolPlugin): boolean {
  return !!(plugin.getMultipleToolDefinitions && plugin.executeByName);
}
