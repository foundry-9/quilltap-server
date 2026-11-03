'use client'

/**
 * An item editor's Folder field (the wardrobe's, the Inventory's): the root,
 * every folder in the destination tier, and "New folder…", which reveals an
 * input for a path to file the item under (created on save). Filing only — a
 * folder never changes what the item does.
 *
 * @module components/item-browser/ItemFolderField
 */

import { useMemo, useState } from 'react'
import { folderCrumb, isSameFolder } from '@/lib/mount-index/item-folders'

const NEW_FOLDER = '\u0000new'

export interface ItemFolderFieldProps {
  id: string
  /** The destination tier's folder tree. */
  folders: ReadonlyArray<{ path: string }>
  value: string
  onChange: (folder: string) => void
  /** The root option, e.g. `Wardrobe (top level)`. */
  rootLabel: string
  /** The line under the field. */
  hint: string
  /** The typed path's placeholder, e.g. `e.g., Formal/Evening`. */
  placeholder: string
  labelClassName?: string
  inputClassName?: string
  selectClassName?: string
}

export function ItemFolderField({
  id,
  folders,
  value,
  onChange,
  rootLabel,
  hint,
  placeholder,
  labelClassName = 'qt-label mb-1',
  inputClassName = 'qt-input',
  selectClassName = 'qt-select',
}: ItemFolderFieldProps) {
  const [typing, setTyping] = useState(false)

  // A folder the tree doesn't list yet (a new one, or one in another tier
  // after the destination changed) is still offered as chosen.
  const options = useMemo(() => {
    const paths = folders.map((f) => f.path)
    if (value && !paths.some((p) => isSameFolder(p, value))) paths.push(value)
    return paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [folders, value])

  const selected = options.find((p) => isSameFolder(p, value)) ?? ''

  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        Folder
      </label>
      {typing ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
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
            placeholder={placeholder}
            className={inputClassName}
          />
          <button type="button" className="qt-button-ghost qt-button-sm" onClick={() => setTyping(false)}>
            Pick
          </button>
        </div>
      ) : (
        <select
          id={id}
          value={selected}
          onChange={(e) => {
            if (e.target.value === NEW_FOLDER) {
              setTyping(true)
              return
            }
            onChange(e.target.value)
          }}
          className={selectClassName}
        >
          <option value="">{rootLabel}</option>
          {options.map((path) => (
            <option key={path} value={path}>
              {folderCrumb(path)}
            </option>
          ))}
          <option value={NEW_FOLDER}>New folder…</option>
        </select>
      )}
      <p className="mt-1 text-xs qt-text-small">{hint}</p>
    </div>
  )
}
