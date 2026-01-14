/**
 * Tool Generator
 *
 * Converts MCP tool definitions to Quilltap's UniversalTool format.
 * Uses original tool names by default, only prefixes with server name on collision.
 */

import type { UniversalTool } from '@quilltap/plugin-types';
import type { MCPToolDefinition, ToolMapping } from './types';

/**
 * Sanitize a tool name for use in the Quilltap namespace
 *
 * @param name - Original tool name
 * @returns Sanitized name (lowercase, alphanumeric + underscore)
 */
export function sanitizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Information about a tool before collision resolution
 */
interface PendingTool {
  serverId: string;
  serverDisplayName: string;
  mcpTool: MCPToolDefinition;
  sanitizedName: string;
}

/**
 * Convert MCP tools from multiple servers to UniversalTool format
 * with collision-aware naming.
 *
 * Rules:
 * - Use original tool name by default
 * - If multiple servers have the same tool name, prefix with server name
 * - Only prefix the colliding tools, not all tools from that server
 *
 * @param serverTools - Map of serverId to { displayName, tools }
 * @param existingToolNames - Set of tool names already in use (e.g., built-in Quilltap tools)
 * @returns Object with tools array and mappings for lookup
 */
export function convertToolsWithCollisionHandling(
  serverTools: Map<string, { displayName: string; tools: MCPToolDefinition[] }>,
  existingToolNames: Set<string> = new Set()
): {
  tools: UniversalTool[];
  mappings: ToolMapping[];
} {
  // Step 1: Collect all pending tools and track name usage
  const pendingTools: PendingTool[] = [];
  const nameUsage = new Map<string, PendingTool[]>(); // sanitized name -> tools using it

  for (const [serverId, { displayName, tools }] of serverTools) {
    for (const mcpTool of tools) {
      const sanitizedName = sanitizeToolName(mcpTool.name);

      const pending: PendingTool = {
        serverId,
        serverDisplayName: displayName,
        mcpTool,
        sanitizedName,
      };

      pendingTools.push(pending);

      // Track which tools want this name
      if (!nameUsage.has(sanitizedName)) {
        nameUsage.set(sanitizedName, []);
      }
      nameUsage.get(sanitizedName)!.push(pending);
    }
  }

  // Step 2: Determine final names - prefix only on collision
  const tools: UniversalTool[] = [];
  const mappings: ToolMapping[] = [];

  for (const pending of pendingTools) {
    const usageList = nameUsage.get(pending.sanitizedName)!;
    const hasCollision = usageList.length > 1 || existingToolNames.has(pending.sanitizedName);

    // Use original name if no collision, otherwise prefix with server name
    const quilltapName = hasCollision
      ? `${sanitizeToolName(pending.serverId)}_${pending.sanitizedName}`
      : pending.sanitizedName;

    // Build description with server attribution (always helpful to know source)
    const description = pending.mcpTool.description
      ? `[${pending.serverDisplayName}] ${pending.mcpTool.description}`
      : `[${pending.serverDisplayName}] Tool: ${pending.mcpTool.name}`;

    // Convert input schema to OpenAI function parameters format
    const parameters: UniversalTool['function']['parameters'] = {
      type: 'object',
      properties: pending.mcpTool.inputSchema.properties || {},
      required: pending.mcpTool.inputSchema.required || [],
    };

    const universalTool: UniversalTool = {
      type: 'function',
      function: {
        name: quilltapName,
        description,
        parameters,
      },
    };

    tools.push(universalTool);

    mappings.push({
      quilltapName,
      mcpName: pending.mcpTool.name, // Original MCP name for calling the server
      serverId: pending.serverId,
      definition: pending.mcpTool,
    });
  }

  return { tools, mappings };
}

/**
 * Legacy function for backward compatibility - converts tools from a single server
 * Use convertToolsWithCollisionHandling for multi-server scenarios
 *
 * @deprecated Use convertToolsWithCollisionHandling instead
 */
export function convertTools(
  serverId: string,
  serverDisplayName: string,
  mcpTools: MCPToolDefinition[]
): {
  tools: UniversalTool[];
  mappings: ToolMapping[];
} {
  const serverTools = new Map<string, { displayName: string; tools: MCPToolDefinition[] }>();
  serverTools.set(serverId, { displayName: serverDisplayName, tools: mcpTools });
  return convertToolsWithCollisionHandling(serverTools);
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

// Legacy exports removed - no longer needed with new naming scheme
export const MCP_TOOL_PREFIX = ''; // No longer used
export function generateToolName(serverId: string, mcpToolName: string): string {
  // Legacy - just sanitize the name
  return sanitizeToolName(mcpToolName);
}
export function parseToolName(_toolName: string): null {
  // Legacy - no longer used, lookup by toolIndex instead
  return null;
}
export function getServerToolPrefix(serverId: string): string {
  return `${sanitizeToolName(serverId)}_`;
}
