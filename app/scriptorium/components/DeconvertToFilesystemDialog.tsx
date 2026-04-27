'use client'

/**
 * Deconvert Document Store to Filesystem Dialog
 *
 * Prompts for a target directory and deconverts a database-backed store —
 * writing every document and blob out to disk and switching the store's
 * mountType back to 'filesystem'.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DirectoryPicker } from './DirectoryPicker'
import type { DocumentStore } from '../types'

interface DeconvertToFilesystemDialogProps {
  store: DocumentStore | null
  onClose: () => void
  onConfirm: (targetPath: string) => void
}

export function DeconvertToFilesystemDialog({ store, onClose, onConfirm }: DeconvertToFilesystemDialogProps) {
  const [targetPath, setTargetPath] = useState('')

  if (!store) return null

  const canSubmit = targetPath.trim().length > 0 && targetPath.trim().startsWith('/')

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    onConfirm(targetPath.trim())
  }

  return createPortal(
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-lg p-6">
        <h3 className="qt-dialog-title mb-4">Deconvert &ldquo;{store.name}&rdquo; to Filesystem Storage</h3>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3 mb-5">
            <p className="qt-text-small">
              Every document and blob in this store will be written out to disk under the target
              directory. The store will then switch to filesystem-backed, watching that directory
              for live changes.
            </p>

            <ul className="list-disc pl-5 qt-text-small space-y-1">
              <li>The target directory must be <strong>empty</strong> or not yet exist (it will be created).</li>
              <li>Existing chunks and embeddings are preserved — no re-embedding required.</li>
              <li>Files leave the encrypted mount-index database and land on disk as plain bytes.</li>
            </ul>
          </div>

          <div className="mb-4">
            <label className="qt-label mb-2 block">Target directory</label>
            <DirectoryPicker
              value={targetPath}
              onChange={setTargetPath}
              required
              placeholder="/absolute/path/to/export"
            />
            <p className="mt-1 text-xs qt-text-secondary">
              Absolute filesystem path. Must be empty or nonexistent.
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="qt-button-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`qt-button-primary ${!canSubmit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Deconvert
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
