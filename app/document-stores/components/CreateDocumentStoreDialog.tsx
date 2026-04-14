'use client'

/**
 * Create Document Store Dialog
 *
 * Modal dialog for creating a new document store (mount point).
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DirectoryPicker } from './DirectoryPicker'
import type { CreateDocumentStoreData } from '../types'

interface CreateDocumentStoreDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateDocumentStoreData) => void
}

export function CreateDocumentStoreDialog({ open, onClose, onSubmit }: CreateDocumentStoreDialogProps) {
  const [mountType, setMountType] = useState<'filesystem' | 'obsidian'>('filesystem')
  const [basePath, setBasePath] = useState('')

  if (!open) return null

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const includeStr = formData.get('includePatterns') as string
    const excludeStr = formData.get('excludePatterns') as string

    const data: CreateDocumentStoreData = {
      name,
      basePath,
      mountType,
    }

    if (includeStr.trim()) {
      data.includePatterns = includeStr.split(',').map(p => p.trim()).filter(Boolean)
    }
    if (excludeStr.trim()) {
      data.excludePatterns = excludeStr.split(',').map(p => p.trim()).filter(Boolean)
    }

    onSubmit(data)
  }

  return createPortal(
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-lg p-6">
        <h3 className="qt-dialog-title mb-4">Add Document Store</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="qt-label mb-2 block">Name</label>
            <input
              type="text"
              name="name"
              required
              maxLength={200}
              placeholder="My Obsidian Vault"
              className="qt-input"
            />
          </div>

          <div className="mb-4">
            <label className="qt-label mb-2 block">Path</label>
            <DirectoryPicker
              value={basePath}
              onChange={setBasePath}
              required
              placeholder="/path/to/documents"
            />
            <p className="mt-1 text-xs qt-text-secondary">Absolute filesystem path to the document directory</p>
          </div>

          <div className="mb-4">
            <label className="qt-label mb-2 block">Type</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mountType"
                  value="filesystem"
                  checked={mountType === 'filesystem'}
                  onChange={() => setMountType('filesystem')}
                  className="qt-radio"
                />
                <span className="text-sm text-foreground">Filesystem</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mountType"
                  value="obsidian"
                  checked={mountType === 'obsidian'}
                  onChange={() => setMountType('obsidian')}
                  className="qt-radio"
                />
                <span className="text-sm text-foreground">Obsidian Vault</span>
              </label>
            </div>
          </div>

          <div className="mb-4">
            <label className="qt-label mb-2 block">Include Patterns (optional)</label>
            <input
              type="text"
              name="includePatterns"
              placeholder="*.md, *.txt, *.pdf, *.docx"
              defaultValue="*.md, *.txt, *.pdf, *.docx"
              className="qt-input"
            />
            <p className="mt-1 text-xs qt-text-secondary">Comma-separated glob patterns for files to include</p>
          </div>

          <div className="mb-4">
            <label className="qt-label mb-2 block">Exclude Patterns (optional)</label>
            <input
              type="text"
              name="excludePatterns"
              placeholder=".git, node_modules, .obsidian, .trash"
              defaultValue=".git, node_modules, .obsidian, .trash"
              className="qt-input"
            />
            <p className="mt-1 text-xs qt-text-secondary">Comma-separated glob patterns for files/directories to exclude</p>
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="qt-button-secondary">
              Cancel
            </button>
            <button type="submit" className="qt-button-primary">
              Add Store
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
