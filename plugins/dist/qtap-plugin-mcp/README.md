# MCP Server Connector Plugin

Connect to MCP (Model Context Protocol) servers via SSE and expose their tools to LLMs in Quilltap.

## Features

- **Dynamic Tool Discovery**: Automatically discovers tools from connected MCP servers
- **Multiple Servers**: Connect to multiple MCP servers simultaneously
- **Flexible Authentication**: Supports Bearer tokens, API keys, and custom headers
- **Auto-Reconnection**: Automatically reconnects on connection loss
- **Tool Prefixing**: Tools are exposed as `mcp_{servername}_{toolname}` for clear identification

## Configuration

Configure MCP servers in **Settings > Tools > MCP Server Connector**.

### Server Configuration Format

The `servers` field accepts a JSON array of server configurations:

```json
[
  {
    "name": "filesystem",
    "displayName": "Local Filesystem",
    "url": "http://localhost:3001/sse",
    "authType": "none",
    "enabled": true
  },
  {
    "name": "github",
    "displayName": "GitHub API",
    "url": "https://mcp-github.example.com/sse",
    "authType": "bearer",
    "bearerToken": "ghp_xxxxxxxxxxxx",
    "enabled": true
  },
  {
    "name": "internal",
    "displayName": "Internal API",
    "url": "https://internal.company.com/mcp/sse",
    "authType": "api-key",
    "apiKey": "sk-xxxxxxxxxxxx",
    "apiKeyHeader": "X-API-Key",
    "enabled": true
  }
]
```

### Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier (used as tool prefix) |
| `displayName` | string | No | Human-readable name for UI |
| `url` | string | Yes | MCP server SSE endpoint URL |
| `authType` | string | Yes | Authentication type: `none`, `bearer`, `api-key`, or `custom-header` |
| `bearerToken` | string | For bearer | Bearer token for authentication |
| `apiKey` | string | For api-key | API key value |
| `apiKeyHeader` | string | For api-key | Header name (default: `X-API-Key`) |
| `customHeaders` | string | For custom-header | JSON object of custom headers |
| `timeout` | number | No | Connection timeout in seconds (default: 30) |
| `enabled` | boolean | No | Whether this server is active (default: true) |

### Plugin Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Discovery Timeout | 30 | Seconds to wait for tool discovery |
| Auto-Reconnect | true | Reconnect automatically on connection loss |
| Max Reconnect Attempts | 3 | Maximum retry attempts (0 = unlimited) |

## How It Works

1. **Connection**: On initialization, the plugin connects to each enabled MCP server via SSE
2. **Discovery**: Sends `tools/list` JSON-RPC request to discover available tools
3. **Registration**: Each discovered tool is registered with Quilltap as `mcp_{servername}_{toolname}`
4. **Execution**: When an LLM calls a tool, the plugin routes it to the appropriate server via `tools/call`

## Tool Naming Convention

Tools are prefixed to identify their source:

- MCP tool `read_file` from server `filesystem` becomes `mcp_filesystem_read_file`
- MCP tool `create_issue` from server `github` becomes `mcp_github_create_issue`

## Security

- **SSRF Protection**: Private/local IP addresses are blocked
- **Protocol Restriction**: Only HTTP and HTTPS are allowed
- **Header Sanitization**: Dangerous headers (Host, Cookie, etc.) are filtered
- **Credential Handling**: Auth tokens are never logged

## MCP Protocol

This plugin implements the [Model Context Protocol](https://modelcontextprotocol.io/) specification:

- Transport: Server-Sent Events (SSE)
- Message Format: JSON-RPC 2.0
- Methods: `tools/list`, `tools/call`

## Troubleshooting

### Tools Not Appearing

1. Check server configuration is valid JSON
2. Verify server URL is accessible
3. Check server status in logs (`logs/combined.log`)
4. Ensure at least one server has `enabled: true`

### Connection Errors

1. Verify the MCP server is running
2. Check authentication credentials
3. Review server logs for errors
4. Try increasing the timeout value

### Tool Execution Failures

1. Check tool input matches expected schema
2. Verify server is still connected
3. Review MCP server logs for errors

## Development

This plugin is part of the Quilltap core distribution. Source code is in `plugins/dist/qtap-plugin-mcp/`.

### Building

```bash
npm run build:plugins
```

### Files

- `index.ts` - Main plugin export
- `types.ts` - TypeScript type definitions
- `mcp-client.ts` - SSE client for single server
- `connection-manager.ts` - Multi-server management
- `tool-generator.ts` - Tool definition conversion
- `sse-parser.ts` - SSE event parsing
- `security.ts` - URL validation and sanitization
