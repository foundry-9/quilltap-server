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
 * - `search` - Search the Scriptorium (memories, conversations, backgrounds)
 * - `search_web` - Web search (when enabled)
 * - `project_info` - Get project metadata
 * - `request_full_context` - Request full context reload (context compression)
 * - `help_search` - Search Quilltap help documentation
 * - `help_settings` - Read Quilltap instance settings
 */
export const BUILTIN_TOOL_NAMES = new Set([
  'generate_image',
  'search',
  'search_web',
  'project_info',
  'request_full_context',
  'help_search',
  'help_settings',
  // Document editing tools (Scriptorium Phase 3.3)
  'doc_read_file',
  'doc_write_file',
  'doc_str_replace',
  'doc_insert_text',
  'doc_grep',
  'doc_list_files',
  'doc_read_frontmatter',
  'doc_update_frontmatter',
  'doc_read_heading',
  'doc_update_heading',
  // Document file management tools (Scriptorium Phase 3.4)
  'doc_move_file',
  'doc_delete_file',
  'doc_create_folder',
  'doc_delete_folder',
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
