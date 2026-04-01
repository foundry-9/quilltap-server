'use client'

/**
 * Tool Settings Content
 *
 * Shared UI component for displaying and managing tool settings.
 * Used by both ChatToolSettingsModal and ProjectToolSettingsModal.
 */

import { useState, useCallback, useMemo } from 'react'
import type { AvailableTool, ToolGroup, ToolSubgroup, CheckState, ToolSettingsContentProps } from './types'
import {
  makePluginGroupPattern,
  makeSubgroupPattern,
  getGroupCheckState,
  buildToolHierarchy,
  extractAllGroupIds,
} from './utils'

// ============================================================================
// Icon Components
// ============================================================================

function ChevronDownIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ChevronRightIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function ToolSettingsContent({
  availableTools,
  disabledTools,
  disabledGroups,
  onDisabledToolsChange,
  onDisabledGroupsChange,
  showAvailability = true,
  loading = false,
  description,
  footerNote,
}: Readonly<ToolSettingsContentProps>) {
  // Track which groups user has explicitly collapsed
  // All groups are expanded by default, user collapses add to these sets
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Set<string>>(new Set())

  // Compute which groups are expanded (all minus explicitly collapsed)
  const { allGroupIds, allSubgroupIds } = useMemo(() => {
    if (availableTools.length === 0) {
      return { allGroupIds: new Set<string>(), allSubgroupIds: new Set<string>() }
    }
    return {
      allGroupIds: extractAllGroupIds(availableTools).groupIds,
      allSubgroupIds: extractAllGroupIds(availableTools).subgroupIds,
    }
  }, [availableTools])

  // A group is expanded if it exists and is not in the collapsed set
  const isGroupExpanded = useCallback((groupId: string) => {
    return allGroupIds.has(groupId) && !collapsedGroups.has(groupId)
  }, [allGroupIds, collapsedGroups])

  const isSubgroupExpanded = useCallback((subgroupId: string) => {
    return allSubgroupIds.has(subgroupId) && !collapsedSubgroups.has(subgroupId)
  }, [allSubgroupIds, collapsedSubgroups])

  // Build hierarchical structure from flat tool list
  const toolHierarchy = useMemo(() => buildToolHierarchy(availableTools), [availableTools])

  // Check if a tool is enabled (not disabled by individual or group pattern)
  const isToolEnabled = useCallback((tool: AvailableTool): boolean => {
    // Check individual disable
    if (disabledTools.has(tool.id)) return false

    // Check plugin-level group disable
    if (tool.pluginName && disabledGroups.has(makePluginGroupPattern(tool.pluginName))) {
      return false
    }

    // Check subgroup-level disable
    if (tool.pluginName && tool.subgroupId) {
      if (disabledGroups.has(makeSubgroupPattern(tool.pluginName, tool.subgroupId))) {
        return false
      }
    }

    return true
  }, [disabledTools, disabledGroups])

  // Count enabled tools (only count tools that are actually available when showAvailability is true)
  const { enabledCount, availableCount } = useMemo(() => {
    const available = showAvailability
      ? availableTools.filter(t => t.available !== false)
      : availableTools
    const enabled = available.filter(isToolEnabled)
    return { enabledCount: enabled.length, availableCount: available.length }
  }, [availableTools, isToolEnabled, showAvailability])

  // Toggle individual tool
  const handleToggleTool = useCallback((tool: AvailableTool) => {
    const newSet = new Set(disabledTools)
    if (newSet.has(tool.id)) {
      newSet.delete(tool.id)
    } else {
      newSet.add(tool.id)
    }
    onDisabledToolsChange(newSet)
  }, [disabledTools, onDisabledToolsChange])

  // Toggle group (built-in or plugin)
  const handleToggleGroup = useCallback((group: ToolGroup) => {
    // Get all tools in this group (direct tools + tools in subgroups)
    const allToolsInGroup: AvailableTool[] = [
      ...group.tools,
      ...group.subgroups.flatMap(sg => sg.tools),
    ]

    const enabledInGroup = allToolsInGroup.filter(isToolEnabled).length
    const shouldEnable = enabledInGroup < allToolsInGroup.length

    if (group.type === 'built-in') {
      // For built-in tools, toggle individual tools
      const newSet = new Set(disabledTools)
      for (const tool of allToolsInGroup) {
        if (shouldEnable) {
          newSet.delete(tool.id)
        } else {
          newSet.add(tool.id)
        }
      }
      onDisabledToolsChange(newSet)
    } else if (group.pluginName) {
      // For plugin groups, use group pattern
      const newGroups = new Set(disabledGroups)
      const pattern = makePluginGroupPattern(group.pluginName)

      if (shouldEnable) {
        // Remove the plugin group pattern
        newGroups.delete(pattern)
        // Also remove any subgroup patterns
        for (const sg of group.subgroups) {
          newGroups.delete(makeSubgroupPattern(group.pluginName!, sg.id))
        }
        onDisabledGroupsChange(newGroups)
        // And remove individual tool disables from this plugin
        const newTools = new Set(disabledTools)
        for (const tool of allToolsInGroup) {
          newTools.delete(tool.id)
        }
        onDisabledToolsChange(newTools)
      } else {
        // Add the plugin group pattern
        newGroups.add(pattern)
        onDisabledGroupsChange(newGroups)
      }
    }
  }, [isToolEnabled, disabledTools, disabledGroups, onDisabledToolsChange, onDisabledGroupsChange])

  // Toggle subgroup
  const handleToggleSubgroup = useCallback((subgroup: ToolSubgroup) => {
    const enabledInSubgroup = subgroup.tools.filter(isToolEnabled).length
    const shouldEnable = enabledInSubgroup < subgroup.tools.length

    const newGroups = new Set(disabledGroups)
    const pattern = makeSubgroupPattern(subgroup.pluginName, subgroup.id)

    if (shouldEnable) {
      // Remove the subgroup pattern
      newGroups.delete(pattern)
      onDisabledGroupsChange(newGroups)
      // Also remove individual tool disables from this subgroup
      const newTools = new Set(disabledTools)
      for (const tool of subgroup.tools) {
        newTools.delete(tool.id)
      }
      onDisabledToolsChange(newTools)
    } else {
      // Add the subgroup pattern (unless parent plugin is disabled)
      const pluginPattern = makePluginGroupPattern(subgroup.pluginName)
      if (!newGroups.has(pluginPattern)) {
        newGroups.add(pattern)
        onDisabledGroupsChange(newGroups)
      }
    }
  }, [isToolEnabled, disabledTools, disabledGroups, onDisabledToolsChange, onDisabledGroupsChange])

  // Enable all / disable all
  const handleEnableAll = useCallback(() => {
    onDisabledToolsChange(new Set())
    onDisabledGroupsChange(new Set())
  }, [onDisabledToolsChange, onDisabledGroupsChange])

  const handleDisableAll = useCallback(() => {
    // Use group patterns for plugins, individual disables for built-in
    const newGroups = new Set<string>()
    const newTools = new Set<string>()

    for (const group of toolHierarchy) {
      if (group.type === 'built-in') {
        for (const tool of group.tools) {
          newTools.add(tool.id)
        }
      } else if (group.pluginName) {
        newGroups.add(makePluginGroupPattern(group.pluginName))
      }
    }

    onDisabledToolsChange(newTools)
    onDisabledGroupsChange(newGroups)
  }, [toolHierarchy, onDisabledToolsChange, onDisabledGroupsChange])

  // Toggle expand/collapse (toggle means add/remove from collapsed set)
  const toggleGroupExpanded = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId) // Was collapsed, now expand
      } else {
        newSet.add(groupId) // Was expanded, now collapse
      }
      return newSet
    })
  }, [])

  const toggleSubgroupExpanded = useCallback((subgroupId: string) => {
    setCollapsedSubgroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(subgroupId)) {
        newSet.delete(subgroupId) // Was collapsed, now expand
      } else {
        newSet.add(subgroupId) // Was expanded, now collapse
      }
      return newSet
    })
  }, [])

  // Get check state for a group
  const getGroupState = useCallback((group: ToolGroup): CheckState => {
    const allTools = [...group.tools, ...group.subgroups.flatMap(sg => sg.tools)]
    const enabledInGroup = allTools.filter(isToolEnabled).length
    return getGroupCheckState(enabledInGroup, allTools.length)
  }, [isToolEnabled])

  // Get check state for a subgroup
  const getSubgroupState = useCallback((subgroup: ToolSubgroup): CheckState => {
    const enabledInSubgroup = subgroup.tools.filter(isToolEnabled).length
    return getGroupCheckState(enabledInSubgroup, subgroup.tools.length)
  }, [isToolEnabled])

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin w-8 h-8 border-2 border-muted-foreground border-t-primary rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Description and quick actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {description || `${enabledCount} of ${availableCount} tools enabled`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleEnableAll}
            className="qt-button-secondary qt-button-sm"
          >
            Enable All
          </button>
          <button
            type="button"
            onClick={handleDisableAll}
            className="qt-button-secondary qt-button-sm"
          >
            Disable All
          </button>
        </div>
      </div>

      {/* Tool hierarchy */}
      <div className="space-y-2">
        {toolHierarchy.map(group => (
          <GroupSection
            key={group.id}
            group={group}
            isExpanded={isGroupExpanded(group.id)}
            onToggleExpand={() => toggleGroupExpanded(group.id)}
            checkState={getGroupState(group)}
            onToggleGroup={() => handleToggleGroup(group)}
            isSubgroupExpanded={isSubgroupExpanded}
            onToggleSubgroupExpand={toggleSubgroupExpanded}
            getSubgroupState={getSubgroupState}
            onToggleSubgroup={handleToggleSubgroup}
            isToolEnabled={isToolEnabled}
            onToggleTool={handleToggleTool}
            showAvailability={showAvailability}
          />
        ))}
      </div>

      {availableTools.length === 0 && !loading && (
        <div className="text-center py-4 text-muted-foreground">
          No tools available
        </div>
      )}

      {/* Info note */}
      {footerNote && (
        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          {footerNote}
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================

interface GroupSectionProps {
  group: ToolGroup
  isExpanded: boolean
  onToggleExpand: () => void
  checkState: CheckState
  onToggleGroup: () => void
  isSubgroupExpanded: (subgroupId: string) => boolean
  onToggleSubgroupExpand: (id: string) => void
  getSubgroupState: (subgroup: ToolSubgroup) => CheckState
  onToggleSubgroup: (subgroup: ToolSubgroup) => void
  isToolEnabled: (tool: AvailableTool) => boolean
  onToggleTool: (tool: AvailableTool) => void
  showAvailability: boolean
}

function GroupSection({
  group,
  isExpanded,
  onToggleExpand,
  checkState,
  onToggleGroup,
  isSubgroupExpanded,
  onToggleSubgroupExpand,
  getSubgroupState,
  onToggleSubgroup,
  isToolEnabled,
  onToggleTool,
  showAvailability,
}: Readonly<GroupSectionProps>) {
  const allTools = [...group.tools, ...group.subgroups.flatMap(sg => sg.tools)]
  // Only count tools that are actually available (not grayed out) when showAvailability is true
  const countableTools = showAvailability ? allTools.filter(t => t.available !== false) : allTools
  const availableToolCount = countableTools.length
  const enabledToolCount = countableTools.filter(isToolEnabled).length
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-2 p-3 bg-muted/30 hover:bg-muted/50 transition-colors">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <ChevronIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm">{group.displayName}</span>
          <span className="text-xs text-muted-foreground">({enabledToolCount}/{availableToolCount})</span>
        </button>
        <TriStateCheckbox
          state={checkState}
          onChange={onToggleGroup}
          label={`Toggle all ${group.displayName}`}
        />
      </div>

      {/* Group content */}
      {isExpanded && (
        <div className="p-2 space-y-1">
          {/* Direct tools in group */}
          {group.tools.map(tool => (
            <ToolToggle
              key={tool.id}
              tool={tool}
              isEnabled={isToolEnabled(tool)}
              onToggle={() => onToggleTool(tool)}
              indentLevel={0}
              showAvailability={showAvailability}
            />
          ))}

          {/* Subgroups */}
          {group.subgroups.map(subgroup => (
            <SubgroupSection
              key={`${group.pluginName}:${subgroup.id}`}
              subgroup={subgroup}
              isExpanded={isSubgroupExpanded(makeSubgroupPattern(subgroup.pluginName, subgroup.id))}
              onToggleExpand={() => onToggleSubgroupExpand(makeSubgroupPattern(subgroup.pluginName, subgroup.id))}
              checkState={getSubgroupState(subgroup)}
              onToggleSubgroup={() => onToggleSubgroup(subgroup)}
              isToolEnabled={isToolEnabled}
              onToggleTool={onToggleTool}
              showAvailability={showAvailability}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface SubgroupSectionProps {
  subgroup: ToolSubgroup
  isExpanded: boolean
  onToggleExpand: () => void
  checkState: CheckState
  onToggleSubgroup: () => void
  isToolEnabled: (tool: AvailableTool) => boolean
  onToggleTool: (tool: AvailableTool) => void
  showAvailability: boolean
}

function SubgroupSection({
  subgroup,
  isExpanded,
  onToggleExpand,
  checkState,
  onToggleSubgroup,
  isToolEnabled,
  onToggleTool,
  showAvailability,
}: Readonly<SubgroupSectionProps>) {
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon
  // Only count tools that are actually available (not grayed out) when showAvailability is true
  const countableTools = showAvailability ? subgroup.tools.filter(t => t.available !== false) : subgroup.tools
  const totalCount = countableTools.length
  const enabledCount = countableTools.filter(isToolEnabled).length

  return (
    <div className="ml-4 border-l-2 border-border/50">
      {/* Subgroup header */}
      <div className="flex items-center gap-2 p-2 pl-3 hover:bg-muted/30 rounded-r transition-colors">
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <ChevronIcon className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground/80">{subgroup.displayName}</span>
          <span className="text-xs text-muted-foreground">({enabledCount}/{totalCount})</span>
        </button>
        <TriStateCheckbox
          state={checkState}
          onChange={onToggleSubgroup}
          label={`Toggle all ${subgroup.displayName}`}
        />
      </div>

      {/* Subgroup tools */}
      {isExpanded && (
        <div className="pl-3 space-y-0.5">
          {subgroup.tools.map(tool => (
            <ToolToggle
              key={tool.id}
              tool={tool}
              isEnabled={isToolEnabled(tool)}
              onToggle={() => onToggleTool(tool)}
              indentLevel={1}
              showAvailability={showAvailability}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface TriStateCheckboxProps {
  state: CheckState
  onChange: () => void
  label: string
}

function TriStateCheckbox({ state, onChange, label }: Readonly<TriStateCheckboxProps>) {
  return (
    <button
      type="button"
      role="checkbox"
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className="relative flex items-center justify-center w-5 h-5 rounded border border-input hover:border-primary transition-colors"
      aria-label={label}
      aria-checked={state === 'checked' ? true : state === 'indeterminate' ? 'mixed' : false}
    >
      {state === 'checked' && (
        <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {state === 'indeterminate' && (
        <div className="w-2.5 h-0.5 bg-primary rounded-full" />
      )}
    </button>
  )
}

interface ToolToggleProps {
  tool: AvailableTool
  isEnabled: boolean
  onToggle: () => void
  indentLevel: number
  showAvailability: boolean
}

function ToolToggle({ tool, isEnabled, onToggle, indentLevel, showAvailability }: Readonly<ToolToggleProps>) {
  const checkboxId = `tool-toggle-${tool.id}`
  const paddingClass = indentLevel > 0 ? 'ml-4' : ''
  const isUnavailable = showAvailability && tool.available === false

  // For unavailable tools, show grayed out with tooltip
  if (isUnavailable) {
    return (
      <div
        className={`flex items-start gap-3 p-2 rounded opacity-50 cursor-not-allowed ${paddingClass}`}
        title={tool.unavailableReason || 'This tool is not available in the current context'}
      >
        <input
          type="checkbox"
          id={checkboxId}
          checked={false}
          disabled
          className="qt-checkbox mt-0.5 cursor-not-allowed"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground">{tool.name}</span>
            <span className="text-xs text-amber-500 dark:text-amber-400">(unavailable)</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tool.description}</p>
          {tool.unavailableReason && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 italic">
              {tool.unavailableReason}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <label
      htmlFor={checkboxId}
      className={`flex items-start gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer transition-colors ${paddingClass}`}
    >
      <input
        type="checkbox"
        id={checkboxId}
        checked={isEnabled}
        onChange={onToggle}
        className="qt-checkbox mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">{tool.name}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tool.description}</p>
      </div>
    </label>
  )
}
