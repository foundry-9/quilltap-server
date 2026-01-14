/**
 * MCP SSE Client
 *
 * Handles SSE-based communication with a single MCP server.
 * Manages connection lifecycle, request/response correlation,
 * and tool discovery.
 */

import { logger } from '@/lib/logger';
import { createSSEReader, parseSSEData } from './sse-parser';
import { sanitizeCustomHeaders } from './security';
import type {
  MCPServerConfig,
  MCPConnectionState,
  MCPToolDefinition,
  MCPRequest,
  MCPResponse,
  MCPToolsListResult,
  MCPToolCallParams,
  MCPToolCallResult,
  PendingRequest,
  SSEEvent,
} from './types';

const clientLogger = logger.child({ module: 'mcp-client' });

/**
 * MCP SSE Client for a single server
 *
 * Handles:
 * - SSE connection management
 * - JSON-RPC 2.0 request/response correlation
 * - Tool discovery (tools/list)
 * - Tool execution (tools/call)
 * - Connection state tracking
 */
export class MCPClient {
  private config: MCPServerConfig;
  private abortController: AbortController | null = null;
  private pendingRequests: Map<string | number, PendingRequest> = new Map();
  private messageId = 0;
  private state: MCPConnectionState;
  private sseReader: AsyncGenerator<SSEEvent, void, undefined> | null = null;
  private readLoopPromise: Promise<void> | null = null;

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
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

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
   * Connect to the MCP server via SSE
   */
  async connect(): Promise<void> {
    if (this.state.status === 'connected' || this.state.status === 'ready') {
      clientLogger.debug('Already connected', { serverId: this.config.name });
      return;
    }

    this.state.status = 'connecting';
    this.abortController = new AbortController();

    try {
      clientLogger.info('Connecting to MCP server', {
        serverId: this.config.name,
        url: this.config.url,
      });

      const response = await fetch(this.config.url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Verify content type
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/event-stream')) {
        clientLogger.warn('Unexpected content type', {
          serverId: this.config.name,
          contentType,
        });
      }

      this.state.status = 'connected';
      this.state.lastConnected = new Date();
      this.state.reconnectAttempts = 0;

      // Start reading SSE events
      this.sseReader = createSSEReader(response.body);
      this.readLoopPromise = this.readLoop();

      clientLogger.info('Connected to MCP server', { serverId: this.config.name });
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
   * Read loop for processing SSE events
   */
  private async readLoop(): Promise<void> {
    if (!this.sseReader) return;

    try {
      for await (const event of this.sseReader) {
        this.handleSSEEvent(event);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        clientLogger.debug('SSE read loop aborted', { serverId: this.config.name });
      } else {
        clientLogger.error('SSE read loop error', {
          serverId: this.config.name,
          error: error instanceof Error ? error.message : String(error),
        });
        this.state.status = 'error';
        this.state.lastError = error instanceof Error ? error.message : 'Read loop error';
      }
    }
  }

  /**
   * Handle an incoming SSE event
   */
  private handleSSEEvent(event: SSEEvent): void {
    clientLogger.debug('SSE event received', {
      serverId: this.config.name,
      eventType: event.event,
      hasData: !!event.data,
    });

    // Try to parse as JSON-RPC response
    const response = parseSSEData<MCPResponse>(event);
    if (response && response.jsonrpc === '2.0' && response.id !== undefined) {
      this.handleResponse(response);
    }
  }

  /**
   * Handle a JSON-RPC response
   */
  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      clientLogger.warn('Received response for unknown request', {
        serverId: this.config.name,
        id: response.id,
      });
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(response.id);

    // Resolve or reject the promise
    pending.resolve(response);
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (this.state.status !== 'connected' && this.state.status !== 'ready') {
      throw new Error(`Not connected (status: ${this.state.status})`);
    }

    const id = ++this.messageId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const timeout = (this.config.timeout || 30) * 1000;

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(id, {
        id,
        resolve: (response: MCPResponse) => {
          if (response.error) {
            reject(new Error(`MCP error: ${response.error.message} (code: ${response.error.code})`));
          } else {
            resolve(response.result as T);
          }
        },
        reject,
        timeoutId,
        timestamp: new Date(),
      });

      // Send request via POST to the same endpoint
      // MCP SSE servers typically accept POST for sending messages
      this.postRequest(request).catch((error) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  /**
   * POST a JSON-RPC request to the server
   */
  private async postRequest(request: MCPRequest): Promise<void> {
    const headers = this.buildHeaders();
    headers['Content-Type'] = 'application/json';

    clientLogger.debug('Sending MCP request', {
      serverId: this.config.name,
      method: request.method,
      id: request.id,
    });

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Some servers may return the response directly in the POST response
    // instead of through SSE. Handle both cases.
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try {
        const jsonResponse = await response.json() as MCPResponse;
        if (jsonResponse.jsonrpc === '2.0' && jsonResponse.id === request.id) {
          // Response came directly, handle it
          this.handleResponse(jsonResponse);
        }
      } catch {
        // Ignore parse errors - response will come via SSE
      }
    }
  }

  /**
   * Discover tools from the MCP server
   */
  async discoverTools(): Promise<MCPToolDefinition[]> {
    this.state.status = 'discovering';

    try {
      clientLogger.info('Discovering tools', { serverId: this.config.name });

      const result = await this.sendRequest<MCPToolsListResult>('tools/list');
      this.state.tools = result.tools || [];
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
    if (this.state.status !== 'ready') {
      throw new Error(`Server not ready (status: ${this.state.status})`);
    }

    clientLogger.debug('Calling MCP tool', {
      serverId: this.config.name,
      toolName,
    });

    const params: MCPToolCallParams = {
      name: toolName,
      arguments: args,
    };

    const result = await this.sendRequest<MCPToolCallResult>('tools/call', params);

    clientLogger.debug('MCP tool call completed', {
      serverId: this.config.name,
      toolName,
      isError: result.isError,
      contentCount: result.content?.length,
    });

    return result;
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    clientLogger.info('Disconnecting from MCP server', { serverId: this.config.name });

    // Abort any pending requests
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    this.sseReader = null;
    this.readLoopPromise = null;
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
