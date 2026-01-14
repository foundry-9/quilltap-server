/**
 * Tool Generator
 *
 * Converts MCP tool definitions to Quilltap's UniversalTool format.
 * Handles tool name prefixing and schema transformation.
 */

import type { UniversalTool } from '@quilltap/plugin-types';
import type { MCPToolDefinition, ToolMapping, ParsedToolName } from './types';

/**
 * Tool name prefix for all MCP tools
 */
export const MCP_TOOL_PREFIX = 'mcp';

/**
 * Generate a Quilltap tool name from server and MCP tool names
 *
 * Format: mcp_{servername}_{toolname}
 *
 * @param serverId - Server identifier (sanitized name)
 * @param mcpToolName - Original tool name from MCP server
 * @returns Quilltap-compatible tool name
 */
export function generateToolName(serverId: string, mcpToolName: string): string {
  // Sanitize the MCP tool name (replace non-alphanumeric with underscore)
  const sanitizedToolName = mcpToolName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return `${MCP_TOOL_PREFIX}_${serverId}_${sanitizedToolName}`;
}

/**
 * Parse a Quilltap tool name to extract server and original tool name
 *
 * @param toolName - Quilltap tool name (mcp_servername_toolname)
 * @returns Parsed components or null if invalid format
 */
export function parseToolName(toolName: string): ParsedToolName | null {
  // Must start with mcp_
  if (!toolName.startsWith(`${MCP_TOOL_PREFIX}_`)) {
    return null;
  }

  // Remove prefix
  const remainder = toolName.slice(MCP_TOOL_PREFIX.length + 1);

  // Find first underscore to separate server from tool
  const underscoreIndex = remainder.indexOf('_');
  if (underscoreIndex === -1) {
    return null;
  }

  const serverId = remainder.slice(0, underscoreIndex);
  const originalName = remainder.slice(underscoreIndex + 1);

  if (!serverId || !originalName) {
    return null;
  }

  return { serverId, originalName };
}

/**
 * Generate prefix for unregistering tools from a specific server
 *
 * @param serverId - Server identifier
 * @returns Prefix string for tool matching
 */
export function getServerToolPrefix(serverId: string): string {
  return `${MCP_TOOL_PREFIX}_${serverId}_`;
}

/**
 * Convert an MCP tool definition to Quilltap's UniversalTool format
 *
 * @param serverId - Server identifier
 * @param serverDisplayName - Server display name for description
 * @param mcpTool - MCP tool definition
 * @returns UniversalTool definition
 */
export function convertToUniversalTool(
  serverId: string,
  serverDisplayName: string,
  mcpTool: MCPToolDefinition
): UniversalTool {
  const quilltapName = generateToolName(serverId, mcpTool.name);

  // Build description with server attribution
  const description = mcpTool.description
    ? `[${serverDisplayName}] ${mcpTool.description}`
    : `[${serverDisplayName}] Tool: ${mcpTool.name}`;

  // Convert input schema to OpenAI function parameters format
  const parameters: UniversalTool['function']['parameters'] = {
    type: 'object',
    properties: mcpTool.inputSchema.properties || {},
    required: mcpTool.inputSchema.required || [],
  };

  return {
    type: 'function',
    function: {
      name: quilltapName,
      description,
      parameters,
    },
  };
}

/**
 * Convert multiple MCP tools to UniversalTool format and create mappings
 *
 * @param serverId - Server identifier
 * @param serverDisplayName - Server display name
 * @param mcpTools - Array of MCP tool definitions
 * @returns Object with tools array and mappings for lookup
 */
export function convertTools(
  serverId: string,
  serverDisplayName: string,
  mcpTools: MCPToolDefinition[]
): {
  tools: UniversalTool[];
  mappings: ToolMapping[];
} {
  const tools: UniversalTool[] = [];
  const mappings: ToolMapping[] = [];

  for (const mcpTool of mcpTools) {
    const universalTool = convertToUniversalTool(serverId, serverDisplayName, mcpTool);
    tools.push(universalTool);

    mappings.push({
      quilltapName: universalTool.function.name,
      mcpName: mcpTool.name,
      serverId,
      definition: mcpTool,
    });
  }

  return { tools, mappings };
}

/**
 * Create a tool mapping index for fast lookup
 *
 * @param mappings - Array of tool mappings
 * @returns Map from Quilltap name to mapping
 */
export function createToolIndex(mappings: ToolMapping[]): Map<string, ToolMapping> {
  const index = new Map<string, ToolMapping>();

  for (const mapping of mappings) {
    index.set(mapping.quilltapName, mapping);
  }

  return index;
}
