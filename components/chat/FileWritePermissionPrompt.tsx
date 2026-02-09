'use client'

/**
 * FileWritePermissionPrompt Component
 *
 * Inline chat prompt for LLM file write permission requests.
 * Displays prominently in the chat area and auto-scrolls into view.
 * Provides quick approve/deny actions with option to view details.
 *
 * @module components/chat/FileWritePermissionPrompt
 */

import { useEffect, useRef, useState } from 'react'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'

interface FileWriteRequest {
  filename: string
  content?: string
  mimeType?: string
  folderPath: string
  projectId: string | null
}

interface FileWritePermissionPromptProps {
  /** The pending file write request */
  request: FileWriteRequest
  /** Project name for display */
  projectName?: string
  /** Chat ID for permission granting */
  chatId: string
  /** Called when user approves (quick approve = SINGLE_FILE scope) */
  onApprove: (scope: 'SINGLE_FILE' | 'PROJECT' | 'GENERAL') => Promise<void>
  /** Called when user denies */
  onDeny: () => void
  /** Called when user wants to see full details modal */
  onViewDetails: () => void
  /** Called after the prompt is mounted, for scroll handling */
  onMounted?: () => void
}

export function FileWritePermissionPrompt({
  request,
  projectName,
  chatId,
  onApprove,
  onDeny,
  onViewDetails,
  onMounted,
}: FileWritePermissionPromptProps) {
  const promptRef = useRef<HTMLDivElement>(null)
  const [isApproving, setIsApproving] = useState(false)

  // Log when component mounts and call onMounted for scroll handling
  useEffect(() => {

    // Scroll into view when mounted
    if (promptRef.current) {
      promptRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }

    onMounted?.()
  }, [request.filename, request.folderPath, request.projectId, onMounted])

  const handleQuickApprove = async () => {
    try {
      setIsApproving(true)

      // Call completion endpoint which grants permission AND executes the write
      const res = await fetch('/api/v1/files/write-permissions?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          action: 'approve',
          pendingWrite: {
            filename: request.filename,
            content: request.content || '',
            mimeType: request.mimeType || 'text/plain',
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
      await onApprove(request.projectId ? 'PROJECT' : 'GENERAL')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[FileWritePermissionPrompt] Failed to approve', {
        error: errorMessage,
      })
      showErrorToast(errorMessage || 'Failed to approve file write')
    } finally {
      setIsApproving(false)
    }
  }

  const handleDeny = async () => {
    try {
      // Call completion endpoint with deny action
      const res = await fetch('/api/v1/files/write-permissions?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          action: 'deny',
          pendingWrite: {
            filename: request.filename,
            content: request.content || '',
            mimeType: request.mimeType || 'text/plain',
            folderPath: request.folderPath,
            projectId: request.projectId,
          },
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to deny file write')
      }

      showInfoToast('File write request denied')
      onDeny()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[FileWritePermissionPrompt] Failed to deny', {
        error: errorMessage,
      })
      // Still dismiss the prompt even if API call failed
      onDeny()
    }
  }

  const isProjectFile = !!request.projectId
  const locationText = isProjectFile
    ? projectName || 'Project'
    : 'General Files'

  return (
    <div
      ref={promptRef}
      className="mx-4 my-3 animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="qt-card border-2 border-primary/50 bg-primary/5 rounded-lg p-4 qt-shadow-lg">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xl">📝</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground">
              File Write Permission Required
            </h3>
            <p className="qt-text-sm text-muted-foreground mt-1">
              The AI wants to create a file. Please review and approve or deny this request.
            </p>
          </div>
        </div>

        {/* File info */}
        <div className="mt-3 p-3 bg-background/50 rounded-md border border-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">📁</span>
            <span className="font-medium truncate">{request.filename}</span>
          </div>
          <div className="qt-text-xs text-muted-foreground mt-1">
            <span>Location: {locationText}</span>
            {request.folderPath !== '/' && (
              <span> / {request.folderPath}</span>
            )}
          </div>
          {request.content && (
            <div className="qt-text-xs text-muted-foreground mt-1">
              Size: {request.content.length.toLocaleString()} characters
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={handleQuickApprove}
            disabled={isApproving}
            className="qt-button qt-button-primary flex items-center gap-2"
          >
            {isApproving ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Approving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </>
            )}
          </button>
          <button
            onClick={handleDeny}
            disabled={isApproving}
            className="qt-button qt-button-secondary flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Deny
          </button>
          <button
            onClick={onViewDetails}
            disabled={isApproving}
            className="qt-button qt-button-ghost qt-text-sm flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            View Details & Options
          </button>
        </div>

        {/* Hint about more options */}
        <p className="qt-text-xs text-muted-foreground mt-3">
          Click &quot;View Details & Options&quot; to preview file content or grant broader permissions.
        </p>
      </div>
    </div>
  )
}

export default FileWritePermissionPrompt
