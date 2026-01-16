'use client'

/**
 * FileWriteApprovalModal Component
 *
 * Modal dialog for approving LLM file write requests.
 * Shows file details and offers permission scope options.
 */

import { useState } from 'react'
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
  onApprove: (scope: 'PROJECT' | 'GENERAL') => Promise<void>
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

  if (!request) return null

  const isProjectFile = !!request.projectId
  const contentPreview = request.content.length > 500
    ? request.content.slice(0, 500) + '\n... [truncated]'
    : request.content

  const handleApprove = async () => {
    try {
      setSaving(true)

      // Call completion endpoint which grants permission AND executes the write
      const res = await fetch('/api/v1/files/write-permissions?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          action: 'approve',
          pendingWrite: {
            filename: request.filename,
            content: request.content,
            mimeType: request.mimeType,
            folderPath: request.folderPath,
            projectId: request.projectId,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to complete file write')
      }

      const result = await res.json()

      showSuccessToast(result.message || 'File created successfully')

      const permissionScope: 'PROJECT' | 'GENERAL' = isProjectFile ? 'PROJECT' : 'GENERAL'
      await onApprove(permissionScope)
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[FileWriteApprovalModal] Failed to approve', {
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to approve file write')
    } finally {
      setSaving(false)
    }
  }

  const handleDeny = async () => {
    try {

      // Call completion endpoint with deny action
      await fetch('/api/v1/files/write-permissions?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          action: 'deny',
          pendingWrite: {
            filename: request.filename,
            content: request.content,
            mimeType: request.mimeType,
            folderPath: request.folderPath,
            projectId: request.projectId,
          },
        }),
      })

    } catch (error) {
      console.error('[FileWriteApprovalModal] Failed to send denial', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    // Always close and notify parent, even if API call failed
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

        {/* Permission info */}
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="qt-text-sm">
              {isProjectFile ? (
                <>
                  <span className="font-medium">Approving will grant write permission</span> for all files in
                  &quot;{request.projectName || 'this project'}&quot;.
                </>
              ) : (
                <>
                  <span className="font-medium">Approving will grant write permission</span> for all general files
                  (files not in any project).
                </>
              )}
            </div>
          </div>
        </div>

        <p className="qt-text-xs text-muted-foreground">
          You can manage or revoke file write permissions in Settings.
        </p>
      </div>
    </BaseModal>
  )
}
