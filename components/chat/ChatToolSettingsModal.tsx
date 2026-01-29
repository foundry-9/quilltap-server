'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

// Icon components (inline SVG to avoid dependencies)
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

interface AvailableTool {
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

interface ChatToolSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  disabledTools: string[]
  disabledToolGroups: string[]
  onSuccess?: (newDisabledTools: string[], newDisabledToolGroups: string[]) => void
}

/**
 * Hierarchical structure for displaying tools
 */
interface ToolGroup {
  id: string
  displayName: string
  type: 'built-in' | 'plugin'
  pluginName?: string
  subgroups: ToolSubgroup[]
  tools: AvailableTool[] // Tools without subgroup (direct children)
}

interface ToolSubgroup {
  id: string
  displayName: string
  pluginName: string
  tools: AvailableTool[]
}

/**
 * Group pattern format:
 * - Plugin level: "plugin:{pluginName}"
 * - Subgroup level: "plugin:{pluginName}:subgroup:{subgroupId}"
 */
function makePluginGroupPattern(pluginName: string): string {
  return `plugin:${pluginName}`
}

function makeSubgroupPattern(pluginName: string, subgroupId: string): string {
  return `plugin:${pluginName}:subgroup:${subgroupId}`
}

/**
 * Determine the checkbox state for a group based on its children
 */
type CheckState = 'checked' | 'unchecked' | 'indeterminate'

function getGroupCheckState(
  enabledCount: number,
  totalCount: number
): CheckState {
  if (enabledCount === totalCount) return 'checked'
  if (enabledCount === 0) return 'unchecked'
  return 'indeterminate'
}

