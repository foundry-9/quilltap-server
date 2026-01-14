/**
 * Tool Plugin Interface
 *
 * Defines the contract that LLM tool plugins must implement.
 * This interface ensures consistency across all tool implementations
 * and provides metadata needed for UI rendering, configuration, and capability discovery.
 *
 * Tool plugins provide custom tools that LLMs can call during chat interactions,
 * such as curl for HTTP requests, calculators, code execution, etc.
 *
 * @module plugins/interfaces/tool-plugin
 */

import { logger } from '@/lib/logger';

/**
 * Universal tool format for cross-provider compatibility
 * Standardizes on OpenAI's function calling format as the universal baseline
 *
 * @interface UniversalTool
 */
export interface UniversalTool {
  /** Indicates this is a function type tool (OpenAI format) */
  type: 'function';

  function: {
    /** Name of the tool/function */
    name: string;

    /** Description of what the tool does */
    description: string;

    /** Parameters schema in JSON Schema format */
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Tool metadata for UI display and identification
 *
 * @interface ToolMetadata
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
 * Context provided to tool execution
 *
 * Contains information about the current chat session and user,
 * allowing tools to make context-aware decisions.
 *
 * @interface ToolExecutionContext
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
 *
 * @interface ToolExecutionResult
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
 * Main Tool Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded and used
 * by the Quilltap application to provide custom tools for LLM interactions.
 *
 * @interface ToolPlugin
 *
 * @example
 * ```typescript
 * const curlPlugin: ToolPlugin = {
 *   metadata: {
 *     toolName: 'curl',
 *     displayName: 'curl',
 *     description: 'Make HTTP requests to fetch web content',
 *   },
 *   getToolDefinition: () => ({
 *     type: 'function',
 *     function: {
 *       name: 'curl',
 *       description: 'Make HTTP requests...',
 *       parameters: { ... }
 *     }
 *   }),
 *   validateInput: (input) => { ... },
 *   execute: async (input, context) => { ... },
 *   formatResults: (result) => JSON.stringify(result),
 * };
 * ```
 */
export interface ToolPlugin {
  /**
   * Tool metadata for UI display and identification
   */
  metadata: ToolMetadata;

  /**
   * Get the tool definition in universal (OpenAI) format
   *
   * Returns the tool's schema that will be sent to LLMs.
   * This is called when building tool arrays for LLM requests.
   *
   * @returns Tool definition in universal format
   */
  getToolDefinition: () => UniversalTool;

  /**
   * Validate input arguments before execution
   *
   * Checks whether the provided input matches the expected schema.
   * Called before execute() to ensure valid inputs.
   *
   * @param input The input arguments to validate
   * @returns true if valid, false otherwise
   */
  validateInput: (input: unknown) => boolean;

  /**
   * Execute the tool with the given input and context
   *
   * This is the main tool execution logic. It receives the parsed
   * arguments from the LLM and returns the result.
   *
   * @param input The input arguments from the LLM
   * @param context Execution context with user/chat info and config
   * @returns Promise resolving to the execution result
   */
  execute: (
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult>;

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
   * Render the tool icon as a React component (optional)
   *
   * Returns a function that renders the tool's icon.
   * Called by the UI to display tool icons in various places.
   *
   * @param props Component props including optional className for styling
   * @returns JSX Element representing the tool icon
   */
  renderIcon?: (props: { className?: string }) => React.ReactNode;

  // ============================================================================
  // Multi-Tool Plugin Support (optional)
  // ============================================================================
  // These methods enable plugins to provide multiple tools dynamically.
  // Used by plugins like MCP that discover tools from external servers.

  /**
   * Get multiple tool definitions (optional)
   *
   * For plugins that provide multiple tools dynamically (e.g., MCP connector).
   * When implemented, the registry will call this at request time (not startup)
   * to get the current list of tools based on configuration.
   *
   * This allows plugins to discover tools dynamically based on user config
   * (e.g., MCP servers to connect to).
   *
   * @param config User configuration for this plugin
   * @returns Promise resolving to array of tool definitions in universal format
   */
  getMultipleToolDefinitions?: (config: Record<string, unknown>) => Promise<UniversalTool[]>;

  /**
   * Execute a specific tool by name (optional)
   *
   * Required when getMultipleToolDefinitions is implemented.
   * The registry routes execution to this method based on the tool name.
   *
   * @param toolName The name of the tool to execute (as returned by getMultipleToolDefinitions)
   * @param input The input arguments from the LLM
   * @param context Execution context with user/chat info and config
   * @returns Promise resolving to the execution result
   */
  executeByName?: (
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult>;

  /**
   * Called when configuration changes (optional)
   *
   * Allows plugins to refresh their state when user configuration changes.
   * For multi-tool plugins, this may trigger re-discovery of available tools.
   *
   * @param config The updated user configuration
   */
  onConfigurationChange?: (config: Record<string, unknown>) => Promise<void>;
}

/**
 * Standard export type for tool plugins
 *
 * This is the expected export structure from tool plugin modules.
 *
 * @interface ToolPluginExport
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

/**
 * Create a debug logger for tool plugin operations
 *
 * @param toolName The name of the tool for context
 * @returns A logger instance with tool context
 *
 * @internal
 */
export function createToolLogger(toolName: string) {
  return logger.child({
    module: 'plugin-tool',
    tool: toolName,
  });
}
