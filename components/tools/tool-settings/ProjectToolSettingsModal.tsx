'use client'

/**
 * Project Tool Settings Modal
 *
 * Modal for configuring default tool settings for new chats in a project.
 * Tools configured here are applied as defaults when creating new chats in the project.
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { ToolSettingsContent } from './ToolSettingsContent'
import { useToolSettingsDraft } from './useToolSettingsDraft'
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
  // The modal stays mounted between openings, so the draft survives a
  // refetch and is discarded only on dismiss.
  const draft = useToolSettingsDraft(disabledTools, disabledToolGroups)
  const { disabledTools: localDisabledTools, disabledGroups: localDisabledGroups } = draft
  const [saving, setSaving] = useState(false)

  // Fetch available tools via TanStack Query (gated by isOpen)
  const { data: toolsData, isLoading: loading } = useQuery({
    queryKey: queryKeys.tools.all,
    queryFn: ({ signal }) => apiFetch<{ tools: AvailableTool[] }>('/api/v1/tools', { signal }),
    enabled: isOpen,
  })

  const availableTools = toolsData?.tools ?? []

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

  // Dismissing discards the unsaved toggles.
  const handleDismiss = () => {
    draft.reset()
    onClose()
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleDismiss}
      title="Default Tool Settings"
    >
      <div className="qt-dialog-body qt-dialog-body-default">
        <ToolSettingsContent
          availableTools={availableTools}
          disabledTools={localDisabledTools}
          disabledGroups={localDisabledGroups}
          onDisabledToolsChange={draft.setDisabledTools}
          onDisabledGroupsChange={draft.setDisabledGroups}
          showAvailability={false}
          loading={loading}
          footerNote="Configure which tools are enabled by default for new chats in this project. Existing chats are not affected."
        />
      </div>

      {/* Footer with save/cancel buttons */}
      <div className="qt-dialog-footer qt-dialog-footer-default">
        <button
          type="button"
          onClick={handleDismiss}
          className="qt-button-secondary"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="qt-button-primary"
          disabled={saving || !draft.dirty}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </BaseModal>
  )
}
