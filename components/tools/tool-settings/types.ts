/**
 * Tool Settings Types
 *
 * Shared type definitions for tool settings components.
 */

/**
 * Represents an available tool that can be enabled/disabled
 */
export interface AvailableTool {
  id: string
  name: string
  description: string
  source: 'built-in' | 'plugin'
  category?: string
  pluginName?: string
  subgroupId?: string
  subgroupDisplayName?: string
  /** Whether the tool is actually available in the current context */
  available?: boolean
  /** Reason why the tool is unavailable */
  unavailableReason?: string
}

/**
 * Hierarchical structure for displaying tool groups
 */
export interface ToolGroup {
  id: string
  displayName: string
  type: 'built-in' | 'plugin'
  pluginName?: string
  subgroups: ToolSubgroup[]
  tools: AvailableTool[] // Tools without subgroup (direct children)
}

/**
 * Subgroup within a tool group (e.g., MCP server tools)
 */
export interface ToolSubgroup {
  id: string
  displayName: string
  pluginName: string
  tools: AvailableTool[]
}

/**
 * Checkbox state for tri-state checkboxes
 */
export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

/**
 * Props for the shared ToolSettingsContent component
 */
export interface ToolSettingsContentProps {
  /** Available tools to display */
  availableTools: AvailableTool[]
  /** Currently disabled tool IDs */
  disabledTools: Set<string>
  /** Currently disabled group patterns */
  disabledGroups: Set<string>
  /** Callback when disabled tools change */
  onDisabledToolsChange: (tools: Set<string>) => void
  /** Callback when disabled groups change */
  onDisabledGroupsChange: (groups: Set<string>) => void
  /** Whether to show availability status (grayed out unavailable tools) */
  showAvailability?: boolean
  /** Whether data is loading */
  loading?: boolean
  /** Description text to show */
  description?: string
  /** Footer note text */
  footerNote?: string
}
