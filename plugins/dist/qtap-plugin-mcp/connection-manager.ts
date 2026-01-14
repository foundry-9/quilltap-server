/**
 * MCP Connection Manager
 *
 * Manages multiple MCP server connections and provides a unified interface
 * for tool discovery, execution, and lifecycle management.
 */

import { logger } from '@/lib/logger';
import type { UniversalTool } from '@quilltap/plugin-types';
import { MCPClient } from './mcp-client';
import { parseServerConfigs } from './security';
import { convertTools, createToolIndex, getServerToolPrefix, parseToolName } from './tool-generator';
import type {
  MCPServerConfig,
  MCPPluginConfig,
  MCPConnectionState,
  ToolMapping,
  MCPToolCallResult,
} from './types';

const managerLogger = logger.child({ module: 'mcp-connection-manager' });

/**
 * Connection Manager for multiple MCP servers
 *
 * Provides:
 * - Multi-server connection management
 * - Unified tool discovery across all servers
 * - Tool execution routing to appropriate server
 * - Auto-reconnection with backoff
 */
export class MCPConnectionManager {
  private clients: Map<string, MCPClient> = new Map();
  private toolIndex: Map<string, ToolMapping> = new Map();
  private allTools: UniversalTool[] = [];
  private config: MCPPluginConfig = {
    servers: '[]',
    discoveryTimeout: 30,
    autoReconnect: true,
    maxReconnectAttempts: 3,
  };
  private initialized = false;

  /**
   * Initialize the connection manager with configuration
   */
  async initialize(config: Partial<MCPPluginConfig>): Promise<void> {
    this.config = { ...this.config, ...config };

    managerLogger.info('Initializing MCP connection manager', {
      discoveryTimeout: this.config.discoveryTimeout,
      autoReconnect: this.config.autoReconnect,
    });

    await this.reconfigure(this.config.servers);
    this.initialized = true;
  }

  /**
   * Reconfigure with new server settings
   *
   * Disconnects from removed servers, connects to new servers,
   * and rediscovers tools.
   */
  async reconfigure(serversJson: string): Promise<void> {
    managerLogger.info('Reconfiguring MCP servers');

    // Parse server configurations
    const { servers, errors } = parseServerConfigs(serversJson);

    if (errors.length > 0) {
      managerLogger.warn('Server configuration errors', { errors });
    }

    // Get list of enabled servers
    const enabledServers = servers.filter((s) => s.enabled);
    const newServerIds = new Set(enabledServers.map((s) => s.name));

    // Disconnect from servers that are no longer configured
    for (const [serverId, client] of this.clients) {
      if (!newServerIds.has(serverId)) {
        managerLogger.info('Disconnecting removed server', { serverId });
        client.disconnect();
        this.clients.delete(serverId);
      }
    }

    // Connect to new servers and reconnect to existing with changed config
    for (const serverConfig of enabledServers) {
      const existingClient = this.clients.get(serverConfig.name);

      if (existingClient) {
        // Check if config changed
        const existingConfig = existingClient.getConfig();
        if (JSON.stringify(existingConfig) !== JSON.stringify(serverConfig)) {
          managerLogger.info('Server config changed, reconnecting', {
            serverId: serverConfig.name,
          });
          existingClient.disconnect();
          this.clients.delete(serverConfig.name);
          await this.connectServer(serverConfig);
        }
      } else {
        await this.connectServer(serverConfig);
      }
    }

    // Rebuild tool index
    await this.rebuildToolIndex();
  }

