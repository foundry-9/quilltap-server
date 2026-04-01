/**
 * Types for the MCP SSE tool plugin
 *
 * Defines interfaces for MCP server configuration, protocol messages,
 * and plugin state management.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Authentication type for MCP server connections
 */
export type MCPAuthType = 'none' | 'bearer' | 'api-key' | 'custom-header';

/**
 * Configuration for a single MCP server connection
 */
export interface MCPServerConfig {
  /** Unique identifier for this server (used as tool prefix, lowercase alphanumeric + underscore) */
  name: string;

  /** Display name for UI */
  displayName: string;

  /** MCP server URL (SSE endpoint) */
  url: string;

  /** Authentication type */
  authType: MCPAuthType;

  /** Bearer token (for authType: 'bearer') */
  bearerToken?: string;

  /** API key (for authType: 'api-key') */
  apiKey?: string;

  /** API key header name (default: 'X-API-Key') */
  apiKeyHeader?: string;

  /** Custom headers as JSON string (for authType: 'custom-header') */
  customHeaders?: string;

  /** Connection timeout in seconds (default: 30) */
  timeout?: number;

  /** Whether this server is enabled */
  enabled: boolean;
}

/**
 * User configuration for the MCP plugin
 */
export interface MCPPluginConfig {
  /** JSON string containing array of MCPServerConfig */
  servers: string;

  /** Global timeout for tool discovery (seconds) */
  discoveryTimeout: number;

  /** Whether to auto-reconnect on connection loss */
  autoReconnect: boolean;

  /** Maximum reconnection attempts */
  maxReconnectAttempts: number;
}

// ============================================================================
// MCP Protocol Types
// ============================================================================

/**
 * MCP Tool definition from the server
 */
export interface MCPToolDefinition {
  /** Tool name as defined by MCP server */
  name: string;

  /** Tool description */
  description?: string;

  /** JSON Schema for input parameters */
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP JSON-RPC 2.0 request message
 */
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

/**
 * MCP JSON-RPC 2.0 response message
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

/**
 * MCP JSON-RPC 2.0 error object
 */
export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * MCP tools/list response result
 */
export interface MCPToolsListResult {
  tools: MCPToolDefinition[];
}

/**
 * MCP tools/call request parameters
 */
export interface MCPToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * MCP content block in tool response
 */
export interface MCPContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * MCP tools/call response result
 */
export interface MCPToolCallResult {
  content: MCPContentBlock[];
  isError?: boolean;
}

// ============================================================================
// SSE Types
// ============================================================================

/**
 * Parsed SSE event from MCP server
 */
export interface SSEEvent {
  /** Event type (optional) */
  event?: string;

  /** Event data (JSON string) */
  data: string;

  /** Event ID (optional) */
  id?: string;

  /** Retry timeout in ms (optional) */
  retry?: number;
}

// ============================================================================
// Connection State Types
// ============================================================================

/**
 * Connection status for an MCP server
 */
export type MCPConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'discovering'
  | 'ready'
  | 'error';

/**
 * Connection state for an MCP server
 */
export interface MCPConnectionState {
  /** Server identifier */
  serverId: string;

  /** Current connection status */
  status: MCPConnectionStatus;

  /** Last error message if status is 'error' */
  lastError?: string;

  /** Discovered tools from this server */
  tools: MCPToolDefinition[];

  /** When the connection was last established */
  lastConnected?: Date;

  /** Number of reconnection attempts */
  reconnectAttempts: number;
}

// ============================================================================
// Execution Types
// ============================================================================

/**
 * Parsed tool name with server and original name
 */
export interface ParsedToolName {
  /** Server identifier from the tool name prefix */
  serverId: string;

  /** Original tool name from the MCP server */
  originalName: string;
}

/**
 * Result from MCP tool execution
 */
export interface MCPToolResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Content from the MCP server response */
  content?: string;

  /** Error message if execution failed */
  error?: string;

  /** Server that executed the tool */
  serverId: string;

  /** Original tool name on the MCP server */
  originalToolName: string;

  /** Execution time in milliseconds */
  executionTimeMs: number;
}

// ============================================================================
// Pending Request Types
// ============================================================================

/**
 * Pending request waiting for response
 */
export interface PendingRequest {
  /** Request ID for correlation */
  id: string | number;

  /** Resolve function for the promise */
  resolve: (response: MCPResponse) => void;

  /** Reject function for the promise */
  reject: (error: Error) => void;

  /** Timeout timer ID */
  timeoutId: ReturnType<typeof setTimeout>;

  /** When the request was made */
  timestamp: Date;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Tool mapping entry for quick lookup
 */
export interface ToolMapping {
  /** Quilltap tool name (mcp_servername_toolname) */
  quilltapName: string;

  /** Original MCP tool name */
  mcpName: string;

  /** Server that provides this tool */
  serverId: string;

  /** Tool definition */
  definition: MCPToolDefinition;
}
