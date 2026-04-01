/**
 * Tool Plugin types for Quilltap plugin development
 *
 * Defines the interfaces and types needed to create custom LLM tools
 * as Quilltap plugins.
 *
 * @module @quilltap/plugin-types/plugins/tool
 */

import type { UniversalTool } from '../llm/tools';

/**
 * Tool metadata for UI display and identification
 */
export interface ToolMetadata {
  /** Internal tool name used in LLM function calls (lowercase with underscores) */
  toolName: string;

  /** Human-readable display name for UI */
  displayName: string;

  /** Description of what the tool does (for UI display) */
  description: string;

  /** Category for organizing tools (optional) */
  category?: string;

  /** Icon name or component (optional) */
  icon?: string;
}

/**
 * Hierarchy information for a tool
 *
 * Used by plugins that provide multiple tools from different sources
 * (e.g., MCP plugin with multiple servers) to expose subgroup metadata
 * for hierarchical display in the UI.
 */
export interface ToolHierarchyInfo {
  /** Tool ID (Quilltap tool name) */
  toolId: string;

  /** Subgroup identifier within the plugin (e.g., MCP server name) */
  subgroupId?: string;

  /** Human-readable subgroup name */
  subgroupDisplayName?: string;
}

/**
 * Context provided to tool execution
 *
 * Contains information about the current chat session and user,
 * allowing tools to make context-aware decisions.
 */
export interface ToolExecutionContext {
  /** Current user ID */
  userId: string;

  /** Current chat ID */
  chatId: string;

  /** Project ID if in project context (optional) */
  projectId?: string;

  /** Character ID if tool is called by a character (optional) */
  characterId?: string;

  /** Participant ID of who is calling the tool (for {{me}} resolution) */
  callingParticipantId?: string;

  /** User-configured settings for this tool */
  toolConfig: Record<string, unknown>;
}

/**
 * Result of tool execution
 */
export interface ToolExecutionResult {
  /** Whether the tool execution succeeded */
  success: boolean;

  /** The result data (format depends on the tool) */
  result?: unknown;

  /** Error message if execution failed */
  error?: string;

  /** Formatted text for LLM consumption (optional, if different from result) */
  formattedText?: string;

  /** Additional metadata about the execution */
  metadata?: Record<string, unknown>;
}

/**
 * Tool Plugin Interface
 *
 * All tool plugins use the multi-tool pattern, providing an array of tools
 * (even if it's just one tool). This standardized approach makes it easy
 * to extend plugins with additional tools over time.
 *
 * Plugins implementing this interface can be dynamically loaded and used
 * by Quilltap to provide custom tools for LLM interactions.
 *
 * @example
 * ```typescript
 * import type { ToolPlugin, UniversalTool, ToolExecutionContext, ToolExecutionResult } from '@quilltap/plugin-types';
 *
 * const curlToolDefinition: UniversalTool = {
 *   type: 'function',
 *   function: {
 *     name: 'curl',
 *     description: 'Make HTTP requests...',
 *     parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
 *   }
 * };
 *
 * const curlPlugin: ToolPlugin = {
 *   metadata: {
 *     toolName: 'curl',
 *     displayName: 'curl',
 *     description: 'Make HTTP requests to fetch web content',
 *   },
 *   getToolDefinitions: async () => [curlToolDefinition],
 *   validateInput: (input) => typeof input === 'object' && input !== null && 'url' in input,
 *   executeByName: async (toolName, input, context) => {
 *     // Implementation
 *     return { success: true, result: { ... } };
 *   },
 *   formatResults: (result) => JSON.stringify(result.result, null, 2),
 * };
 *
 * export const plugin = curlPlugin;
 * ```
 */
export interface ToolPlugin {
  /**
   * Tool metadata for UI display and identification
   */
  metadata: ToolMetadata;

  // ============================================================================
  // Required Methods (Multi-Tool Pattern)
  // ============================================================================
  // All tool plugins use these methods to provide one or more tools.

