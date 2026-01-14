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
 *
 * Returns a promise that resolves to true if initialization succeeded
 */
let initialized = false;
let lastConfigHash = '';

function getConfigHash(config: Partial<MCPPluginConfig>): string {
  return JSON.stringify(config.servers || '[]');
}

async function ensureInitialized(toolConfig: Record<string, unknown>): Promise<boolean> {
  const config = parseConfig(toolConfig);
  const configHash = getConfigHash(config);

  // If config changed, re-initialize
  if (initialized && configHash !== lastConfigHash) {
    pluginLogger.info('Config changed, re-initializing', {
      oldHash: lastConfigHash.substring(0, 50),
      newHash: configHash.substring(0, 50),
    });
    initialized = false;
  }

  if (initialized) return true;

  // Don't initialize if no servers configured
  if (!config.servers || config.servers === '[]') {
    pluginLogger.debug('No servers configured, skipping initialization');
    return false;
  }

  pluginLogger.info('Initializing MCP plugin', {
    hasServers: config.servers !== '[]',
  });

  try {
    await connectionManager.initialize(config);
    initialized = true;
    lastConfigHash = configHash;

    const stats = connectionManager.getStats();
    pluginLogger.info('MCP plugin initialized', {
      serverCount: stats.serverCount,
      readyCount: stats.readyCount,
      toolCount: stats.toolCount,
    });
    return true;
  } catch (error) {
    pluginLogger.error('Failed to initialize MCP plugin', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Plugin metadata
 */
const metadata: ToolMetadata = {
  toolName: 'mcp',
  displayName: 'MCP Server Connector',
  description: 'Connects to MCP servers and exposes their tools to LLMs',
  category: 'integration',
};

/**
 * MCP Server Connector Plugin Implementation
 *
 * Uses the standard multi-tool pattern with getToolDefinitions() and executeByName().
 * Dynamically provides tools from connected MCP servers.
 */
export const plugin: ToolPlugin = {
  metadata,

  /**
   * Get all tool definitions from connected MCP servers
   *
   * This is called by the tool registry to get all available tools.
   * Each MCP tool is exposed as a separate tool with the naming convention:
   * mcp_{servername}_{toolname}
   *
   * @param config User configuration for this plugin
   */
  async getToolDefinitions(config: Record<string, unknown>): Promise<UniversalTool[]> {
    // Ensure plugin is initialized before returning tools
    await ensureInitialized(config);

    const tools = connectionManager.getAllToolDefinitions();

    pluginLogger.debug('Getting tool definitions', {
      toolCount: tools.length,
      initialized,
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
   *
   * If the MCP server returns JSON with a "content" field, extract it.
   * Otherwise, try to pretty-print JSON or return as-is.
   */
  formatResults(result: ToolExecutionResult): string {
    const text = result.formattedText ?? result.result;

    if (text === undefined || text === null) {
      if (result.error) {
        return `Error: ${result.error}`;
      }
      return '';
    }

    // If it's not a string, stringify it
    if (typeof text !== 'string') {
      return JSON.stringify(text, null, 2);
    }

    // Try to detect and parse JSON responses
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);

        // If it's an object with a "content" field, extract that
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          if (typeof parsed.content === 'string') {
            // Return the content, optionally with metadata
            let output = parsed.content;

            // Add metadata as a note if present
            const metadata: string[] = [];
            if (parsed.fuzzy_match) {
              metadata.push(`fuzzy matched`);
            }
            if (parsed.actual_path && parsed.actual_path !== parsed.requested_path) {
              metadata.push(`found at: ${parsed.actual_path}`);
            }

            if (metadata.length > 0) {
              output = `[Note: ${metadata.join(', ')}]\n\n${output}`;
            }

            return output;
          }
        }

        // For other JSON, pretty-print it
        return JSON.stringify(parsed, null, 2);
      } catch {
        // Not valid JSON, return as-is
      }
    }

    return text;
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
const pluginExport = { plugin };
export default pluginExport;
