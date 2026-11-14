'use client'

/**
 * What a document-store file's row and its picture tile share: the glyph for
 * its kind, the ⋮ labels, the modified-date format, and the in-place rename
 * (state, submit, cancel) behind the ⋮ menu's entries.
 *
 * @module components/document-browser/document-item
 */

import { useState } from 'react'
import type { IconName } from '@/components/ui/icons/icon-registry'
import type { MenuEntryLike } from '@/components/item-browser/ItemActionMenu'
import { documentPreviewKind, type BrowserAction } from '@/lib/folder-browser/document-actions'
import type { PreviewKind } from '@/lib/folder-browser/preview-kind'
import type { DocumentEntry } from './useDocumentStoreSource'

export const KIND_ICONS: Record<PreviewKind, IconName> = {
  image: 'image',
  pdf: 'file',
  docx: 'file',
  markdown: 'book',
  text: 'file',
  unsupported: 'file',
}

const ACTION_LABELS: Record<BrowserAction, string> = {
  open: 'Open',
  rename: 'Rename',
  move: 'Move to…',
  copy: 'Copy to…',
  link: 'Hard link to…',
  'show-links': 'Where else this appears…',
  unlink: 'Unlink from its twins',
  describe: 'Edit description…',
  workbench: "Open in Pascal's Workbench",
  download: 'Download',
  delete: 'Delete',
}

/** What a row and a tile both take. */
export interface DocumentItemProps {
  entry: DocumentEntry
  actions: readonly BrowserAction[]
  /** Run an action other than rename (which the item does itself). */
  onAction: (action: BrowserAction, entry: DocumentEntry) => void
  onRename: (entry: DocumentEntry, name: string) => Promise<boolean>
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  /** Show the folder under the name (a search hit). */
  showFolder: boolean
}

export function formatModified(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The kind, the rename state and the ⋮ entries of one file. */
export function useDocumentItem({ entry, actions, onAction, onRename }: Pick<DocumentItemProps, 'entry' | 'actions' | 'onAction' | 'onRename'>) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(entry.fileName)
  const kind = documentPreviewKind(entry)

  const submit = async (): Promise<void> => {
    const next = name.trim()
    if (!next || next === entry.fileName) {
      setRenaming(false)
      return
    }
    if (await onRename(entry, next)) setRenaming(false)
  }

  const cancel = (): void => {
    setName(entry.fileName)
    setRenaming(false)
  }

  const menuEntries: MenuEntryLike[] = actions.map((action) => ({
    key: action,
    label: ACTION_LABELS[action],
    destructive: action === 'delete',
    onSelect: () => {
      if (action === 'rename') {
        setName(entry.fileName)
        setRenaming(true)
      } else {
        onAction(action, entry)
      }
    },
  }))

  return { kind, renaming, name, setName, submit, cancel, menuEntries }
}

/** The in-place rename box. */
export function DocumentRenameInput({
  entry,
  name,
  setName,
  submit,
  cancel,
  className,
}: {
  entry: DocumentEntry
  name: string
  setName: (name: string) => void
  submit: () => Promise<void>
  cancel: () => void
  className: string
}) {
  return (
    <input
      type="text"
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void submit()
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          cancel()
        }
      }}
      onBlur={() => void submit()}
      aria-label={`Rename ${entry.fileName}`}
      className={className}
    />
  )
}
