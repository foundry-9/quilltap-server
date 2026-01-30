/**
 * Built-in tool names for Quilltap
 *
 * These are the tool names used by Quilltap's built-in tools.
 * Plugins that provide dynamic tools (like MCP connectors) should use
 * this list for collision detection to avoid shadowing built-in functionality.
 *
 * @module @quilltap/plugin-utils/builtin-tools
 */

/**
 * Names of all built-in Quilltap tools
 *
 * This set contains the function names of tools that are built into Quilltap:
 * - `generate_image` - AI image generation
 * - `search_memories` - Search character/chat memories
 * - `search_web` - Web search (when enabled)
 * - `project_info` - Get project metadata
 * - `file_management` - Read/write project files
 * - `request_full_context` - Request full context reload (context compression)
 */
export const BUILTIN_TOOL_NAMES = new Set([
  'generate_image',
  'search_memories',
  'search_web',
  'project_info',
  'file_management',
  'request_full_context',
]);

/**
 * Get the set of built-in tool names
 *
 * Use this function to get the current list of reserved tool names
 * when implementing collision detection in plugins that provide
 * dynamic tools (e.g., MCP server connectors, external tool bridges).
 *
 * @returns Set of tool names that are reserved by Quilltap's built-in tools
 *
 * @example
 * ```typescript
 * import { getBuiltinToolNames } from '@quilltap/plugin-utils';
 *
 * // When generating tool names from external sources:
 * const builtinNames = getBuiltinToolNames();
 * if (builtinNames.has(proposedToolName)) {
 *   // Rename or prefix the tool to avoid collision
 *   proposedToolName = `external_${proposedToolName}`;
 * }
 * ```
 */
export function getBuiltinToolNames(): Set<string> {
  return new Set(BUILTIN_TOOL_NAMES);
}