export default function ChatToolSettingsModal({
  isOpen,
  onClose,
  chatId,
  disabledTools,
  disabledToolGroups,
  onSuccess,
}: Readonly<ChatToolSettingsModalProps>) {
  const [availableTools, setAvailableTools] = useState<AvailableTool[]>([])
  const [localDisabledTools, setLocalDisabledTools] = useState<Set<string>>(new Set(disabledTools))
  const [localDisabledGroups, setLocalDisabledGroups] = useState<Set<string>>(new Set(disabledToolGroups))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(new Set())

  // Fetch available tools when modal opens
  useEffect(() => {
    if (!isOpen) return

    const fetchTools = async () => {
      setLoading(true)
      try {
        // Pass chatId to get availability info for context-dependent tools
        const response = await fetch(`/api/v1/tools?chatId=${encodeURIComponent(chatId)}`)
        if (!response.ok) {
          throw new Error('Failed to fetch tools')
        }
        const data = await response.json()
        setAvailableTools(data.tools || [])

        // Auto-expand all groups initially
        const allGroupIds = new Set<string>()
        const allSubgroupIds = new Set<string>()

        // Built-in tools group
        allGroupIds.add('built-in')

        // Plugin groups and subgroups
        const tools = data.tools || []
        for (const tool of tools) {
          if (tool.source === 'plugin' && tool.pluginName) {
            allGroupIds.add(`plugin:${tool.pluginName}`)
            if (tool.subgroupId) {
              allSubgroupIds.add(`plugin:${tool.pluginName}:subgroup:${tool.subgroupId}`)
            }
          }
        }

        setExpandedGroups(allGroupIds)
        setExpandedSubgroups(allSubgroupIds)
      } catch (error) {
        showErrorToast('Failed to load available tools')
        console.error('Error fetching tools:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTools()
  }, [isOpen, chatId])

  // Reset local state when props change
  useEffect(() => {
    setLocalDisabledTools(new Set(disabledTools))
    setLocalDisabledGroups(new Set(disabledToolGroups))
  }, [disabledTools, disabledToolGroups])

  // Build hierarchical structure from flat tool list
  const toolHierarchy = useMemo(() => {
    const builtInTools: AvailableTool[] = []
    const pluginGroups = new Map<string, {
      displayName: string
      subgroups: Map<string, { displayName: string; tools: AvailableTool[] }>
      directTools: AvailableTool[]
    }>()

    for (const tool of availableTools) {
      if (tool.source === 'built-in') {
        builtInTools.push(tool)
      } else if (tool.pluginName) {
        // Get or create plugin group
        if (!pluginGroups.has(tool.pluginName)) {
          pluginGroups.set(tool.pluginName, {
            displayName: tool.pluginName.charAt(0).toUpperCase() + tool.pluginName.slice(1),
            subgroups: new Map(),
            directTools: [],
          })
        }
        const group = pluginGroups.get(tool.pluginName)!

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
  }, [availableTools])

  // Check if a tool is enabled (not disabled by individual or group pattern)
  const isToolEnabled = useCallback((tool: AvailableTool): boolean => {
    // Check individual disable
    if (localDisabledTools.has(tool.id)) return false

    // Check plugin-level group disable
    if (tool.pluginName && localDisabledGroups.has(makePluginGroupPattern(tool.pluginName))) {
      return false
    }

    // Check subgroup-level disable
    if (tool.pluginName && tool.subgroupId) {
      if (localDisabledGroups.has(makeSubgroupPattern(tool.pluginName, tool.subgroupId))) {
        return false
      }
    }

    return true
  }, [localDisabledTools, localDisabledGroups])

  // Count enabled tools (only count tools that are actually available)
  const { enabledCount, availableCount } = useMemo(() => {
    const available = availableTools.filter(t => t.available !== false)
    const enabled = available.filter(isToolEnabled)
    return { enabledCount: enabled.length, availableCount: available.length }
  }, [availableTools, isToolEnabled])

  // Toggle individual tool
  const handleToggleTool = useCallback((tool: AvailableTool) => {
    setLocalDisabledTools(prev => {
      const newSet = new Set(prev)
      if (newSet.has(tool.id)) {
        newSet.delete(tool.id)
      } else {
        newSet.add(tool.id)
      }
      return newSet
    })
  }, [])

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
      setLocalDisabledTools(prev => {
        const newSet = new Set(prev)
        for (const tool of allToolsInGroup) {
          if (shouldEnable) {
            newSet.delete(tool.id)
          } else {
            newSet.add(tool.id)
          }
        }
        return newSet
      })
    } else if (group.pluginName) {
      // For plugin groups, use group pattern
      setLocalDisabledGroups(prev => {
        const newSet = new Set(prev)
        const pattern = makePluginGroupPattern(group.pluginName!)

        if (shouldEnable) {
          // Remove the plugin group pattern
          newSet.delete(pattern)
          // Also remove any subgroup patterns
          for (const sg of group.subgroups) {
            newSet.delete(makeSubgroupPattern(group.pluginName!, sg.id))
          }
          // And remove individual tool disables from this plugin
          setLocalDisabledTools(prevTools => {
            const newToolSet = new Set(prevTools)
            for (const tool of allToolsInGroup) {
              newToolSet.delete(tool.id)
            }
            return newToolSet
          })
        } else {
          // Add the plugin group pattern
          newSet.add(pattern)
        }
        return newSet
      })
    }
  }, [isToolEnabled])

  // Toggle subgroup
  const handleToggleSubgroup = useCallback((subgroup: ToolSubgroup) => {
    const enabledInSubgroup = subgroup.tools.filter(isToolEnabled).length
    const shouldEnable = enabledInSubgroup < subgroup.tools.length

    setLocalDisabledGroups(prev => {
      const newSet = new Set(prev)
      const pattern = makeSubgroupPattern(subgroup.pluginName, subgroup.id)

      if (shouldEnable) {
        // Remove the subgroup pattern
        newSet.delete(pattern)
        // Also remove individual tool disables from this subgroup
        setLocalDisabledTools(prevTools => {
          const newToolSet = new Set(prevTools)
          for (const tool of subgroup.tools) {
            newToolSet.delete(tool.id)
          }
          return newToolSet
        })
      } else {
        // Add the subgroup pattern (unless parent plugin is disabled)
        const pluginPattern = makePluginGroupPattern(subgroup.pluginName)
        if (!newSet.has(pluginPattern)) {
          newSet.add(pattern)
        }
      }
      return newSet
    })
  }, [isToolEnabled])

  // Enable all / disable all
  const handleEnableAll = useCallback(() => {
    setLocalDisabledTools(new Set())
    setLocalDisabledGroups(new Set())
  }, [])

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

    setLocalDisabledTools(newTools)
    setLocalDisabledGroups(newGroups)
  }, [toolHierarchy])

  // Toggle expand/collapse
  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupId)) {
        newSet.delete(groupId)
      } else {
        newSet.add(groupId)
      }
      return newSet
    })
  }, [])

  const toggleSubgroupExpanded = useCallback((subgroupId: string) => {
    setExpandedSubgroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(subgroupId)) {
        newSet.delete(subgroupId)
      } else {
        newSet.add(subgroupId)
      }
      return newSet
    })
  }, [])

  // Save changes
  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/v1/chats/${chatId}?action=update-tool-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disabledTools: Array.from(localDisabledTools),
          disabledToolGroups: Array.from(localDisabledGroups),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to save tool settings')
      }

      showSuccessToast('Tool settings saved')
      onSuccess?.(Array.from(localDisabledTools), Array.from(localDisabledGroups))
      onClose()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to save tool settings')
      console.error('Error saving tool settings:', error)
    } finally {
      setSaving(false)
    }
  }

  // Check for changes
  const hasChanges = () => {
    const originalToolSet = new Set(disabledTools)
    const originalGroupSet = new Set(disabledToolGroups)

    // Check tool differences
    if (originalToolSet.size !== localDisabledTools.size) return true
    for (const tool of localDisabledTools) {
      if (!originalToolSet.has(tool)) return true
    }

    // Check group differences
    if (originalGroupSet.size !== localDisabledGroups.size) return true
    for (const group of localDisabledGroups) {
      if (!originalGroupSet.has(group)) return true
    }

    return false
  }

  // Get check state for a group
  const getGroupState = (group: ToolGroup): CheckState => {
    const allTools = [...group.tools, ...group.subgroups.flatMap(sg => sg.tools)]
    const enabledInGroup = allTools.filter(isToolEnabled).length
    return getGroupCheckState(enabledInGroup, allTools.length)
  }

  // Get check state for a subgroup
  const getSubgroupState = (subgroup: ToolSubgroup): CheckState => {
    const enabledInSubgroup = subgroup.tools.filter(isToolEnabled).length
    return getGroupCheckState(enabledInSubgroup, subgroup.tools.length)
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="LLM Tool Settings"
    >
      <div className="qt-dialog-body">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-muted-foreground border-t-primary rounded-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Description and quick actions */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {enabledCount} of {availableCount} tools enabled
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
                  isExpanded={expandedGroups.has(group.id)}
                  onToggleExpand={() => toggleGroupExpanded(group.id)}
                  checkState={getGroupState(group)}
                  onToggleGroup={() => handleToggleGroup(group)}
                  expandedSubgroups={expandedSubgroups}
                  onToggleSubgroupExpand={toggleSubgroupExpanded}
                  getSubgroupState={getSubgroupState}
                  onToggleSubgroup={handleToggleSubgroup}
                  isToolEnabled={isToolEnabled}
                  onToggleTool={handleToggleTool}
                />
              ))}
            </div>

            {availableTools.length === 0 && !loading && (
              <div className="text-center py-4 text-muted-foreground">
                No tools available
              </div>
            )}

            {/* Info note */}
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Disabled tools will not be available to the AI for this chat. Changes take effect on the next message.
            </p>
          </div>
        )}
      </div>

      {/* Footer with save/cancel buttons */}
      <div className="qt-dialog-footer">
        <button
          type="button"
          onClick={onClose}
          className="qt-button-secondary"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="qt-button-primary"
          disabled={saving || !hasChanges()}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </BaseModal>
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
  expandedSubgroups: Set<string>
  onToggleSubgroupExpand: (id: string) => void
  getSubgroupState: (subgroup: ToolSubgroup) => CheckState
  onToggleSubgroup: (subgroup: ToolSubgroup) => void
  isToolEnabled: (tool: AvailableTool) => boolean
  onToggleTool: (tool: AvailableTool) => void
}

