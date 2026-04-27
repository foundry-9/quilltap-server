'use client'

/**
 * Edit Document Store Dialog
 *
 * Modal dialog for editing an existing document store.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DirectoryPicker } from './DirectoryPicker'
import type { DocumentStore, UpdateDocumentStoreData } from '../types'

interface EditDocumentStoreDialogProps {
  store: DocumentStore | null
  onClose: () => void
  onSubmit: (id: string, data: UpdateDocumentStoreData) => void
}

export function EditDocumentStoreDialog({ store, onClose, onSubmit }: EditDocumentStoreDialogProps) {
  const [mountType, setMountType] = useState<'filesystem' | 'obsidian' | 'database'>(store?.mountType || 'filesystem')
  const [storeType, setStoreType] = useState<'documents' | 'character'>(store?.storeType || 'documents')
  const [basePath, setBasePath] = useState(store?.basePath || '')
  const [enabled, setEnabled] = useState(store?.enabled ?? true)

  if (!store) return null

  const isDatabaseBacked = mountType === 'database'

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const includeStr = (formData.get('includePatterns') as string) ?? ''
    const excludeStr = (formData.get('excludePatterns') as string) ?? ''

    const data: UpdateDocumentStoreData = {
      name,
      basePath: isDatabaseBacked ? '' : basePath,
      mountType,
      storeType,
      enabled,
    }

    if (!isDatabaseBacked) {
      if (includeStr.trim()) {
        data.includePatterns = includeStr.split(',').map(p => p.trim()).filter(Boolean)
      }
      if (excludeStr.trim()) {
        data.excludePatterns = excludeStr.split(',').map(p => p.trim()).filter(Boolean)
      }
    }

    onSubmit(store.id, data)
  }

  return createPortal(
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-lg p-6">
        <h3 className="qt-dialog-title mb-4">Edit Document Store</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="qt-label mb-2 block">Name</label>
            <input
              type="text"
              name="name"
              required
              maxLength={200}
              defaultValue={store.name}
              className="qt-input"
            />
          </div>

          <div className="mb-4">
            <label className="qt-label mb-2 block">Contents</label>
            <select
              name="storeType"
              value={storeType}
              onChange={(e) => setStoreType(e.target.value as 'documents' | 'character')}
              className="qt-input"
            >
              <option value="documents">Documents — general notes, references, research</option>
              <option value="character">Character — character sheets and related material</option>
            </select>
          </div>

          {!isDatabaseBacked && (
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
          )}

          <div className="mb-4">
            <label className="qt-label mb-2 block">Type</label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mountType"
                  value="filesystem"
                  checked={mountType === 'filesystem'}
                  onChange={() => setMountType('filesystem')}
                  className="qt-radio"
                />
                <span className="qt-body">Filesystem</span>
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
                <span className="qt-body">Obsidian Vault</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mountType"
                  value="database"
                  checked={mountType === 'database'}
                  onChange={() => setMountType('database')}
                  className="qt-radio"
                />
                <span className="qt-body">Database-backed</span>
              </label>
            </div>
            {isDatabaseBacked && (
              <p className="mt-2 text-xs qt-text-secondary italic">
                Database-backed stores have no filesystem path or include/exclude patterns. Switching from a filesystem mount type will drop the current base path.
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="qt-checkbox"
              />
              <span className="qt-label">Enabled</span>
            </label>
            <p className="mt-1 text-xs qt-text-secondary">Disabled stores won&apos;t be scanned or searched</p>
          </div>

          {!isDatabaseBacked && (
            <>
              <div className="mb-4">
                <label className="qt-label mb-2 block">Include Patterns</label>
                <input
                  type="text"
                  name="includePatterns"
                  defaultValue={store.includePatterns.join(', ')}
                  className="qt-input"
                />
                <p className="mt-1 text-xs qt-text-secondary">Comma-separated glob patterns for files to include</p>
              </div>

              <div className="mb-4">
                <label className="qt-label mb-2 block">Exclude Patterns</label>
                <input
                  type="text"
                  name="excludePatterns"
                  defaultValue={store.excludePatterns.join(', ')}
                  className="qt-input"
                />
                <p className="mt-1 text-xs qt-text-secondary">Comma-separated glob patterns for files/directories to exclude</p>
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="qt-button-secondary">
              Cancel
            </button>
            <button type="submit" className="qt-button-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
