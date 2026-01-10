'use client'

/**
 * CreateFolderModal Component
 *
 * Modal for creating a new folder in the file browser.
 */

import { useState, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'

interface CreateFolderModalProps {
  isOpen: boolean
  onClose: () => void
  currentFolder: string
  projectId?: string | null
  onSuccess?: (folderPath: string) => void
}

export default function CreateFolderModal({
  isOpen,
  onClose,
  currentFolder,
  projectId,
  onSuccess,
}: Readonly<CreateFolderModalProps>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [folderName, setFolderName] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset and focus on open
  useEffect(() => {
    if (isOpen) {
      setFolderName('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  useEffect(() => {
    clientLogger.debug('[CreateFolderModal] Opened', {
      currentFolder,
      projectId,
    })
  }, [currentFolder, projectId])

  const handleCreate = async () => {
    const trimmedName = folderName.trim()

    if (!trimmedName) {
      showErrorToast('Folder name cannot be empty')
      return
    }

    // Build the full folder path
    const newFolderPath = currentFolder === '/'
      ? `/${trimmedName}/`
      : `${currentFolder}${trimmedName}/`

    try {
      setSaving(true)
      clientLogger.debug('[CreateFolderModal] Creating folder', {
        folderName: trimmedName,
        fullPath: newFolderPath,
        projectId,
      })

      const res = await fetch('/api/files/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: newFolderPath,
          projectId,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to create folder')
      }

      const data = await res.json()
      const folderPath = data.folder?.path || newFolderPath

      showSuccessToast(data.alreadyExists ? 'Folder already exists' : 'Folder created')
      clientLogger.info('[CreateFolderModal] Folder created', {
        path: folderPath,
        folderId: data.folder?.id,
        alreadyExists: data.alreadyExists,
      })

      onSuccess?.(folderPath)
      onClose()
    } catch (error) {
      clientLogger.error('[CreateFolderModal] Failed to create folder', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to create folder')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        disabled={saving}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={handleCreate}
        disabled={saving || !folderName.trim()}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Creating...' : 'Create Folder'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Folder"
      maxWidth="sm"
      footer={footer}
    >
      <div className="mb-4">
        <label htmlFor="folder-name" className="qt-label mb-1">
          Folder Name
        </label>
        <input
          ref={inputRef}
          id="folder-name"
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder="Enter folder name..."
          className="qt-input"
          maxLength={100}
        />
      </div>

      <p className="qt-text-xs text-muted-foreground">
        Will be created in: <span className="font-mono">{currentFolder}</span>
      </p>
    </BaseModal>
  )
}
