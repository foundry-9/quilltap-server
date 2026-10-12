'use client'

/**
 * The item editor's Folder field: the root, every folder in the destination
 * wardrobe, and "New folder…", which reveals an input for a path to file the
 * item under (created on save). Filing only — a folder says nothing about
 * when the garment is worn.
 *
 * @module components/wardrobe/wardrobe-item-editor/WardrobeFolderField
 */

import { useMemo, useState } from 'react'
import { useWardrobeFolders } from '@/lib/hooks/use-wardrobe-folders'
import { folderCrumb, isSameFolder } from '@/lib/wardrobe/folders'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'

const NEW_FOLDER = '\u0000new'

interface WardrobeFolderFieldProps {
  /** The wardrobe the item is (or will be) filed in; null while unknown. */
  container: WardrobeContainer | null
  value: string
  onChange: (folder: string) => void
}

export function WardrobeFolderField({ container, value, onChange }: WardrobeFolderFieldProps) {
  const { folders } = useWardrobeFolders(container)
  const [typing, setTyping] = useState(false)

  // A folder the tree doesn't list yet (a new one, or one in another
  // wardrobe after the destination changed) is still offered as chosen.
  const options = useMemo(() => {
    const paths = folders.map((f) => f.path)
    if (value && !paths.some((p) => isSameFolder(p, value))) paths.push(value)
    return paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [folders, value])

  const selected = options.find((p) => isSameFolder(p, value)) ?? ''

  return (
    <div>
      <label htmlFor="wardrobe-folder" className="qt-label mb-1">
        Folder
      </label>
      {typing ? (
        <div className="flex items-center gap-2">
          <input
            id="wardrobe-folder"
            type="text"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setTyping(false)
              }
            }}
            placeholder="e.g., Formal/Evening"
            className="qt-input"
          />
          <button type="button" className="qt-button-ghost qt-button-sm" onClick={() => setTyping(false)}>
            Pick
          </button>
        </div>
      ) : (
        <select
          id="wardrobe-folder"
          value={selected}
          onChange={(e) => {
            if (e.target.value === NEW_FOLDER) {
              setTyping(true)
              return
            }
            onChange(e.target.value)
          }}
          className="qt-select"
        >
          <option value="">Wardrobe (top level)</option>
          {options.map((path) => (
            <option key={path} value={path}>
              {folderCrumb(path)}
            </option>
          ))}
          <option value={NEW_FOLDER}>New folder…</option>
        </select>
      )}
      <p className="mt-1 text-xs qt-text-small">
        Where it is filed for your browsing. Folders never change what anyone can wear.
      </p>
    </div>
  )
}
