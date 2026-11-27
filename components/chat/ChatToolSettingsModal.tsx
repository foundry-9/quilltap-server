'use client'

/**
 * Chat Tool Settings Modal
 *
 * Modal for configuring tool enable/disable settings for a specific chat.
 * Shows availability status for context-dependent tools.
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { ToolSettingsContent } from '@/components/tools/tool-settings'
import { useToolSettingsDraft } from '@/components/tools/tool-settings/useToolSettingsDraft'
import type { AvailableTool } from '@/components/tools/tool-settings'

interface ChatToolSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  disabledTools: string[]
  disabledToolGroups: string[]
  /** When true, tools are disabled at the connection profile level */
  profileToolsDisabled?: boolean
  onSuccess?: (newDisabledTools: string[], newDisabledToolGroups: string[]) => void
}

const EMPTY_TOOLS: AvailableTool[] = []

export default function ChatToolSettingsModal({
  isOpen,
  onClose,
  chatId,
  disabledTools,
  disabledToolGroups,
  profileToolsDisabled = false,
  onSuccess,
}: Readonly<ChatToolSettingsModalProps>) {
  const { data: availableTools = EMPTY_TOOLS, isLoading: loading, error: toolsError } = useQuery({
    queryKey: queryKeys.tools.availability(chatId),
    // chatId gives availability for the context-dependent tools.
    queryFn: ({ signal }) =>
      apiFetch<{ tools?: AvailableTool[] }>(`/api/v1/tools?chatId=${encodeURIComponent(chatId)}`, { signal }),
    select: (data) => data.tools ?? EMPTY_TOOLS,
    enabled: isOpen,
  })
  useEffect(() => {
    if (toolsError) showErrorToast('Failed to load available tools')
  }, [toolsError])

  // Drafts of the chat's two lists. A chat refetch hands in new arrays with
  // the same values; the draft adopts a server change only while the
  // operator has not edited, so unsaved toggles survive it.
  const draft = useToolSettingsDraft(disabledTools, disabledToolGroups)
  const {
    disabledTools: localDisabledTools,
    disabledGroups: localDisabledGroups,
    setDisabledTools: setLocalDisabledTools,
    setDisabledGroups: setLocalDisabledGroups,
  } = draft
  const [saving, setSaving] = useState(false)

  // Save changes
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await apiFetch(`/api/v1/chats/${chatId}?action=update-tool-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disabledTools: Array.from(localDisabledTools),
          disabledToolGroups: Array.from(localDisabledGroups),
        }),
      })

      showSuccessToast('Tool settings saved')
      onSuccess?.(Array.from(localDisabledTools), Array.from(localDisabledGroups))
      onClose()
    } catch (error) {
      showErrorToast(apiErrorMessage(error, 'Failed to save tool settings'))
      console.error('Error saving tool settings:', error)
    } finally {
      setSaving(false)
    }
  }, [chatId, localDisabledTools, localDisabledGroups, onSuccess, onClose])

  const hasChanges = () => draft.dirty

  // Dismissing discards the unsaved toggles (the modal stays mounted).
  const handleDismiss = () => {
    draft.reset()
    onClose()
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleDismiss}
      title="LLM Tool Settings"
    >
      <div className="qt-dialog-body qt-dialog-body-default">
        {profileToolsDisabled && (
          <div className="qt-warning-box mb-4">
            <p className="qt-label">Tools disabled by connection profile</p>
            <p className="text-xs mt-1">
              The current connection profile has &ldquo;Allow tool use&rdquo; turned off. No tools will be sent to the LLM regardless of the settings below. To re-enable tools, edit the connection profile in The Forge.
            </p>
          </div>
        )}
        <ToolSettingsContent
          availableTools={availableTools}
          disabledTools={localDisabledTools}
          disabledGroups={localDisabledGroups}
          onDisabledToolsChange={setLocalDisabledTools}
          onDisabledGroupsChange={setLocalDisabledGroups}
          showAvailability={true}
          loading={loading}
          footerNote="Disabled tools will not be available to the AI for this chat. Changes take effect on the next message."
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
          disabled={saving || !hasChanges()}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </BaseModal>
  )
}
