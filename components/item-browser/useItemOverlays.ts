'use client'

/**
 * The overlay state a tiered item browser's row actions open — the item
 * editor, the move/copy-to-folder picker and the cross-tier transfer — shared
 * by the wardrobe's and the Inventory's actions hooks.
 *
 * Every overlay lives here so `overlayOpen` sees it: the hosting dialog's
 * click-outside handler would otherwise treat a click inside a (portalled)
 * overlay as a click outside the dialog and close both (bug 229). A kind
 * with more overlays (the wardrobe's picture viewer, the Inventory's
 * instantiate picker) passes them as `extraOpen`.
 *
 * @module components/item-browser/useItemOverlays
 */

import { useCallback, useMemo, useState } from 'react'

export type FilingMode = 'move' | 'copy'

/** The folder picker: file the items themselves, or copies of them. */
export interface FolderPickerRequest<T> {
  items: T[]
  mode: FilingMode
}

/** The cross-tier move / copy dialog. */
export interface TransferRequest<T> {
  item: T
  mode: FilingMode
}

export interface ItemOverlays<T, E> {
  editor: E | null
  openEditorWith: (request: E) => void
  closeEditor: () => void
  folderPicker: FolderPickerRequest<T> | null
  /** Open the picker; an empty selection opens nothing. */
  openFolderPicker: (items: T[], mode?: FilingMode) => void
  closeFolderPicker: () => void
  transfer: TransferRequest<T> | null
  openTransfer: (item: T, mode: FilingMode) => void
  closeTransfer: () => void
  /** True while any overlay (this hook's, or the kind's `extraOpen`) is up. */
  overlayOpen: boolean
}

export function useItemOverlays<T, E>(extraOpen = false): ItemOverlays<T, E> {
  const [editor, setEditor] = useState<E | null>(null)
  const [folderPicker, setFolderPicker] = useState<FolderPickerRequest<T> | null>(null)
  const [transfer, setTransfer] = useState<TransferRequest<T> | null>(null)

  const openEditorWith = useCallback((request: E) => setEditor(request), [])
  const closeEditor = useCallback(() => setEditor(null), [])
  const openFolderPicker = useCallback((items: T[], mode: FilingMode = 'move') => {
    if (items.length > 0) setFolderPicker({ items, mode })
  }, [])
  const closeFolderPicker = useCallback(() => setFolderPicker(null), [])
  const openTransfer = useCallback((item: T, mode: FilingMode) => setTransfer({ item, mode }), [])
  const closeTransfer = useCallback(() => setTransfer(null), [])

  const overlayOpen = extraOpen || editor !== null || folderPicker !== null || transfer !== null

  return useMemo(
    () => ({
      editor,
      openEditorWith,
      closeEditor,
      folderPicker,
      openFolderPicker,
      closeFolderPicker,
      transfer,
      openTransfer,
      closeTransfer,
      overlayOpen,
    }),
    [editor, openEditorWith, closeEditor, folderPicker, openFolderPicker, closeFolderPicker, transfer, openTransfer, closeTransfer, overlayOpen],
  )
}
