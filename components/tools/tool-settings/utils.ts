/**
 * Tool Settings Utilities
 *
 * Shared utility functions for tool settings components.
 */

import type { AvailableTool, ToolGroup, ToolSubgroup, CheckState } from './types'

/**
 * Group pattern format:
 * - Plugin level: "plugin:{pluginName}"
 * - Subgroup level: "plugin:{pluginName}:subgroup:{subgroupId}"
 */
export function makePluginGroupPattern(pluginName: string): string {
  return `plugin:${pluginName}`
}

export function makeSubgroupPattern(pluginName: string, subgroupId: string): string {
  return `plugin:${pluginName}:subgroup:${subgroupId}`
}

/**
 * Determine the checkbox state for a group based on its children
 */
export function getGroupCheckState(
  enabledCount: number,
  totalCount: number
): CheckState {
  if (enabledCount === totalCount) return 'checked'
  if (enabledCount === 0) return 'unchecked'
  return 'indeterminate'
}

/**
 * Build hierarchical structure from flat tool list
 */
/**
 * Built-in tool categories that get their own group in the UI.
 * Tools with these categories are separated from the main "Built-in Tools" group.
 */
const BUILT_IN_CATEGORY_GROUPS: Record<string, string> = {
  documents: 'Document Editing',
  wardrobe: 'Wardrobe',
  shell: 'Workspace',
  help: 'Quilltap Help',
}

export function buildToolHierarchy(availableTools: AvailableTool[]): ToolGroup[] {
  const builtInTools: AvailableTool[] = []
  const builtInCategoryTools = new Map<string, AvailableTool[]>()
  const pluginGroups = new Map<string, {
    displayName: string
    subgroups: Map<string, { displayName: string; tools: AvailableTool[] }>
    directTools: AvailableTool[]
  }>()

  for (const tool of availableTools) {
    if (tool.source === 'built-in') {
      // Check if this tool's category gets its own group
      if (tool.category && BUILT_IN_CATEGORY_GROUPS[tool.category]) {
        if (!builtInCategoryTools.has(tool.category)) {
          builtInCategoryTools.set(tool.category, [])
        }
        builtInCategoryTools.get(tool.category)!.push(tool)
      } else {
        builtInTools.push(tool)
      }
    } else if (tool.pluginName || tool.source === 'plugin') {
      // Use pluginName if available, fall back to tool id for ungrouped plugin tools
      const effectivePluginName = tool.pluginName || tool.id
      // Get or create plugin group
      if (!pluginGroups.has(effectivePluginName)) {
        pluginGroups.set(effectivePluginName, {
          displayName: effectivePluginName.charAt(0).toUpperCase() + effectivePluginName.slice(1),
          subgroups: new Map(),
          directTools: [],
        })
      }
      const group = pluginGroups.get(effectivePluginName)!

      if (tool.subgroupId) {
        // Add to subgroup
        if (!group.subgroups.has(tool.subgroupId)) {
          group.subgroups.set(tool.subgroupId, {
            displayName: tool.subgroupDisplayName || tool.subgroupId,
            tools: [],
          })
        }
        group.subgroups.get(tool.subgroupId)!.tools.push(tool)
      } else {
        // Direct child of plugin
        group.directTools.push(tool)
      }
    }
  }

  // Convert to array structure
  const groups: ToolGroup[] = []

  // Add built-in tools group
  if (builtInTools.length > 0) {
    groups.push({
      id: 'built-in',
      displayName: 'Built-in Tools',
      type: 'built-in',
      subgroups: [],
      tools: builtInTools,
    })
  }

  // Add built-in category groups (e.g., "Document Editing")
  for (const [category, tools] of builtInCategoryTools) {
    const displayName = BUILT_IN_CATEGORY_GROUPS[category] || category
    groups.push({
      id: `built-in:${category}`,
      displayName,
      type: 'built-in',
      subgroups: [],
      tools,
    })
  }

  // Add plugin groups
  for (const [pluginName, group] of pluginGroups) {
    const subgroups: ToolSubgroup[] = []
    for (const [subgroupId, subgroup] of group.subgroups) {
      subgroups.push({
        id: subgroupId,
        displayName: subgroup.displayName,
        pluginName,
        tools: subgroup.tools,
      })
    }

    // Try to get a better display name from the first tool's metadata
    let displayName = group.displayName
    const firstTool = group.directTools[0] || subgroups[0]?.tools[0]
    if (firstTool?.pluginName === 'mcp') {
      displayName = 'MCP Server Connector'
    }

    groups.push({
      id: `plugin:${pluginName}`,
      displayName,
      type: 'plugin',
      pluginName,
      subgroups,
      tools: group.directTools,
    })
  }

  return groups
}

/**
 * Extract all group IDs and subgroup IDs from tool hierarchy for auto-expansion
 */
export function extractAllGroupIds(tools: AvailableTool[]): { groupIds: Set<string>; subgroupIds: Set<string> } {
  const groupIds = new Set<string>()
  const subgroupIds = new Set<string>()

  // Built-in tools group
  groupIds.add('built-in')

  // Built-in category groups
  for (const tool of tools) {
    if (tool.source === 'built-in' && tool.category && BUILT_IN_CATEGORY_GROUPS[tool.category]) {
      groupIds.add(`built-in:${tool.category}`)
    }
  }

  // Plugin groups and subgroups
  for (const tool of tools) {
    if (tool.source === 'plugin' && tool.pluginName) {
      groupIds.add(`plugin:${tool.pluginName}`)
      if (tool.subgroupId) {
        subgroupIds.add(`plugin:${tool.pluginName}:subgroup:${tool.subgroupId}`)
      }
    }
  }

  return { groupIds, subgroupIds }
}