  /**
   * Connect to a single MCP server
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    const client = new MCPClient(config);

    try {
      await client.connect();
      await client.discoverTools();
      this.clients.set(config.name, client);

      managerLogger.info('Server connected and tools discovered', {
        serverId: config.name,
        toolCount: client.getTools().length,
      });
    } catch (error) {
      managerLogger.error('Failed to connect to server', {
        serverId: config.name,
        error: error instanceof Error ? error.message : String(error),
      });

      // Store client anyway for state tracking
      this.clients.set(config.name, client);
    }
  }

  /**
   * Rebuild the unified tool index from all connected servers
   */
  private async rebuildToolIndex(): Promise<void> {
    this.allTools = [];
    this.toolIndex.clear();

    for (const [serverId, client] of this.clients) {
      if (!client.isReady()) continue;

      const config = client.getConfig();
      const mcpTools = client.getTools();
      const { tools, mappings } = convertTools(serverId, config.displayName, mcpTools);

      this.allTools.push(...tools);

      for (const mapping of mappings) {
        this.toolIndex.set(mapping.quilltapName, mapping);
      }
    }

    managerLogger.info('Tool index rebuilt', {
      totalTools: this.allTools.length,
      servers: Array.from(this.clients.keys()),
    });
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllToolDefinitions(): UniversalTool[] {
    return [...this.allTools];
  }

  /**
   * Get a client by server ID
   */
  getClient(serverId: string): MCPClient | null {
    return this.clients.get(serverId) || null;
  }

  /**
   * Get tool mapping by Quilltap tool name
   */
  getToolMapping(quilltapToolName: string): ToolMapping | null {
    return this.toolIndex.get(quilltapToolName) || null;
  }

  /**
   * Execute a tool by its Quilltap name
   */
  async executeTool(
    quilltapToolName: string,
    args: Record<string, unknown>
  ): Promise<{
    success: boolean;
    content?: string;
    error?: string;
    serverId: string;
    originalToolName: string;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();

    // Parse tool name to get server and original name
    const parsed = parseToolName(quilltapToolName);
    if (!parsed) {
      return {
        success: false,
        error: `Invalid MCP tool name format: ${quilltapToolName}`,
        serverId: '',
        originalToolName: '',
        executionTimeMs: Date.now() - startTime,
      };
    }

    const { serverId, originalName } = parsed;

    // Get the client for this server
    const client = this.clients.get(serverId);
    if (!client) {
      return {
        success: false,
        error: `MCP server not found: ${serverId}`,
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime,
      };
    }

    if (!client.isReady()) {
      return {
        success: false,
        error: `MCP server not ready: ${serverId} (status: ${client.getState().status})`,
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime,
      };
    }

    try {
      // Execute the tool
      const result = await client.callTool(originalName, args);

      // Format content from response
      const content = this.formatMCPContent(result);

      return {
        success: !result.isError,
        content,
        error: result.isError ? content : undefined,
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        serverId,
        originalToolName: originalName,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Format MCP response content as a string
   */
  private formatMCPContent(result: MCPToolCallResult): string {
    if (!result.content || result.content.length === 0) {
      return '';
    }

    const parts: string[] = [];

    for (const block of result.content) {
      switch (block.type) {
        case 'text':
          if (block.text) {
            parts.push(block.text);
          }
          break;

        case 'image':
          if (block.data && block.mimeType) {
            parts.push(`[Image: ${block.mimeType}]`);
          }
          break;

        case 'resource':
          parts.push(`[Resource: ${block.mimeType || 'unknown type'}]`);
          break;
      }
    }

    return parts.join('\n');
  }

  /**
   * Get connection states for all servers
   */
  getConnectionStates(): MCPConnectionState[] {
    return Array.from(this.clients.values()).map((client) => client.getState());
  }

  /**
   * Get statistics about the connection manager
   */
  getStats(): {
    initialized: boolean;
    serverCount: number;
    readyCount: number;
    toolCount: number;
    servers: Array<{ serverId: string; status: string; toolCount: number }>;
  } {
    const servers = Array.from(this.clients.entries()).map(([serverId, client]) => ({
      serverId,
      status: client.getState().status,
      toolCount: client.getTools().length,
    }));

    return {
      initialized: this.initialized,
      serverCount: this.clients.size,
      readyCount: servers.filter((s) => s.status === 'ready').length,
      toolCount: this.allTools.length,
      servers,
    };
  }

  /**
   * Disconnect from all servers
   */
  disconnectAll(): void {
    managerLogger.info('Disconnecting all MCP servers');

    for (const [serverId, client] of this.clients) {
      client.disconnect();
    }

    this.clients.clear();
    this.toolIndex.clear();
    this.allTools = [];
  }

  /**
   * Check if any servers are connected and ready
   */
  hasReadyServers(): boolean {
    for (const client of this.clients.values()) {
      if (client.isReady()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Attempt to reconnect disconnected servers
   */
  async reconnectDisconnected(): Promise<void> {
    for (const [serverId, client] of this.clients) {
      const state = client.getState();

      if (
        state.status === 'error' ||
        state.status === 'disconnected'
      ) {
        if (
          this.config.maxReconnectAttempts === 0 ||
          state.reconnectAttempts < this.config.maxReconnectAttempts
        ) {
          managerLogger.info('Attempting reconnection', {
            serverId,
            attempt: state.reconnectAttempts + 1,
          });

          try {
            await client.connect();
            await client.discoverTools();
            await this.rebuildToolIndex();
          } catch (error) {
            managerLogger.warn('Reconnection failed', {
              serverId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
  }
}

// Singleton instance for the plugin
export const connectionManager = new MCPConnectionManager();
