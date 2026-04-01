'use client'

import { useState } from 'react'
import BaseModal from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface SudoApprovalModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly chatId: string
  readonly pendingSudoCommand: {
    command: string
    parameters?: string[]
    timeout_ms?: number
  }
  readonly onApprove: () => void
  readonly onDeny: () => void
}

export default function SudoApprovalModal({
  isOpen,
  onClose,
  chatId,
  pendingSudoCommand,
  onApprove,
  onDeny,
}: SudoApprovalModalProps) {
  const [saving, setSaving] = useState(false)

  const fullCommand = pendingSudoCommand.parameters?.length
    ? `sudo ${pendingSudoCommand.command} ${pendingSudoCommand.parameters.join(' ')}`
    : `sudo ${pendingSudoCommand.command}`

  const handleApprove = async () => {
    try {
      setSaving(true)
      const res = await fetch('/api/v1/shell/sudo-approval?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          decision: 'approve',
          pendingSudoCommand,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to execute sudo command')
      }

      showSuccessToast('Sudo command executed')
      onApprove()
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      showErrorToast(errorMessage)
    } finally {
      setSaving(false)
    }
  }

  const handleDeny = async () => {
    try {
      await fetch('/api/v1/shell/sudo-approval?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          decision: 'deny',
          pendingSudoCommand,
        }),
      })
    } catch (error) {
      console.error('[SudoApprovalModal] Failed to send denial', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    onDeny()
    onClose()
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleDeny}
      title="Sudo Command Approval"
      closeOnClickOutside={!saving}
      closeOnEscape={!saving}
      maxWidth="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={handleDeny}
            disabled={saving}
            className="qt-button qt-button-secondary"
            type="button"
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={saving}
            className="qt-button qt-button-destructive"
            type="button"
          >
            {saving ? 'Executing...' : 'Approve & Execute'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <span className="text-lg flex-shrink-0 mt-0.5">&#9888;&#65039;</span>
          <div className="text-sm">
            <p className="font-semibold text-destructive">Elevated Privileges Required</p>
            <p className="qt-text-muted mt-1">
              This command will execute with root (superuser) privileges inside the VM.
              While the VM sandbox prevents direct harm to your host system, elevated
              commands can modify system packages, services, and configuration within the VM.
            </p>
          </div>
        </div>

        <div>
          <p className="qt-text-label-sm mb-2">Command to execute:</p>
          <div className="bg-muted rounded-lg p-3 border border-border">
            <pre className="text-sm font-mono text-foreground whitespace-pre-wrap break-all">
              {fullCommand}
            </pre>
          </div>
        </div>

        {pendingSudoCommand.timeout_ms && (
          <p className="qt-text-xs text-muted-foreground">
            Timeout: {(pendingSudoCommand.timeout_ms / 1000).toFixed(0)} seconds
          </p>
        )}
      </div>
    </BaseModal>
  )
}
