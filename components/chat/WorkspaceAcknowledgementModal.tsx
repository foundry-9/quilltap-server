'use client'

import { useState } from 'react'
import BaseModal from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface WorkspaceAcknowledgementModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly chatId: string
  readonly onAcknowledge: () => void
  readonly onDismiss: () => void
}

export default function WorkspaceAcknowledgementModal({
  isOpen,
  onClose,
  chatId,
  onAcknowledge,
  onDismiss,
}: WorkspaceAcknowledgementModalProps) {
  const [saving, setSaving] = useState(false)

  const handleAcknowledge = async () => {
    try {
      setSaving(true)
      const res = await fetch('/api/v1/shell/workspace-acknowledgement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to acknowledge workspace')
      }

      showSuccessToast('Workspace acknowledged')
      onAcknowledge()
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      showErrorToast(errorMessage)
    } finally {
      setSaving(false)
    }
  }

  const handleDismiss = () => {
    onDismiss()
    onClose()
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleDismiss}
      title="Shell Workspace Notice"
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      maxWidth="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={handleDismiss}
            disabled={saving}
            className="qt-button qt-button-secondary"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleAcknowledge}
            disabled={saving}
            className="qt-button qt-button-primary"
            type="button"
          >
            {saving ? 'Confirming...' : 'I Understand'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          Your AI assistant is requesting access to execute shell commands in a sandboxed
          workspace. Before proceeding, please understand the following:
        </p>

        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <span className="text-base flex-shrink-0 mt-0.5">&#128193;</span>
            <div className="text-sm">
              <p className="font-medium text-foreground">Shared Scratch Space</p>
              <p className="qt-text-muted mt-0.5">
                The workspace directory is a shared scratch space between your host machine
                and the VM. Files created here are visible to both environments.
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <span className="text-base flex-shrink-0 mt-0.5">&#9888;&#65039;</span>
            <div className="text-sm">
              <p className="font-medium text-foreground">Anything Can Happen</p>
              <p className="qt-text-muted mt-0.5">
                Files may be created, modified, or deleted by the AI within the workspace.
                The AI has full control within the sandbox boundaries.
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <span className="text-base flex-shrink-0 mt-0.5">&#128270;</span>
            <div className="text-sm">
              <p className="font-medium text-foreground">Review Before Executing</p>
              <p className="qt-text-muted mt-0.5">
                The workspace directory and its contents should not be trusted for execution
                without manual review. Binary executables are blocked, but other files may
                still require caution.
              </p>
            </div>
          </li>

          <li className="flex items-start gap-3">
            <span className="text-base flex-shrink-0 mt-0.5">&#128274;</span>
            <div className="text-sm">
              <p className="font-medium text-foreground">Sandboxed Scope</p>
              <p className="qt-text-muted mt-0.5">
                The AI cannot navigate outside its mounted workspace scope within the VM,
                but files it produces may still be harmful if executed on your host system.
              </p>
            </div>
          </li>
        </ul>
      </div>
    </BaseModal>
  )
}
