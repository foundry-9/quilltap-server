'use client'

/**
 * The state every folder-of-items browser keeps (the wardrobe's, the
 * Inventory's, the Scriptorium's), stated once: where in the tree the
 * browser is (a tier — the container's own items, or one borrowed tier — and
 * a folder within it), select mode and its selection, the inline new-folder
 * draft, and what the view shows there (`lib/folder-browser/view`).
 *
 * Each piece of view state remembers the container (or view) it was set in
 * and reads as its starting value anywhere else — so a new container opens at
 * its root with nothing selected, and leaving a folder or toggling search
 * drops the selection, without an effect to reset them.
 *
 * `useItemFolderHandlers` is the other half: New folder / Rename / Delete
 * over an injected `ItemFolderOps` port, with the toasts and the delete
 * confirmation worded by the caller.
 *
 * @module components/item-browser/useFolderBrowserState
 */

import { useCallback, useMemo, useState } from 'react'
import {
  OWN_TIER,
  childFolderRows,
  pluralize,
  tierLabel,
  tierRows,
  type BrowserViewItem,
  type FolderRowView,
  type TierRowView,
} from '@/lib/folder-browser/view'
import { folderName, isSameFolder, isUnderFolder, joinFolder, parentFolder } from '@/lib/mount-index/item-folders'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

type Item = BrowserViewItem & { id: string }

export interface FolderBrowserStateOptions<T extends Item> {
  /** The browsed container's key; `''` when none is chosen. */
  containerKey: string
  /** Every item in the view's pool, filters aside — what counts are judged by. */
  items: readonly T[]
  /** The items the browser's own filters let through, in display order. */
  filtered: readonly T[]
  /** The own tier's server folder tree (empty folders included). */
  tree: ReadonlyArray<{ path: string; itemCount: number }>
  /** The view tier an item sits in: `OWN_TIER`, or a borrowed tier's key. */
  tierOf: (item: T) => string
  /** A character's merged view offers borrowed tiers as tier rows. */
  characterView: boolean
  /** "Show shared" — off, a borrowed tier reads as the own tier's root. */
  showShared: boolean
  /** A search is active: it looks everywhere and folder rows step aside. */
  searching: boolean
}

export interface FolderBrowserState<T extends Item> {
  /** A search is active (echoed from the options). */
  searching: boolean
  currentTier: string
  currentFolder: string
  inOwnTier: boolean
  /** Folders are managed only in the container being browsed, never a borrowed tier. */
  managed: boolean
  navigate: (tier: string, folder: string) => void
  /** The label of the borrowed tier being browsed; null in the own tier. */
  currentTierLabel: string | null

  selectMode: boolean
  /** Turn select mode on or off; either way the selection empties. */
  setSelectMode: (on: boolean) => void
  selectedIds: ReadonlySet<string>
  selectedItems: T[]
  toggleSelected: (item: T) => void
  clearSelection: () => void

  newFolder: {
    open: boolean
    name: string
    setName: (name: string) => void
    close: () => void
  }

