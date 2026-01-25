/**
 * Tool Registry
 *
 * Singleton registry for managing LLM tool plugins.
 * Provides centralized access to tool plugins, metadata, and execution methods.
 *
 * All tool plugins use the multi-tool pattern - they provide an array of tools
 * via getToolDefinitions() and execute tools via executeByName().
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
  /** All registered tool plugins */
  plugins: Map<string, ToolPlugin>;
  errors: Map<string, string>;
  lastInitTime: Date | null;
}

// ============================================================================
// GLOBAL STATE PERSISTENCE
// ============================================================================

// Extend globalThis type for our tool registry state
// This ensures state persists across Next.js hot module reloads in development
declare global {
  var __quilltapToolRegistryState: ToolRegistryState | undefined;
}

/**
 * Get or create the global registry state
 * Using global ensures state persists across Next.js module reloads
 */
function getGlobalState(): ToolRegistryState {
  if (!global.__quilltapToolRegistryState) {
    global.__quilltapToolRegistryState = {
      initialized: false,
      plugins: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
  }
  return global.__quilltapToolRegistryState;
}

// ============================================================================
// REGISTRY SINGLETON
// ============================================================================

class ToolRegistry {
  private get state(): ToolRegistryState {
    return getGlobalState();
  }

  private logger = logger.child({
    module: 'tool-registry',
  });

  /**
   * Register a tool plugin
   *
   * @param plugin The tool plugin to register
   * @throws Error if plugin with same name is already registered
   */
  registerPlugin(plugin: ToolPlugin): void {
    const pluginName = plugin.metadata.toolName;

    if (this.state.plugins.has(pluginName)) {
      const error = `Plugin '${pluginName}' is already registered`;
      this.logger.warn(error);
      throw new Error(error);
    }

    // Validate that plugin has required methods (new pattern)
    // or deprecated methods (for backwards compatibility)
    const hasNewPattern = typeof plugin.getToolDefinitions === 'function' && typeof plugin.executeByName === 'function';
    const hasLegacyMultiTool = typeof plugin.getMultipleToolDefinitions === 'function' && typeof plugin.executeByName === 'function';
    const hasLegacySingleTool = typeof plugin.getToolDefinition === 'function' && typeof plugin.execute === 'function';

    if (!hasNewPattern && !hasLegacyMultiTool && !hasLegacySingleTool) {
      const error = `Plugin '${pluginName}' must implement getToolDefinitions/executeByName or legacy methods`;
      this.logger.error(error);
      throw new Error(error);
    }

    this.state.plugins.set(pluginName, plugin);
  }

  /**
   * Get a specific plugin by name
   *
   * @param name The plugin name
   * @returns The plugin or null if not found
   */
  getPlugin(name: string): ToolPlugin | null {
    return this.state.plugins.get(name) || null;
  }

  /**
   * Get all registered plugins
   *
   * @returns Array of all registered plugins
   */
  getAllPlugins(): ToolPlugin[] {
    return Array.from(this.state.plugins.values());
  }

  /**
   * Check if a plugin is registered
   *
   * @param name The plugin name
   * @returns true if plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this.state.plugins.has(name);
  }

  /**
   * Get list of all registered plugin names
   *
   * @returns Array of plugin names
   */
  getPluginNames(): string[] {
    return Array.from(this.state.plugins.keys());
  }

  /**
   * Get metadata for a specific plugin
   *
   * @param name The plugin name
   * @returns The plugin metadata or null if not found
   */
  getPluginMetadata(name: string): ToolMetadata | null {
    const plugin = this.getPlugin(name);
    return plugin?.metadata || null;
  }

  /**
   * Get metadata for all registered plugins
   *
   * @returns Array of plugin metadata objects
   */
  getAllPluginMetadata(): ToolMetadata[] {
    return this.getAllPlugins().map(p => p.metadata);
  }

  /**
   * Get tool definitions from a plugin
   *
   * Handles both new pattern (getToolDefinitions) and legacy patterns.
   *
   * @param plugin The plugin
   * @param config User configuration
   * @returns Promise resolving to array of tool definitions
   */
  private async getPluginToolDefinitions(
    plugin: ToolPlugin,
    config: Record<string, unknown>
  ): Promise<UniversalTool[]> {
    // New pattern: getToolDefinitions
    if (typeof plugin.getToolDefinitions === 'function') {
      return plugin.getToolDefinitions(config);
    }

    // Legacy pattern: getMultipleToolDefinitions
    if (typeof plugin.getMultipleToolDefinitions === 'function') {
      return plugin.getMultipleToolDefinitions(config);
    }

    // Legacy pattern: getToolDefinition (single tool)
    if (typeof plugin.getToolDefinition === 'function') {
      return [plugin.getToolDefinition()];
    }

    return [];
  }

  /**
   * Execute a tool via a plugin
   *
   * Handles both new pattern (executeByName) and legacy pattern (execute).
   *
   * @param plugin The plugin
   * @param toolName The tool name
   * @param input The input arguments
   * @param context The execution context
   * @returns Promise resolving to execution result
   */
  private async executePluginTool(
    plugin: ToolPlugin,
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // New pattern: executeByName
    if (typeof plugin.executeByName === 'function') {
      return plugin.executeByName(toolName, input, context);
    }

    // Legacy pattern: execute (for single-tool plugins)
    if (typeof plugin.execute === 'function') {
      return plugin.execute(input, context);
    }

    return {
      success: false,
      error: `Plugin '${plugin.metadata.toolName}' does not implement execution methods`,
    };
  }

  /**
   * Get tool definitions for tools that are properly configured
   *
   * Filters out tools that require configuration but haven't been configured.
   *
   * @param toolConfigs Map of plugin name to user configuration
   * @returns Promise resolving to array of tool definitions for configured tools
   */
  async getConfiguredToolDefinitions(
    toolConfigs: Map<string, Record<string, unknown>>
  ): Promise<UniversalTool[]> {
    const tools: UniversalTool[] = [];

    for (const [pluginName, plugin] of this.state.plugins) {
      const config = toolConfigs.get(pluginName) || {};

      // Check if plugin is configured (if it requires configuration)
      if (plugin.isConfigured && !plugin.isConfigured(config)) {
        continue;
      }

      try {
        const pluginTools = await this.getPluginToolDefinitions(plugin, config);

        tools.push(...pluginTools);
      } catch (error) {
        this.logger.error('Error getting tools from plugin', {
          pluginName,
          error: getErrorMessage(error),
        });
      }
    }

    return tools;
  }

  /**
   * Find which plugin owns a tool by checking tool definitions
   *
   * @param toolName The tool name to find
   * @param toolConfigs Map of plugin name to user configuration
   * @returns The plugin and its config, or null if not found
   */
  private async findPluginForTool(
    toolName: string,
    toolConfigs: Map<string, Record<string, unknown>>
  ): Promise<{ plugin: ToolPlugin; config: Record<string, unknown> } | null> {
    for (const [pluginName, plugin] of this.state.plugins) {
      const config = toolConfigs.get(pluginName) || {};

      // Skip if plugin is not configured
      if (plugin.isConfigured && !plugin.isConfigured(config)) {
        continue;
      }

      try {
        const pluginTools = await this.getPluginToolDefinitions(plugin, config);
        const ownsTool = pluginTools.some(t => t.function.name === toolName);

        if (ownsTool) {
          return { plugin, config };
        }
      } catch (error) {
        this.logger.warn('Error checking plugin for tool', {
          toolName,
          pluginName,
          error: getErrorMessage(error),
        });
      }
    }

    return null;
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
   */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // Build tool configs map from context
    // The context.toolConfig might be a flat config or nested by plugin name
    const toolConfigs = new Map<string, Record<string, unknown>>();

    // First, add all plugin names with their specific configs if nested
    for (const pluginName of this.state.plugins.keys()) {
      const nestedConfig = context.toolConfig[pluginName] as Record<string, unknown> | undefined;
      if (nestedConfig && typeof nestedConfig === 'object') {
        toolConfigs.set(pluginName, nestedConfig);
      } else {
        // Use the full config if not nested
        toolConfigs.set(pluginName, context.toolConfig);
      }
    }

    // Find which plugin owns this tool
    const found = await this.findPluginForTool(toolName, toolConfigs);

    if (!found) {
      const error = `Tool '${toolName}' not found in any registered plugin`;
      this.logger.error(error);
      return {
        success: false,
        error,
      };
    }

    const { plugin, config } = found;

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
      // Execute with plugin-specific config in context
      const pluginContext = {
        ...context,
        toolConfig: config,
      };
      const result = await this.executePluginTool(plugin, toolName, input, pluginContext);

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Tool execution failed', {
        toolName,
        pluginName: plugin.metadata.toolName,
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Format tool results for LLM consumption
   *
   * @param toolName The name of the tool
   * @param result The execution result to format
   * @param toolConfigs Map of plugin name to user configuration
   * @returns Formatted string for LLM consumption
   */
  async formatToolResults(
    toolName: string,
    result: ToolExecutionResult,
    toolConfigs?: Map<string, Record<string, unknown>>
  ): Promise<string> {
    // Try to find the plugin that owns this tool
    const configs = toolConfigs || new Map<string, Record<string, unknown>>();
    const found = await this.findPluginForTool(toolName, configs);

    if (found?.plugin.formatResults) {
      return found.plugin.formatResults(result);
    }

    // Fallback: if result has formattedText, use it directly
    if (result.formattedText) {
      return result.formattedText;
    }

    // Last resort: stringify the result
    return JSON.stringify(result);
  }

  /**
   * Get default configuration for a plugin
   *
   * @param pluginName The plugin name
   * @returns Default configuration or empty object
   */
  getDefaultConfig(pluginName: string): Record<string, unknown> {
    const plugin = this.getPlugin(pluginName);
    return plugin?.getDefaultConfig?.() || {};
  }

  /**
   * Initialize the registry (called by the plugin system)
   *
   * @param plugins Array of tool plugins to register
   */
  async initialize(plugins: ToolPlugin[]): Promise<void> {
    this.logger.info('Initializing tool registry', {
      pluginCount: plugins.length,
    });

    // Clear existing state
    this.state.plugins.clear();
    this.state.errors.clear();

    // Register all plugins
    for (const plugin of plugins) {
      try {
        this.registerPlugin(plugin);
      } catch (error) {
        const pluginName = plugin.metadata.toolName;
        const errorMessage = getErrorMessage(error);
        this.state.errors.set(pluginName, errorMessage);
        this.logger.warn('Failed to register plugin', {
          name: pluginName,
          error: errorMessage,
        });
      }
    }

    this.state.initialized = true;
    this.state.lastInitTime = new Date();

    this.logger.info('Tool registry initialized', {
      registered: this.state.plugins.size,
      errors: this.state.errors.size,
    });
  }

  /**
   * Get registry statistics
   *
   * @returns Statistics about registered plugins
   */
  getStats() {
    return {
      total: this.state.plugins.size,
      errors: this.state.errors.size,
      initialized: this.state.initialized,
      lastInitTime: this.state.lastInitTime?.toISOString() || null,
      plugins: Array.from(this.state.plugins.keys()),
    };
  }

  /**
   * Get all errors from plugin registration
   *
   * @returns Array of registration errors
   */
  getErrors(): Array<{ plugin: string; error: string }> {
    return Array.from(this.state.errors.entries()).map(([plugin, error]) => ({
      plugin,
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
    // Reset the global state entirely
    global.__quilltapToolRegistryState = {
      initialized: false,
      plugins: new Map(),
      errors: new Map(),
      lastInitTime: null,
    };
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
      plugins: Array.from(this.state.plugins.entries()).map(([name, plugin]) => ({
        name,
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        category: plugin.metadata.category,
        hasIcon: !!plugin.renderIcon,
        requiresConfiguration: !!plugin.isConfigured,
      })),
      errors: Array.from(this.state.errors.entries()).map(([plugin, error]) => ({
        plugin,
        error,
      })),
      stats: this.getStats(),
    };
  }

  // ============================================================================
  // BACKWARDS COMPATIBILITY
  // ============================================================================
  // These methods maintain backwards compatibility with code that uses the old
  // registry API. They delegate to the new unified plugin handling.

  /**
   * @deprecated Use registerPlugin instead
   */
  registerTool(plugin: ToolPlugin): void {
    this.registerPlugin(plugin);
  }

  /**
   * @deprecated Use registerPlugin instead
   */
  registerMultiToolPlugin(plugin: ToolPlugin): void {
    this.registerPlugin(plugin);
  }

  /**
   * @deprecated Use getPlugin instead
   */
  getTool(name: string): ToolPlugin | null {
    return this.getPlugin(name);
  }

  /**
   * @deprecated Use getAllPlugins instead
   */
  getAllTools(): ToolPlugin[] {
    return this.getAllPlugins();
  }

  /**
   * @deprecated Use hasPlugin instead
   */
  hasTool(name: string): boolean {
    return this.hasPlugin(name);
  }

  /**
   * @deprecated All plugins now use the multi-tool pattern
   */
  hasMultiToolPlugins(): boolean {
    return this.state.plugins.size > 0;
  }

  /**
   * @deprecated Use getPluginNames instead
   */
  getMultiToolPluginNames(): string[] {
    return this.getPluginNames();
  }

  /**
   * @deprecated Use getPluginNames instead
   */
  getToolNames(): string[] {
    return this.getPluginNames();
  }

  /**
   * @deprecated Use getPluginMetadata instead
   */
  getToolMetadata(name: string): ToolMetadata | null {
    return this.getPluginMetadata(name);
  }

  /**
   * @deprecated Use getAllPluginMetadata instead
   */
  getAllToolMetadata(): ToolMetadata[] {
    return this.getAllPluginMetadata();
  }

  /**
   * @deprecated Use getConfiguredToolDefinitions instead
   */
  getToolDefinitions(): UniversalTool[] {
    // This synchronous method can't work with async getToolDefinitions
    // Return empty and log warning
    this.logger.warn('getToolDefinitions() is deprecated - use getConfiguredToolDefinitions() instead');
    return [];
  }

  /**
   * @deprecated No longer needed - all plugins use unified pattern
   */
  unregisterToolsByPrefix(_toolPrefix: string): number {
    this.logger.warn('unregisterToolsByPrefix() is deprecated and no longer has any effect');
    return 0;
  }

  /**
   * @deprecated No longer needed - all plugins use unified pattern
   */
  getPluginNameForTool(_toolName: string): string | null {
    this.logger.warn('getPluginNameForTool() is deprecated - use findPluginForTool() internally');
    return null;
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
  toolRegistry.registerPlugin(plugin);
}

/**
 * Get a tool plugin by name
 *
 * @param name The plugin name
 * @returns The plugin or null
 */
export function getTool(name: string): ToolPlugin | null {
  return toolRegistry.getPlugin(name);
}

/**
 * Get all registered tool plugins
 *
 * @returns Array of all registered plugins
 */
export function getAllTools(): ToolPlugin[] {
  return toolRegistry.getAllPlugins();
}

/**
 * Check if a plugin is registered
 *
 * @param name The plugin name
 * @returns true if plugin exists
 */
export function hasTool(name: string): boolean {
  return toolRegistry.hasPlugin(name);
}

/**
 * Check if any plugins are registered
 *
 * @returns true if any plugins exist
 */
export function hasMultiToolPlugins(): boolean {
  return toolRegistry.hasMultiToolPlugins();
}

/**
 * Get names of all registered plugins
 *
 * @returns Array of plugin names
 */
export function getMultiToolPluginNames(): string[] {
  return toolRegistry.getPluginNames();
}

/**
 * Get list of plugin names
 *
 * @returns Array of plugin names
 */
export function getToolNames(): string[] {
  return toolRegistry.getPluginNames();
}

/**
 * Get plugin metadata
 *
 * @param name The plugin name
 * @returns Plugin metadata or null
 */
export function getToolMetadata(name: string): ToolMetadata | null {
  return toolRegistry.getPluginMetadata(name);
}

/**
 * Get all plugin metadata
 *
 * @returns Array of metadata for all plugins
 */
export function getAllToolMetadata(): ToolMetadata[] {
  return toolRegistry.getAllPluginMetadata();
}

/**
 * @deprecated Use getConfiguredToolDefinitions instead
 */
export function getToolDefinitions(): UniversalTool[] {
  return toolRegistry.getToolDefinitions();
}

/**
 * Get tool definitions for configured plugins only
 *
 * @param toolConfigs Map of plugin name to user configuration
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
export async function formatToolResults(
  toolName: string,
  result: ToolExecutionResult
): Promise<string> {
  return toolRegistry.formatToolResults(toolName, result);
}

/**
 * Get default configuration for a plugin
 *
 * @param pluginName The plugin name
 * @returns Default configuration
 */
export function getDefaultToolConfig(pluginName: string): Record<string, unknown> {
  return toolRegistry.getDefaultConfig(pluginName);
}

/**
 * Initialize the tool registry
 *
 * @param plugins Array of tool plugins to register
 */
export async function initializeToolRegistry(plugins: ToolPlugin[]): Promise<void> {
  return toolRegistry.initialize(plugins);
}

/**
 * Get registry statistics
 *
 * @returns Statistics about registered plugins
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
 * @deprecated Use registerTool instead
 */
export function registerMultiToolPlugin(plugin: ToolPlugin): void {
  toolRegistry.registerPlugin(plugin);
}

/**
 * @deprecated No longer needed
 */
export function unregisterToolsByPrefix(toolPrefix: string): number {
  return toolRegistry.unregisterToolsByPrefix(toolPrefix);
}

/**
 * Check if a plugin uses the multi-tool pattern
 *
 * @param plugin The plugin to check
 * @returns true (all plugins now use multi-tool pattern)
 * @deprecated All plugins use multi-tool pattern now
 */
export function isMultiToolPlugin(_plugin: ToolPlugin): boolean {
  return true;
}