function GroupSection({
  group,
  isExpanded,
  onToggleExpand,
  checkState,
  onToggleGroup,
  expandedSubgroups,
  onToggleSubgroupExpand,
  getSubgroupState,
  onToggleSubgroup,
  isToolEnabled,
  onToggleTool,
}: Readonly<GroupSectionProps>) {
  const allTools = [...group.tools, ...group.subgroups.flatMap(sg => sg.tools)]
  // Only count tools that are actually available (not grayed out)
  const availableTools = allTools.filter(t => t.available !== false)
  const availableToolCount = availableTools.length
  const enabledToolCount = availableTools.filter(isToolEnabled).length
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
            />
          ))}

          {/* Subgroups */}
          {group.subgroups.map(subgroup => (
            <SubgroupSection
              key={`${group.pluginName}:${subgroup.id}`}
              subgroup={subgroup}
              isExpanded={expandedSubgroups.has(makeSubgroupPattern(subgroup.pluginName, subgroup.id))}
              onToggleExpand={() => onToggleSubgroupExpand(makeSubgroupPattern(subgroup.pluginName, subgroup.id))}
              checkState={getSubgroupState(subgroup)}
              onToggleSubgroup={() => onToggleSubgroup(subgroup)}
              isToolEnabled={isToolEnabled}
              onToggleTool={onToggleTool}
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
}

function SubgroupSection({
  subgroup,
  isExpanded,
  onToggleExpand,
  checkState,
  onToggleSubgroup,
  isToolEnabled,
  onToggleTool,
}: Readonly<SubgroupSectionProps>) {
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon
  // Only count tools that are actually available (not grayed out)
  const availableTools = subgroup.tools.filter(t => t.available !== false)
  const totalCount = availableTools.length
  const enabledCount = availableTools.filter(isToolEnabled).length

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
}

function ToolToggle({ tool, isEnabled, onToggle, indentLevel }: Readonly<ToolToggleProps>) {
  const checkboxId = `tool-toggle-${tool.id}`
  const paddingClass = indentLevel > 0 ? 'ml-4' : ''
  const isUnavailable = tool.available === false

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
