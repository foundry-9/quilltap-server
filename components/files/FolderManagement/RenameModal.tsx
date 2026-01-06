'use client'

/**
 * RenameModal Component
 *
 * Modal for renaming a file or folder.
 */

import { useState, useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { FileInfo } from '../types'

interface RenameFileModalProps {
  type: 'file'
  isOpen: boolean
  onClose: () => void
  file: FileInfo
  onSuccess?: (file: FileInfo) => void
}

interface RenameFolderModalProps {
  type: 'folder'
  isOpen: boolean
  onClose: () => void
  folderPath: string
  projectId?: string | null
  onSuccess?: (newPath: string) => void
}

type RenameModalProps = RenameFileModalProps | RenameFolderModalProps

export default function RenameModal(props: Readonly<RenameModalProps>) {
  const { type, isOpen, onClose } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // Get current name
  const currentName = type === 'file'
    ? (props.file.originalFilename || props.file.filename || '')
    : getFolderName(props.folderPath)

  // Reset and focus on open
  useEffect(() => {
    if (isOpen) {
      setNewName(currentName)
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 100)
    }
  }, [isOpen, currentName])

  useEffect(() => {
    if (type === 'file') {
      clientLogger.debug('[RenameModal] Opened for file', {
        fileId: props.file.id,
        currentName,
      })
    } else {
      clientLogger.debug('[RenameModal] Opened for folder', {
        folderPath: props.folderPath,
        currentName,
      })
    }
  }, [type, currentName, props])

  const handleRename = async () => {
    const trimmedName = newName.trim()

    if (!trimmedName) {
      showErrorToast('Name cannot be empty')
      return
    }

    if (trimmedName === currentName) {
      onClose()
      return
    }

    try {
      setSaving(true)

      if (type === 'file') {
        clientLogger.debug('[RenameModal] Renaming file', {
          fileId: props.file.id,
          oldName: currentName,
          newName: trimmedName,
        })

        const res = await fetch(`/api/files/${props.file.id}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: trimmedName,
          }),
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to rename file')
        }

        const data = await res.json()

        showSuccessToast('File renamed')
        clientLogger.info('[RenameModal] File renamed', {
          fileId: props.file.id,
          newName: trimmedName,
        })

        props.onSuccess?.(data.file)
      } else {
        clientLogger.debug('[RenameModal] Renaming folder', {
          path: props.folderPath,
          oldName: currentName,
          newName: trimmedName,
        })

        const res = await fetch('/api/files/folders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: props.folderPath,
            newName: trimmedName,
            projectId: props.projectId,
          }),
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to rename folder')
        }

        const data = await res.json()

        showSuccessToast(`Folder renamed (${data.filesUpdated} files updated)`)
        clientLogger.info('[RenameModal] Folder renamed', {
          oldPath: props.folderPath,
          newPath: data.newPath,
          filesUpdated: data.filesUpdated,
        })

        props.onSuccess?.(data.newPath)
      }

      onClose()
    } catch (error) {
      clientLogger.error('[RenameModal] Failed to rename', {
        type,
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : `Failed to rename ${type}`)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleRename()
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
        onClick={handleRename}
        disabled={saving || !newName.trim() || newName.trim() === currentName}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Renaming...' : 'Rename'}
      </button>
    </div>
  )

  const title = type === 'file' ? 'Rename File' : 'Rename Folder'
  const placeholder = type === 'file' ? 'Enter new filename...' : 'Enter new folder name...'

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="sm"
      footer={footer}
    >
      <div className="mb-4">
        <label htmlFor="new-name" className="qt-label mb-1">
          New Name
        </label>
        <input
          ref={inputRef}
          id="new-name"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder={placeholder}
          className="qt-input"
          maxLength={type === 'file' ? 255 : 100}
        />
      </div>

      {type === 'folder' && (
        <p className="qt-text-xs text-muted-foreground">
          All files in this folder will be updated to the new path.
        </p>
      )}
    </BaseModal>
  )
}

/**
 * Get folder name from path
 */
function getFolderName(path: string): string {
  if (!path || path === '/') return ''
  const withoutTrailing = path.endsWith('/') ? path.slice(0, -1) : path
  const segments = withoutTrailing.split('/').filter(Boolean)
  return segments[segments.length - 1] || ''
}
