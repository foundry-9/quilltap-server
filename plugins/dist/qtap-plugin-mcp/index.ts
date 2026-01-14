/**
 * MCP Server Connector Plugin
 *
 * Connects to MCP (Model Context Protocol) servers via SSE and dynamically
 * exposes their tools to LLMs. Supports multiple server connections with
 * various authentication methods.
 *
 * @module qtap-plugin-mcp
 */

import { logger } from '@/lib/logger';
import type {
  ToolPlugin,
  ToolMetadata,
  ToolExecutionContext,
  ToolExecutionResult,
  UniversalTool,
} from '@quilltap/plugin-types';
import { connectionManager } from './connection-manager';
import { parseServerConfigs } from './security';
import type { MCPPluginConfig } from './types';

const pluginLogger = logger.child({ module: 'qtap-plugin-mcp' });

/**
 * Parse plugin configuration from tool config
 */
function parseConfig(toolConfig: Record<string, unknown>): Partial<MCPPluginConfig> {
  return {
    servers: typeof toolConfig.servers === 'string' ? toolConfig.servers : '[]',
    discoveryTimeout:
      typeof toolConfig.discoveryTimeout === 'number' ? toolConfig.discoveryTimeout : 30,
    autoReconnect: toolConfig.autoReconnect !== false,
    maxReconnectAttempts:
      typeof toolConfig.maxReconnectAttempts === 'number' ? toolConfig.maxReconnectAttempts : 3,
  };
}

/**
 * Check if the plugin has valid configuration with at least one enabled server
 */
function hasValidConfiguration(toolConfig: Record<string, unknown>): boolean {
  const serversJson = typeof toolConfig.servers === 'string' ? toolConfig.servers : '[]';
  const { servers, errors } = parseServerConfigs(serversJson);

  if (errors.length > 0) {
    pluginLogger.debug('Configuration validation errors', { errors });
  }

  // Need at least one enabled server
  const enabledServers = servers.filter((s) => s.enabled);
  return enabledServers.length > 0;
}

/**
 * Initialize the connection manager on first use
 */
let initialized = false;

async function ensureInitialized(toolConfig: Record<string, unknown>): Promise<void> {
  if (initialized) return;

  const config = parseConfig(toolConfig);

  pluginLogger.info('Initializing MCP plugin', {
    hasServers: config.servers !== '[]',
  });

  try {
    await connectionManager.initialize(config);
    initialized = true;

    const stats = connectionManager.getStats();
    pluginLogger.info('MCP plugin initialized', {
      serverCount: stats.serverCount,
      readyCount: stats.readyCount,
      toolCount: stats.toolCount,
    });
  } catch (error) {
    pluginLogger.error('Failed to initialize MCP plugin', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Plugin metadata
 */
const metadata: ToolMetadata = {
  toolName: 'mcp_connector',
  displayName: 'MCP Server Connector',
  description: 'Connects to MCP servers and exposes their tools to LLMs',
  category: 'integration',
};

/**
 * Placeholder tool definition (not used - we implement getMultipleToolDefinitions)
 */
const placeholderToolDefinition: UniversalTool = {
  type: 'function',
  function: {
    name: 'mcp_connector',
    description:
      'MCP Server Connector - this tool provides access to tools from connected MCP servers',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

/**
 * MCP Server Connector Plugin Implementation
 *
 * This is a multi-tool plugin that dynamically provides tools from connected
 * MCP servers. It implements getMultipleToolDefinitions and executeByName
 * instead of the standard single-tool methods.
 */
export const plugin: ToolPlugin = {
  metadata,

  /**
   * Get the placeholder tool definition
   * (Not used - getMultipleToolDefinitions takes precedence)
   */
  getToolDefinition(): UniversalTool {
    return placeholderToolDefinition;
  },

  /**
   * Get all tool definitions from connected MCP servers
   *
   * This is called by the tool registry to get all available tools.
   * Each MCP tool is exposed as a separate tool with the naming convention:
   * mcp_{servername}_{toolname}
   */
  getMultipleToolDefinitions(): UniversalTool[] {
    const tools = connectionManager.getAllToolDefinitions();

    pluginLogger.debug('Getting multiple tool definitions', {
      toolCount: tools.length,
    });

    return tools;
  },

  /**
   * Validate input for any MCP tool
   *
   * Basic validation - detailed validation happens on the MCP server.
   */
  validateInput(input: unknown): boolean {
    return typeof input === 'object' && input !== null;
  },

  /**
   * Execute the placeholder tool (not used for multi-tool plugins)
   */
  async execute(
    _input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    return {
      success: false,
      error:
        'This is a multi-tool plugin. Use specific MCP tools like mcp_servername_toolname instead.',
    };
  },

  /**
   * Execute a specific tool by name
   *
   * Routes the execution to the appropriate MCP server based on the tool name prefix.
   */
  async executeByName(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    // Ensure plugin is initialized
    await ensureInitialized(context.toolConfig);

    pluginLogger.debug('Executing MCP tool', {
      toolName,
      userId: context.userId,
      chatId: context.chatId,
    });

    const result = await connectionManager.executeTool(toolName, input);

    pluginLogger.debug('MCP tool execution complete', {
      toolName,
      success: result.success,
      serverId: result.serverId,
      executionTimeMs: result.executionTimeMs,
    });

    return {
      success: result.success,
      result: result.content,
      error: result.error,
      formattedText: result.content,
      metadata: {
        serverId: result.serverId,
        originalToolName: result.originalToolName,
        executionTimeMs: result.executionTimeMs,
      },
    };
  },

  /**
   * Format results for LLM consumption
   */
  formatResults(result: ToolExecutionResult): string {
    if (result.formattedText) {
      return result.formattedText;
    }

    if (result.error) {
      return `Error: ${result.error}`;
    }

    if (result.result !== undefined) {
      return typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2);
    }

    return '';
  },

  /**
   * Check if the plugin is properly configured
   *
   * Requires at least one enabled MCP server with valid configuration.
   */
  isConfigured(config: Record<string, unknown>): boolean {
    const isConfigured = hasValidConfiguration(config);

    pluginLogger.debug('Checking configuration', {
      isConfigured,
    });

    return isConfigured;
  },

  /**
   * Get default configuration
   */
  getDefaultConfig(): Record<string, unknown> {
    return {
      servers: '[]',
      discoveryTimeout: 30,
      autoReconnect: true,
      maxReconnectAttempts: 3,
    };
  },

  /**
   * Handle configuration changes
   *
   * Reconfigures server connections when user settings change.
   */
  async onConfigurationChange(config: Record<string, unknown>): Promise<void> {
    pluginLogger.info('Configuration changed, reconfiguring');

    const parsedConfig = parseConfig(config);

    try {
      await connectionManager.reconfigure(parsedConfig.servers || '[]');

      // Update other settings
      const stats = connectionManager.getStats();
      pluginLogger.info('Reconfiguration complete', {
        serverCount: stats.serverCount,
        readyCount: stats.readyCount,
        toolCount: stats.toolCount,
      });
    } catch (error) {
      pluginLogger.error('Reconfiguration failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

// Export for standard plugin loading
export default { plugin };
