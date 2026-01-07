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
   *
   * @param toolConfigs Map of tool name to user configuration
   * @returns Array of tool definitions for configured tools
   */
  getConfiguredToolDefinitions(toolConfigs: Map<string, Record<string, unknown>>): UniversalTool[] {
    return this.getAllTools()
      .filter(tool => {
        // If tool doesn't require configuration check, include it
        if (!tool.isConfigured) {
          return true;
        }
        // Otherwise check if it's configured
        const config = toolConfigs.get(tool.metadata.toolName) || {};
        return tool.isConfigured(config);
      })
      .map(tool => tool.getToolDefinition());
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
    const tool = this.getTool(toolName);
    if (!tool) {
      const error = `Tool '${toolName}' not found in registry`;
      this.logger.error(error);
      return {
        success: false,
        error,
      };
    }

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

  /**
   * Format tool results for LLM consumption
   *
   * @param toolName The name of the tool
   * @param result The execution result to format
   * @returns Formatted string for LLM consumption
   */
  formatToolResults(toolName: string, result: ToolExecutionResult): string {
    const tool = this.getTool(toolName);
    if (!tool) {
      return JSON.stringify(result);
    }
    return tool.formatResults(result);
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
   * @param tools Array of tool plugins to register
   */
  async initialize(tools: ToolPlugin[]): Promise<void> {
    this.logger.info('Initializing tool registry', {
      toolCount: tools.length,
    });

    // Clear existing state
    this.state.tools.clear();
    this.state.errors.clear();

    // Register each tool
    for (const tool of tools) {
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

    this.state.initialized = true;
    this.state.lastInitTime = new Date();

    this.logger.info('Tool registry initialized', {
      registered: this.state.tools.size,
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
 * @returns Array of tool definitions
 */
export function getConfiguredToolDefinitions(
  toolConfigs: Map<string, Record<string, unknown>>
): UniversalTool[] {
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