  /** Everything in the tier being browsed, filters aside. */
  tierItems: T[]
  folderRows: FolderRowView[]
  sharedTierRows: TierRowView[]
  visible: T[]
  /** Nothing at all in this folder (as opposed to nothing matching the filters). */
  folderIsEmpty: boolean
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set()

export function useFolderBrowserState<T extends Item>({
  containerKey,
  items,
  filtered,
  tree,
  tierOf,
  characterView,
  showShared,
  searching,
}: FolderBrowserStateOptions<T>): FolderBrowserState<T> {
  const [view, setView] = useState({ key: containerKey, tier: OWN_TIER, folder: '' })
  const [selectModeState, setSelectModeState] = useState({ key: containerKey, on: false })
  const [newFolderState, setNewFolderState] = useState({ key: '', name: '' })

  // Hiding shared tiers while inside one reads as the container's root.
  const viewIsCurrent = view.key === containerKey && (showShared || view.tier === OWN_TIER)
  const currentTier = viewIsCurrent ? view.tier : OWN_TIER
  const currentFolder = viewIsCurrent ? view.folder : ''
  const inOwnTier = currentTier === OWN_TIER
  const managed = inOwnTier && containerKey !== ''
  const navigate = useCallback(
    (tier: string, folder: string) => setView({ key: containerKey, tier, folder }),
    [containerKey],
  )

  const viewKey = `${containerKey}|${currentTier}|${currentFolder}|${searching}`
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>(() => ({
    key: viewKey,
    ids: new Set(),
  }))
  const selectedIds = selection.key === viewKey ? selection.ids : EMPTY_SELECTION
  const clearSelection = useCallback(() => setSelection({ key: viewKey, ids: new Set() }), [viewKey])
  const selectMode = selectModeState.key === containerKey && selectModeState.on
  const setSelectMode = useCallback(
    (on: boolean) => {
      setSelectModeState({ key: containerKey, on })
      setSelection({ key: viewKey, ids: new Set() })
    },
    [containerKey, viewKey],
  )
  const toggleSelected = useCallback(
    (item: T) => {
      setSelection((prev) => {
        const next = new Set(prev.key === viewKey ? prev.ids : [])
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return { key: viewKey, ids: next }
      })
    },
    [viewKey],
  )
  const selectedItems = useMemo(() => items.filter((i) => selectedIds.has(i.id)), [items, selectedIds])

  const newFolderOpen = newFolderState.key === viewKey
  const newFolder = {
    open: newFolderOpen,
    name: newFolderOpen ? newFolderState.name : '',
    setName: (name: string) => setNewFolderState({ key: viewKey, name }),
    close: () => setNewFolderState({ key: '', name: '' }),
  }

  const tierItems = useMemo(() => items.filter((i) => tierOf(i) === currentTier), [items, tierOf, currentTier])
  const folderRows = useMemo(
    () => (searching ? [] : childFolderRows(currentFolder, tierItems, managed ? tree : [])),
    [searching, currentFolder, tierItems, managed, tree],
  )
  const sharedTierRows = useMemo(
    () =>
      characterView && inOwnTier && !searching && currentFolder === '' && showShared ? tierRows(items, tierOf) : [],
    [characterView, inOwnTier, searching, currentFolder, showShared, items, tierOf],
  )
  const visible = useMemo(
    () =>
      searching
        ? [...filtered]
        : filtered.filter((i) => tierOf(i) === currentTier && isSameFolder(i.folder ?? '', currentFolder)),
    [searching, filtered, tierOf, currentTier, currentFolder],
  )
  const currentTierLabel = useMemo(() => {
    if (inOwnTier) return null
    const sample = items.find((i) => tierOf(i) === currentTier)
    return sample ? tierLabel(sample.origin) : 'Shared'
  }, [inOwnTier, items, tierOf, currentTier])

  const folderIsEmpty =
    !searching &&
    folderRows.length === 0 &&
    sharedTierRows.length === 0 &&
    !tierItems.some((i) => isSameFolder(i.folder ?? '', currentFolder))

  return {
    searching,
    currentTier,
    currentFolder,
    inOwnTier,
    managed,
    navigate,
    currentTierLabel,
    selectMode,
    setSelectMode,
    selectedIds,
    selectedItems,
    toggleSelected,
    clearSelection,
    newFolder,
    tierItems,
    folderRows,
    sharedTierRows,
    visible,
    folderIsEmpty,
  }
}

// ---- folder handlers -------------------------------------------------------

/** The folder writes a browser's own tier accepts. */
export interface ItemFolderOps {
  create: (path: string) => Promise<{ name: string }>
  rename: (path: string, name: string) => Promise<{ name: string }>
  remove: (path: string) => Promise<{ movedItems: number }>
}

/** How a browser words its folder toasts and confirmation. */
export interface ItemFolderWording {
  /** The noun its items are counted in, e.g. `item`, `object`. */
  noun: string
  /** Where a deleted folder's contents go at the top, e.g. `the top of the wardrobe`. */
  rootPhrase: string
  created: (name: string) => string
  /** The toast after a delete that moved `count` (already pluralised) up. */
  movedUp: (count: string) => string
  /** Override the delete confirmation (the wardrobe mentions archived pieces). */
  deleteMessage?: (args: { name: string; count: number; parentLabel: string }) => string
}

export interface ItemFolderHandlersOptions<T extends Item> {
  state: FolderBrowserState<T>
  /** Null while no container is chosen — every handler is then a no-op. */
  ops: ItemFolderOps | null
  wording: ItemFolderWording
  confirm: (message: string) => Promise<boolean>
  /** A refusal's message for a toast. */
  describeError: (error: unknown, fallback: string) => string
}

export { pluralize }

export function useItemFolderHandlers<T extends Item>({
  state,
  ops,
  wording,
  confirm,
  describeError,
}: ItemFolderHandlersOptions<T>) {
  const { currentFolder, currentTier, navigate, newFolder, tierItems } = state

  const submitNewFolder = async (): Promise<void> => {
    const name = newFolder.name.trim()
    if (!name || !ops) return
    try {
      const folder = await ops.create(joinFolder(currentFolder, name))
      showSuccessToast(wording.created(folder.name))
      newFolder.close()
    } catch (error) {
      showErrorToast(describeError(error, 'The folder would not be made'))
    }
  }

  const renameFolder = async (path: string, name: string): Promise<boolean> => {
    if (!ops) return false
    try {
      const folder = await ops.rename(path, name)
      showSuccessToast(`Renamed to "${folder.name}"`)
      return true
    } catch (error) {
      showErrorToast(describeError(error, 'The folder would not be renamed'))
      return false
    }
  }

  const deleteFolder = async (path: string): Promise<void> => {
    if (!ops) return
    const parent = parentFolder(path)
    const count = tierItems.filter((i) => isUnderFolder(i.folder ?? '', path)).length
    const parentLabel = parent ? `"${folderName(parent)}"` : wording.rootPhrase
    const message = wording.deleteMessage
      ? wording.deleteMessage({ name: folderName(path), count, parentLabel })
      : count > 0
        ? `Send its ${pluralize(count, wording.noun)} up to ${parentLabel}? Only the folder itself goes.`
        : `Remove the folder "${folderName(path)}"?`
    if (!(await confirm(message))) return
    try {
      const result = await ops.remove(path)
      showSuccessToast(
        result.movedItems > 0 ? wording.movedUp(pluralize(result.movedItems, wording.noun)) : 'Folder removed',
      )
      if (isUnderFolder(currentFolder, path)) navigate(currentTier, parent)
    } catch (error) {
      showErrorToast(describeError(error, 'The folder would not be removed'))
    }
  }

  return { submitNewFolder, renameFolder, deleteFolder }
}
