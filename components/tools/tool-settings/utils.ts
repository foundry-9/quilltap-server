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
export function buildToolHierarchy(availableTools: AvailableTool[]): ToolGroup[] {
  const builtInTools: AvailableTool[] = []
  const pluginGroups = new Map<string, {
    displayName: string
    subgroups: Map<string, { displayName: string; tools: AvailableTool[] }>
    directTools: AvailableTool[]
  }>()

  for (const tool of availableTools) {
    if (tool.source === 'built-in') {
      builtInTools.push(tool)
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
