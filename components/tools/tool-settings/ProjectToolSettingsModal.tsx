'use client'

/**
 * Project Tool Settings Modal
 *
 * Modal for configuring default tool settings for new chats in a project.
 * Tools configured here are applied as defaults when creating new chats in the project.
 */

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { ToolSettingsContent } from './ToolSettingsContent'
import type { AvailableTool } from './types'

interface ProjectToolSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  disabledTools: string[]
  disabledToolGroups: string[]
  onSuccess?: (newDisabledTools: string[], newDisabledToolGroups: string[]) => void
}

export function ProjectToolSettingsModal({
  isOpen,
  onClose,
  projectId,
  disabledTools,
  disabledToolGroups,
  onSuccess,
}: Readonly<ProjectToolSettingsModalProps>) {
  const [localDisabledTools, setLocalDisabledTools] = useState<Set<string>>(new Set(disabledTools))
  const [localDisabledGroups, setLocalDisabledGroups] = useState<Set<string>>(new Set(disabledToolGroups))
  const [saving, setSaving] = useState(false)

  // Fetch available tools via SWR (gated by isOpen)
  const { data: toolsData, isLoading: loading } = useSWR<{ tools: AvailableTool[] }>(
    isOpen ? '/api/v1/tools' : null
  )

  const availableTools = toolsData?.tools ?? []

  // Reset local state when props change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- user-editable local state must re-sync when upstream disabledTools changes (parent renders unconditionally)
    setLocalDisabledTools(new Set(disabledTools))
    setLocalDisabledGroups(new Set(disabledToolGroups))
  }, [disabledTools, disabledToolGroups])

  // Save changes
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/v1/projects/${projectId}?action=update-tool-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultDisabledTools: Array.from(localDisabledTools),
          defaultDisabledToolGroups: Array.from(localDisabledGroups),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to save tool settings')
      }

      showSuccessToast('Default tool settings saved')
      onSuccess?.(Array.from(localDisabledTools), Array.from(localDisabledGroups))
      onClose()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to save tool settings')
      console.error('Error saving tool settings:', error)
    } finally {
      setSaving(false)
    }
  }, [projectId, localDisabledTools, localDisabledGroups, onSuccess, onClose])

  // Check for changes
  const hasChanges = useCallback(() => {
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
  }, [disabledTools, disabledToolGroups, localDisabledTools, localDisabledGroups])

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Default Tool Settings"
    >
      <div className="qt-dialog-body">
        <ToolSettingsContent
          availableTools={availableTools}
          disabledTools={localDisabledTools}
          disabledGroups={localDisabledGroups}
          onDisabledToolsChange={setLocalDisabledTools}
          onDisabledGroupsChange={setLocalDisabledGroups}
          showAvailability={false}
          loading={loading}
          footerNote="Configure which tools are enabled by default for new chats in this project. Existing chats are not affected."
        />
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