  /**
   * Get tool definitions in universal (OpenAI) format
   *
   * Returns an array of tool definitions that will be sent to LLMs.
   * Even single-tool plugins return an array (with one element).
   *
   * This method is async to allow plugins to perform initialization
   * or network requests during tool discovery (e.g., MCP servers).
   *
   * @param config User configuration for this plugin
   * @returns Promise resolving to array of tool definitions in universal format
   */
  getToolDefinitions: (config: Record<string, unknown>) => Promise<UniversalTool[]>;

  /**
   * Execute a tool by name
   *
   * The registry routes execution to this method based on the tool name.
   * For single-tool plugins, the toolName will match metadata.toolName.
   *
   * @param toolName The name of the tool to execute
   * @param input The input arguments from the LLM
   * @param context Execution context with user/chat info and config
   * @returns Promise resolving to the execution result
   */
  executeByName: (
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult>;

  /**
   * Validate input arguments before execution
   *
   * Checks whether the provided input matches the expected schema.
   * Called before executeByName() to ensure valid inputs.
   *
   * @param input The input arguments to validate
   * @returns true if valid, false otherwise
   */
  validateInput: (input: unknown) => boolean;

  /**
   * Format results for LLM consumption
   *
   * Converts the raw result into a string that will be sent back
   * to the LLM as the tool response.
   *
   * @param result The execution result to format
   * @returns Formatted string for LLM consumption
   */
  formatResults: (result: ToolExecutionResult) => string;

  // ============================================================================
  // Optional Methods
  // ============================================================================

  /**
   * Check if the tool is properly configured (optional)
   *
   * For tools that require user configuration (e.g., API keys, allowlists),
   * this method checks whether the necessary configuration is present.
   *
   * @param config The user's tool configuration
   * @returns true if properly configured, false otherwise
   */
  isConfigured?: (config: Record<string, unknown>) => boolean;

  /**
   * Get default configuration values (optional)
   *
   * Returns the default configuration for this tool.
   * Used when initializing tool settings.
   *
   * @returns Default configuration object
   */
  getDefaultConfig?: () => Record<string, unknown>;

  /**
   * Render the tool icon (optional, deprecated)
   *
   * @deprecated Use the `icon` property with PluginIconData instead
   * @param props Component props including optional className for styling
   * @returns Icon element
   */
  renderIcon?: (props: { className?: string }) => unknown;

  /**
   * Called when configuration changes (optional)
   *
   * Allows plugins to refresh their state when user configuration changes.
   * For multi-tool plugins, this may trigger re-discovery of available tools.
   *
   * @param config The updated user configuration
   */
  onConfigurationChange?: (config: Record<string, unknown>) => Promise<void>;

  /**
   * Get hierarchy information for tools provided by this plugin (optional)
   *
   * For plugins that provide tools from multiple sources (e.g., MCP servers),
   * this returns metadata about each tool's source for hierarchical display.
   *
   * @param config User configuration for this plugin
   * @returns Promise resolving to array of tool hierarchy info
   */
  getToolHierarchy?: (config: Record<string, unknown>) => Promise<ToolHierarchyInfo[]>;

  // ============================================================================
  // Deprecated Methods (for backwards compatibility)
  // ============================================================================
  // These methods are deprecated in favor of the multi-tool pattern above.
  // They may be removed in a future version.

  /**
   * @deprecated Use getToolDefinitions instead. This method is for backwards
   * compatibility only and will be removed in a future version.
   */
  getToolDefinition?: () => UniversalTool;

  /**
   * @deprecated Use executeByName instead. This method is for backwards
   * compatibility only and will be removed in a future version.
   */
  execute?: (
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult>;

  /**
   * @deprecated Use getToolDefinitions instead. This method is for backwards
   * compatibility only and will be removed in a future version.
   */
  getMultipleToolDefinitions?: (config: Record<string, unknown>) => Promise<UniversalTool[]>;
}

/**
 * Standard export type for tool plugins
 *
 * This is the expected export structure from tool plugin modules.
 *
 * @example
 * ```typescript
 * // In plugin-curl/index.ts
 * export const plugin: ToolPlugin = { ... };
 *
 * // Or with the export type:
 * const pluginExport: ToolPluginExport = {
 *   plugin: { ... }
 * };
 * export default pluginExport;
 * ```
 */
export interface ToolPluginExport {
  /** The tool plugin instance */
  plugin: ToolPlugin;
}
