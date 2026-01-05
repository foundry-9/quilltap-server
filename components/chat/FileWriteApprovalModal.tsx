'use client'

/**
 * FileWriteApprovalModal Component
 *
 * Modal dialog for approving LLM file write requests.
 * Shows file details and offers permission scope options.
 */

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

interface FileWriteRequest {
  filename: string
  content: string
  mimeType: string
  folderPath: string
  projectId: string | null
  projectName?: string | null
}

interface FileWriteApprovalModalProps {
  isOpen: boolean
  onClose: () => void
  request: FileWriteRequest | null
  chatId: string
  onApprove: (scope: 'SINGLE_FILE' | 'PROJECT' | 'GENERAL') => Promise<void>
  onDeny: () => void
}

export default function FileWriteApprovalModal({
  isOpen,
  onClose,
  request,
  chatId,
  onApprove,
  onDeny,
}: Readonly<FileWriteApprovalModalProps>) {
  const [saving, setSaving] = useState(false)
  const [selectedScope, setSelectedScope] = useState<'single' | 'project' | 'general'>('single')

  if (!request) return null

  const isProjectFile = !!request.projectId
  const contentPreview = request.content.length > 500
    ? request.content.slice(0, 500) + '\n... [truncated]'
    : request.content

  const handleApprove = async () => {
    try {
      setSaving(true)
      clientLogger.debug('[FileWriteApprovalModal] Approving file write', {
        filename: request.filename,
        scope: selectedScope,
        projectId: request.projectId,
      })

      // Determine permission scope based on selection
      let permissionScope: 'SINGLE_FILE' | 'PROJECT' | 'GENERAL'
      if (selectedScope === 'project' && isProjectFile) {
        permissionScope = 'PROJECT'
      } else if (selectedScope === 'general' && !isProjectFile) {
        permissionScope = 'GENERAL'
      } else {
        // For single file approval, we don't create a persistent permission
        // The actual write is handled by the parent component
        permissionScope = 'SINGLE_FILE'
      }

      // Grant permission via API
      const permissionBody: Record<string, unknown> = {
        scope: permissionScope,
        chatId,
      }

      if (permissionScope === 'PROJECT' && request.projectId) {
        permissionBody.projectId = request.projectId
      }

      const res = await fetch('/api/files/write-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permissionBody),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to grant permission')
      }

      clientLogger.info('[FileWriteApprovalModal] Permission granted', {
        scope: permissionScope,
        projectId: request.projectId,
      })

      showSuccessToast(
        permissionScope === 'PROJECT'
          ? `File write permission granted for project "${request.projectName}"`
          : permissionScope === 'GENERAL'
          ? 'File write permission granted for general files'
          : 'File write approved'
      )

      await onApprove(permissionScope)
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      clientLogger.error('[FileWriteApprovalModal] Failed to approve', {
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to approve file write')
    } finally {
      setSaving(false)
    }
  }

  const handleDeny = () => {
    clientLogger.debug('[FileWriteApprovalModal] File write denied', {
      filename: request.filename,
    })
    onDeny()
    onClose()
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={handleDeny}
        disabled={saving}
        className="qt-button qt-button-secondary"
      >
        Deny
      </button>
      <button
        onClick={handleApprove}
        disabled={saving}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Approving...' : 'Approve'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleDeny}
      title="File Write Request"
      footer={footer}
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
    >
      <div className="space-y-4">
        {/* File info */}
        <div className="p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📁</span>
            <span className="font-medium">{request.filename}</span>
          </div>
          <div className="qt-text-xs text-muted-foreground space-y-1">
            <div>Type: {request.mimeType}</div>
            <div>
              Location: {isProjectFile ? request.projectName || 'Project' : 'General Files'}
              {request.folderPath !== '/' && ` / ${request.folderPath}`}
            </div>
            <div>Size: {request.content.length.toLocaleString()} characters</div>
          </div>
        </div>

        {/* Content preview */}
        <div>
          <label className="qt-label mb-2">Content Preview</label>
          <div className="bg-background border border-border rounded-lg p-3 max-h-40 overflow-y-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
              {contentPreview}
            </pre>
          </div>
        </div>

        {/* Permission scope selection */}
        <div>
          <label className="qt-label mb-2">Permission Scope</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="single"
                checked={selectedScope === 'single'}
                onChange={() => setSelectedScope('single')}
                disabled={saving}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Approve this write only</div>
                <div className="qt-text-xs text-muted-foreground">
                  One-time approval for this specific file
                </div>
              </div>
            </label>

            {isProjectFile && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="project"
                  checked={selectedScope === 'project'}
                  onChange={() => setSelectedScope('project')}
                  disabled={saving}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">
                    Approve all writes to &quot;{request.projectName || 'this project'}&quot;
                  </div>
                  <div className="qt-text-xs text-muted-foreground">
                    Allow future file writes to this project without asking
                  </div>
                </div>
              </label>
            )}

            {!isProjectFile && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  value="general"
                  checked={selectedScope === 'general'}
                  onChange={() => setSelectedScope('general')}
                  disabled={saving}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Approve all general file writes</div>
                  <div className="qt-text-xs text-muted-foreground">
                    Allow future file writes to general files without asking
                  </div>
                </div>
              </label>
            )}
          </div>
        </div>

        <p className="qt-text-xs text-muted-foreground">
          You can manage or revoke file write permissions in Settings.
        </p>
      </div>
    </BaseModal>
  )
}
