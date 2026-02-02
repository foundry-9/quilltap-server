'use client'

import { useState, useEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

interface StateEditorModalProps {
  isOpen: boolean
  onClose: () => void
  entityType: 'chat' | 'project'
  entityId: string
  entityName: string
  onSuccess?: () => void
}

export default function StateEditorModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  onSuccess,
}: Readonly<StateEditorModalProps>) {
  const [state, setState] = useState<Record<string, unknown>>({})
  const [chatState, setChatState] = useState<Record<string, unknown>>({})
  const [projectState, setProjectState] = useState<Record<string, unknown> | null>(null)
  const [projectId, setProjectId] = useState<string | undefined>()
  const [stateText, setStateText] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Fetch state when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchState()
    }
  }, [isOpen, entityType, entityId])

  const fetchState = async () => {
    try {
      setLoading(true)
      setJsonError(null)

      const url = entityType === 'chat'
        ? `/api/v1/chats/${entityId}?action=get-state`
        : `/api/v1/projects/${entityId}?action=get-state`

      const res = await fetch(url)
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to fetch state')
      }

      const data = await res.json()
      setState(data.state || {})
      setStateText(JSON.stringify(data.state || {}, null, 2))

      // For chats, also store separate chat and project states
      if (entityType === 'chat') {
        setChatState(data.chatState || {})
        setProjectState(data.projectState || null)
        setProjectId(data.projectId)
      }

      setIsEditing(false)
    } catch (error) {
      console.error('[StateEditorModal] Failed to fetch state', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to fetch state')
    } finally {
      setLoading(false)
    }
  }

  const handleTextChange = (value: string) => {
    setStateText(value)

    // Validate JSON
    try {
      JSON.parse(value)
      setJsonError(null)
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const handleSave = async () => {
    try {
      const newState = JSON.parse(stateText)

      if (typeof newState !== 'object' || newState === null || Array.isArray(newState)) {
        showErrorToast('State must be a JSON object')
        return
      }

      setSaving(true)

      const url = entityType === 'chat'
        ? `/api/v1/chats/${entityId}?action=set-state`
        : `/api/v1/projects/${entityId}?action=set-state`

      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to save state')
      }

      setState(newState)
      setStateText(JSON.stringify(newState, null, 2))
      setIsEditing(false)
      showSuccessToast('State saved')
      onSuccess?.()
    } catch (error) {
      console.error('[StateEditorModal] Failed to save state', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to save state')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    try {
      setResetting(true)

      const url = entityType === 'chat'
        ? `/api/v1/chats/${entityId}?action=reset-state`
        : `/api/v1/projects/${entityId}?action=reset-state`

      const res = await fetch(url, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to reset state')
      }

      setState({})
      setStateText(JSON.stringify({}, null, 2))
      setIsEditing(false)
      setShowResetConfirm(false)
      showSuccessToast('State reset')
      onSuccess?.()
    } catch (error) {
      console.error('[StateEditorModal] Failed to reset state', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to reset state')
    } finally {
      setResetting(false)
    }
  }

  const handleCancel = () => {
    setStateText(JSON.stringify(state, null, 2))
    setJsonError(null)
    setIsEditing(false)
  }

  const isLoading = loading || saving || resetting
  const hasState = Object.keys(state).length > 0

  const footer = (
    <div className="flex justify-between gap-2">
      <div>
        {!showResetConfirm && hasState && (
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={isLoading}
            className="qt-button qt-button-danger-outline"
          >
            Reset State
          </button>
        )}
        {showResetConfirm && (
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={isLoading}
              className="qt-button qt-button-danger"
            >
              {resetting ? 'Resetting...' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => setShowResetConfirm(false)}
              disabled={isLoading}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        {isEditing ? (
          <>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="qt-button qt-button-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading || !!jsonError}
              className="qt-button qt-button-primary"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="qt-button qt-button-secondary"
            >
              Close
            </button>
            <button
              onClick={() => setIsEditing(true)}
              disabled={isLoading}
              className="qt-button qt-button-primary"
            >
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${entityType === 'chat' ? 'Chat' : 'Project'} State - ${entityName}`}
      maxWidth="2xl"
      footer={footer}
      closeOnClickOutside={!isEditing}
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <svg
            className="animate-spin h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="ml-2">Loading state...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Info section for chat state inheritance */}
          {entityType === 'chat' && projectState !== null && (
            <div className="qt-text-xs p-3 bg-muted rounded-md">
              <p className="mb-1">
                <strong>Note:</strong> This chat is part of a project. The merged state shown
                below combines project state with chat-specific state (chat values override project values).
              </p>
              {Object.keys(projectState).length > 0 && (
                <p className="text-muted-foreground">
                  Inherited from project: {Object.keys(projectState).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* State editor */}
          <div>
            <label className="qt-label mb-2 flex items-center justify-between">
              <span>State (JSON)</span>
              {!hasState && !isEditing && (
                <span className="qt-text-xs text-muted-foreground">No state data</span>
              )}
            </label>
            <textarea
              value={stateText}
              onChange={(e) => handleTextChange(e.target.value)}
              readOnly={!isEditing}
              rows={12}
              className={`qt-textarea font-mono text-sm w-full ${
                isEditing ? '' : 'bg-muted cursor-default'
              } ${jsonError ? 'border-destructive' : ''}`}
              placeholder={isEditing ? '{\n  "key": "value"\n}' : 'No state data'}
            />
            {jsonError && isEditing && (
              <p className="qt-text-xs text-destructive mt-1">
                {jsonError}
              </p>
            )}
          </div>

          {/* Help text */}
          <div className="qt-text-xs text-muted-foreground">
            <p className="mb-1">
              State is persistent JSON data that can be used for games, inventory tracking,
              session data, and other information.
            </p>
            <p>
              Keys starting with underscore (_) are user-only and will not be modified by AI.
            </p>
          </div>
        </div>
      )}
    </BaseModal>
  )
}
