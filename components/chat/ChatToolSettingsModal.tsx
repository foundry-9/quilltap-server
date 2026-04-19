'use client'

/**
 * Chat Tool Settings Modal
 *
 * Modal for configuring tool enable/disable settings for a specific chat.
 * Shows availability status for context-dependent tools.
 */

import { useState, useEffect, useCallback } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { ToolSettingsContent } from '@/components/tools/tool-settings'
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

export default function ChatToolSettingsModal({
  isOpen,
  onClose,
  chatId,
  disabledTools,
  disabledToolGroups,
  profileToolsDisabled = false,
  onSuccess,
}: Readonly<ChatToolSettingsModalProps>) {
  const [availableTools, setAvailableTools] = useState<AvailableTool[]>([])
  const [localDisabledTools, setLocalDisabledTools] = useState<Set<string>>(new Set(disabledTools))
  const [localDisabledGroups, setLocalDisabledGroups] = useState<Set<string>>(new Set(disabledToolGroups))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
      } catch (error) {
        showErrorToast('Failed to load available tools')
        console.error('Error fetching tools:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchTools()
  }, [isOpen, chatId])

  // Reset local state when props change (modal always mounted)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form state must re-sync when parent updates (parent renders unconditionally)
    setLocalDisabledTools(new Set(disabledTools))
    setLocalDisabledGroups(new Set(disabledToolGroups))
  }, [disabledTools, disabledToolGroups])

  // Save changes
  const handleSave = useCallback(async () => {
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
  }, [chatId, localDisabledTools, localDisabledGroups, onSuccess, onClose])

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
      title="LLM Tool Settings"
    >
      <div className="qt-dialog-body">
        {profileToolsDisabled && (
          <div className="qt-warning-box mb-4">
            <p className="text-sm font-medium">Tools disabled by connection profile</p>
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
