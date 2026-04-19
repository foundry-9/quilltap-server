'use client'

/**
 * MoveFileModal Component
 *
 * Modal for moving a file to a different folder.
 */

import { useState, useEffect, useMemo } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { FileInfo, FolderInfo } from '../types'

interface MoveFileModalProps {
  isOpen: boolean
  onClose: () => void
  file: FileInfo
  folders: FolderInfo[]
  projectId?: string | null
  onSuccess?: (file: FileInfo) => void
}

export default function MoveFileModal({
  isOpen,
  onClose,
  file,
  folders,
  projectId,
  onSuccess,
}: Readonly<MoveFileModalProps>) {
  const [selectedFolder, setSelectedFolder] = useState(file.folderPath || '/')
  const [saving, setSaving] = useState(false)

  // Reset selection when file changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local state with upstream prop; parent renders unconditionally
    setSelectedFolder(file.folderPath || '/')
  }, [file.folderPath])

  // Build a list of all folders including root
  const allFolders = useMemo(() => {
    const folderList = [{ path: '/', name: 'Root', fileCount: 0 }, ...folders]
    return folderList.sort((a, b) => a.path.localeCompare(b.path))
  }, [folders])

  const handleMove = async () => {
    const currentFolder = file.folderPath || '/'

    if (selectedFolder === currentFolder) {
      showErrorToast('File is already in this folder')
      return
    }

    try {
      setSaving(true)
      const res = await fetch(`/api/v1/files/${file.id}?action=move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderPath: selectedFolder,
        }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to move file')
      }

      const data = await res.json()

      showSuccessToast('File moved')
      onSuccess?.(data.file)
      onClose()
    } catch (error) {
      console.error('[MoveFileModal] Failed to move file', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to move file')
    } finally {
      setSaving(false)
    }
  }

  const currentFolder = file.folderPath || '/'
  const hasChange = selectedFolder !== currentFolder

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
        onClick={handleMove}
        disabled={saving || !hasChange}
        className="qt-button qt-button-primary"
      >
        {saving ? 'Moving...' : 'Move File'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Move File"
      maxWidth="sm"
      footer={footer}
    >
      <div className="mb-4">
        <p className="qt-text-small qt-text-secondary mb-2">
          Moving: <span className="font-medium text-foreground">{file.originalFilename}</span>
        </p>
        <p className="qt-text-xs qt-text-secondary">
          Current location: <span className="font-mono">{currentFolder}</span>
        </p>
      </div>

      <div className="mb-4">
        <label htmlFor="destination-folder" className="qt-label mb-1">
          Destination Folder
        </label>
        <select
          id="destination-folder"
          value={selectedFolder}
          onChange={(e) => setSelectedFolder(e.target.value)}
          disabled={saving}
          className="qt-input"
        >
          {allFolders.map((folder) => (
            <option key={folder.path} value={folder.path}>
              {folder.path === '/' ? '/ (Root)' : folder.path}
              {folder.fileCount > 0 && ` (${folder.fileCount} files)`}
            </option>
          ))}
        </select>
      </div>

      {hasChange && (
        <p className="qt-text-xs qt-text-secondary">
          Will move to: <span className="font-mono">{selectedFolder}</span>
        </p>
      )}
    </BaseModal>
  )
}
