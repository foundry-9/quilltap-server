/**
 * MCP Client
 *
 * Handles communication with a single MCP server using the official
 * @modelcontextprotocol/sdk. Supports both Streamable HTTP and SSE transports
 * with automatic fallback.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { logger } from '@/lib/logger';
import { sanitizeCustomHeaders } from './security';
import type {
  MCPServerConfig,
  MCPConnectionState,
  MCPToolDefinition,
  MCPToolCallResult,
  MCPContentBlock,
} from './types';

const clientLogger = logger.child({ module: 'mcp-client' });

/**
 * MCP Client for a single server
 *
 * Uses the official MCP SDK for protocol handling.
 */
export class MCPClient {
  private config: MCPServerConfig;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private state: MCPConnectionState;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.state = {
      serverId: config.name,
      status: 'disconnected',
      tools: [],
      reconnectAttempts: 0,
    };
  }

  /**
   * Get current connection state
   */
  getState(): MCPConnectionState {
    return { ...this.state };
  }

  /**
   * Get discovered tools
   */
  getTools(): MCPToolDefinition[] {
    return [...this.state.tools];
  }

  /**
   * Get server configuration
   */
  getConfig(): MCPServerConfig {
    return { ...this.config };
  }

  /**
   * Build request headers for the MCP server
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    // Add auth headers based on config
    switch (this.config.authType) {
      case 'bearer':
        if (this.config.bearerToken) {
          headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
        }
        break;

      case 'api-key':
        if (this.config.apiKey) {
          const headerName = this.config.apiKeyHeader || 'X-API-Key';
          headers[headerName] = this.config.apiKey;
        }
        break;

      case 'custom-header':
        if (this.config.customHeaders) {
          const customHeaders = sanitizeCustomHeaders(this.config.customHeaders);
          if (customHeaders) {
            Object.assign(headers, customHeaders);
          }
        }
        break;
    }

    return headers;
  }

  /**
   * Connect to the MCP server
   *
   * Tries Streamable HTTP first, then falls back to SSE if that fails.
   */
  async connect(): Promise<void> {
    if (this.state.status === 'connected' || this.state.status === 'ready') {
      clientLogger.debug('Already connected', { serverId: this.config.name });
      return;
    }

    this.state.status = 'connecting';
    const url = new URL(this.config.url);
    const headers = this.buildHeaders();

    try {
      clientLogger.info('Connecting to MCP server', {
        serverId: this.config.name,
        url: this.config.url,
      });

      // Try Streamable HTTP first (newer protocol)
      try {
        this.client = new Client(
          { name: 'quilltap', version: '1.0.0' },
          { capabilities: {} }
        );

        this.transport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers,
          },
        });

        await this.client.connect(this.transport);
        clientLogger.info('Connected using Streamable HTTP transport', {
          serverId: this.config.name,
        });
      } catch (streamableError) {
        // Fall back to SSE transport
        clientLogger.debug('Streamable HTTP failed, falling back to SSE', {
          serverId: this.config.name,
          error: streamableError instanceof Error ? streamableError.message : String(streamableError),
        });

        // Close any partial connection
        if (this.transport) {
          try {
            await this.transport.close();
          } catch {
            // Ignore close errors
          }
        }

        this.client = new Client(
          { name: 'quilltap', version: '1.0.0' },
          { capabilities: {} }
        );

        // SSEClientTransport takes URL and optional options
        this.transport = new SSEClientTransport(url, {
          requestInit: {
            headers,
          },
        });

        await this.client.connect(this.transport);
        clientLogger.info('Connected using SSE transport', {
          serverId: this.config.name,
        });
      }

      this.state.status = 'connected';
      this.state.lastConnected = new Date();
      this.state.reconnectAttempts = 0;

      clientLogger.info('Connected to MCP server', {
        serverId: this.config.name,
      });

    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Connection failed';

      clientLogger.error('Failed to connect to MCP server', {
        serverId: this.config.name,
        error: this.state.lastError,
      });

      throw error;
    }
  }

  /**
   * Discover tools from the MCP server
   */
  async discoverTools(): Promise<MCPToolDefinition[]> {
    if (!this.client) {
      throw new Error('Not connected');
    }

    if (this.state.status !== 'connected' && this.state.status !== 'ready') {
      throw new Error(`Cannot discover tools (status: ${this.state.status})`);
    }

    this.state.status = 'discovering';

    try {
      clientLogger.info('Discovering tools', { serverId: this.config.name });

      const result = await this.client.listTools();

      // Convert SDK tool format to our MCPToolDefinition format
      this.state.tools = (result.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as MCPToolDefinition['inputSchema'],
      }));

      this.state.status = 'ready';

      clientLogger.info('Tools discovered', {
        serverId: this.config.name,
        toolCount: this.state.tools.length,
        tools: this.state.tools.map((t) => t.name),
      });

      return this.state.tools;
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Tool discovery failed';

      clientLogger.error('Tool discovery failed', {
        serverId: this.config.name,
        error: this.state.lastError,
      });

      throw error;
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    if (!this.client) {
      throw new Error('Not connected');
    }

    if (this.state.status !== 'ready') {
      throw new Error(`Server not ready (status: ${this.state.status})`);
    }

    clientLogger.debug('Calling MCP tool', {
      serverId: this.config.name,
      toolName,
    });

    const result = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    // Type definition for SDK content blocks
    interface SDKContentBlock {
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }

    // Convert SDK result to our MCPToolCallResult format
    const sdkContent = (result.content || []) as SDKContentBlock[];
    const content: MCPContentBlock[] = sdkContent.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      } else if (block.type === 'image') {
        return {
          type: 'image' as const,
          data: block.data,
          mimeType: block.mimeType,
        };
      } else if (block.type === 'resource') {
        return {
          type: 'resource' as const,
          // Resource blocks have different structure
          text: JSON.stringify(block),
        };
      }
      // Unknown type, convert to text
      return { type: 'text' as const, text: JSON.stringify(block) };
    });

    const mcpResult: MCPToolCallResult = {
      content,
      isError: result.isError === true,
    };

    clientLogger.debug('MCP tool call completed', {
      serverId: this.config.name,
      toolName,
      isError: mcpResult.isError,
      contentCount: mcpResult.content?.length,
    });

    return mcpResult;
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    clientLogger.info('Disconnecting from MCP server', { serverId: this.config.name });

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        clientLogger.warn('Error closing transport', {
          serverId: this.config.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.client = null;
    this.transport = null;
    this.state.status = 'disconnected';
    this.state.tools = [];
  }

  /**
   * Check if connected and ready
   */
  isReady(): boolean {
    return this.state.status === 'ready';
  }

  /**
   * Check if connected (but not necessarily ready)
   */
  isConnected(): boolean {
    return (
      this.state.status === 'connected' ||
      this.state.status === 'discovering' ||
      this.state.status === 'ready'
    );
  }
}
