'use client'

/**
 * Model Behavior Card
 *
 * Card displaying agent mode and default tool settings for a project.
 */

import { useState, useCallback, useMemo } from 'react'
import type { Project } from '../types'
import { ProjectToolSettingsModal } from '@/components/tools/tool-settings'
import { ChevronIcon } from '@/components/ui/ChevronIcon'

interface ModelBehaviorCardProps {
  project: Project
  onAgentModeChange: (enabled: boolean | null) => void
  expanded: boolean
  onToggle: () => void
  onProjectUpdate?: () => void
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  )
}

export function ModelBehaviorCard({
  project,
  onAgentModeChange,
  expanded,
  onToggle,
  onProjectUpdate,
}: ModelBehaviorCardProps) {
  const [showToolSettingsModal, setShowToolSettingsModal] = useState(false)
  const [localDisabledTools, setLocalDisabledTools] = useState<string[]>(project.defaultDisabledTools || [])
  const [localDisabledToolGroups, setLocalDisabledToolGroups] = useState<string[]>(project.defaultDisabledToolGroups || [])

  const toolSummary = useMemo(() => {
    const toolCount = localDisabledTools.length
    const groupCount = localDisabledToolGroups.length
    if (toolCount === 0 && groupCount === 0) {
      return 'All tools enabled'
    }
    const parts: string[] = []
    if (toolCount > 0) {
      parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''} disabled`)
    }
    if (groupCount > 0) {
      parts.push(`${groupCount} group${groupCount !== 1 ? 's' : ''} disabled`)
    }
    return parts.join(', ')
  }, [localDisabledTools, localDisabledToolGroups])

  const handleToolSettingsSuccess = useCallback((newDisabledTools: string[], newDisabledToolGroups: string[]) => {
    setLocalDisabledTools(newDisabledTools)
    setLocalDisabledToolGroups(newDisabledToolGroups)
    onProjectUpdate?.()
  }, [onProjectUpdate])

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <BrainIcon className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Model Behavior</h3>
            <p className="qt-text-small qt-text-secondary">
              Agent mode &amp; tool defaults
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default p-4 space-y-4">
          {/* Agent Mode Setting */}
          <div className="p-3 rounded-lg qt-border qt-bg-surface">
            <h4 className="qt-label text-foreground mb-1">Agent Mode</h4>
            <p className="qt-text-xs qt-text-secondary mb-2">
              Default agent mode for chats in this project. Agent mode allows iterative tool use with self-correction.
            </p>
            <select
              value={project.defaultAgentModeEnabled === null || project.defaultAgentModeEnabled === undefined ? 'inherit' : project.defaultAgentModeEnabled ? 'enabled' : 'disabled'}
              onChange={(e) => {
                const value = e.target.value
                onAgentModeChange(value === 'inherit' ? null : value === 'enabled')
              }}
              className="qt-input w-full max-w-xs"
            >
              <option value="inherit">Inherit from global/character</option>
              <option value="enabled">Enabled by default</option>
              <option value="disabled">Disabled by default</option>
            </select>
          </div>

          {/* Default Tool Settings */}
          <div className="flex items-center justify-between p-3 rounded-lg qt-border qt-bg-surface">
            <div>
              <h4 className="qt-label text-foreground">Default Tool Settings</h4>
              <p className="qt-text-xs qt-text-secondary">
                {toolSummary}
              </p>
            </div>
            <button
              onClick={() => setShowToolSettingsModal(true)}
              className="qt-button qt-button-secondary qt-button-sm"
            >
              Configure
            </button>
          </div>
        </div>
      )}

      {/* Tool Settings Modal */}
      <ProjectToolSettingsModal
        isOpen={showToolSettingsModal}
        onClose={() => setShowToolSettingsModal(false)}
        projectId={project.id}
        disabledTools={localDisabledTools}
        disabledToolGroups={localDisabledToolGroups}
        onSuccess={handleToolSettingsSuccess}
      />
    </div>
  )
}
