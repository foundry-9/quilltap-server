'use client'

/**
 * The Inventory browser — one tier's objects as a small file manager, laid
 * out like the wardrobe's (and built from the same `components/item-browser`
 * pieces): a search box that looks everywhere, the *Items / Kits /
 * Archetypes* filter, *Equipped only* (in a chat), *Show archived* and *Show
 * shared*, the breadcrumb and folder rows, a character's borrowed tiers as
 * tier rows, select mode with *Move to folder…*, and the rows themselves.
 *
 * Folders are the operator's filing (an object's folder is its path under
 * `Inventory/`); they never change what anyone carries.
 *
 * @module components/inventory/InventoryBrowser
 */

import { useCallback, useMemo, useState } from 'react'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { encodeInventoryContainer, type InventoryContainer } from '@/lib/inventory/container'
import { folderCrumb, folderName, isSameFolder, isUnderFolder, joinFolder, parentFolder } from '@/lib/inventory/folders'
import { childFolderRows, OWN_TIER, tierLabel, tierRows } from '@/lib/wardrobe/folder-view'
import { encodeWardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { useInventoryFolders } from '@/lib/hooks/use-inventory'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { ItemFolderBar, NewFolderInput } from '@/components/item-browser/ItemFolderBar'
import { ItemFolderRow } from '@/components/item-browser/ItemFolderRow'
import { ItemSelectBar } from '@/components/item-browser/ItemSelectBar'
import { ItemTierRow } from '@/components/item-browser/ItemTierRow'
import type { InventoryListData } from './hooks/useInventoryListData'
import type { InventoryItemActions } from './hooks/useInventoryItemActions'
import { describeInventoryRefusal } from './hooks/useInventoryItemActions'
import { InventoryItemRow, type InventoryRowEquip } from './inventory-item-row'
import type { CarriedEntry } from '@/lib/hooks/use-inventory'

type KindFilter = 'items' | 'kits' | 'archetypes'

/** Equip controls on each row — only when a character in a chat is chosen. */
export interface InventoryBrowserEquip {
  carried: CarriedEntry
  onEquip: (item: ResolvedInventoryItem) => void
  onUnequip: (item: ResolvedInventoryItem) => void
}

export interface InventoryBrowserProps {
  container: InventoryContainer | null
  data: InventoryListData
  actions: InventoryItemActions
  showArchived: boolean
  onShowArchivedChange: (next: boolean) => void
  equip?: InventoryBrowserEquip
  /** Cap the list's height (the dialog) instead of letting it grow (a card). */
  scrollList?: boolean
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

/** The tier an object sits in from the character's view: own, or the tier it is borrowed from. */
function tierOfItem(item: ResolvedInventoryItem, manageable: boolean): string {
  if (manageable || !item.origin) return OWN_TIER
  return encodeWardrobeContainer({ scope: item.origin.scope, id: item.origin.scope === 'general' ? null : item.origin.id })
}

export function InventoryBrowser({
  container,
  data,
  actions,
  showArchived,
  onShowArchivedChange,
  equip,
  scrollList = true,
}: InventoryBrowserProps) {
  const isCharacterScope = container?.scope === 'character'
  const { items, loading, canManage } = data
  const [showShared, setShowShared] = useState(true)
  const [equippedOnly, setEquippedOnly] = useState(false)
  const [kindFilter, setKindFilter] = useState<KindFilter>('items')
  const [search, setSearch] = useState('')

  const containerKey = container ? encodeInventoryContainer(container) : ''
  const [view, setView] = useState({ key: containerKey, tier: OWN_TIER, folder: '' })
  const [selectModeState, setSelectModeState] = useState({ key: containerKey, on: false })
  const [newFolderState, setNewFolderState] = useState({ key: '', name: '' })

  const searching = search.trim().length > 0
  const viewIsCurrent = view.key === containerKey && (showShared || view.tier === OWN_TIER)
  const currentTier = viewIsCurrent ? view.tier : OWN_TIER
  const currentFolder = viewIsCurrent ? view.folder : ''
  const inOwnTier = currentTier === OWN_TIER
  const selectMode = selectModeState.key === containerKey && selectModeState.on
  const setSelectMode = useCallback((on: boolean) => setSelectModeState({ key: containerKey, on }), [containerKey])

  const viewKey = `${containerKey}|${currentTier}|${currentFolder}|${searching}`
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>(() => ({ key: viewKey, ids: new Set() }))
  const selectedIds = selection.key === viewKey ? selection.ids : EMPTY_SELECTION
  const clearSelection = useCallback(() => setSelection({ key: viewKey, ids: new Set() }), [viewKey])

  const newFolderOpen = newFolderState.key === viewKey
  const newFolderName = newFolderOpen ? newFolderState.name : ''
  const setNewFolderName = (name: string) => setNewFolderState({ key: viewKey, name })
  const closeNewFolder = () => setNewFolderState({ key: '', name: '' })
  const managed = inOwnTier && container !== null

  const { folders: tree } = useInventoryFolders(container)
  const navigate = useCallback((tier: string, folder: string) => setView({ key: containerKey, tier, folder }), [containerKey])
  const tierOf = useCallback((item: ResolvedInventoryItem) => tierOfItem(item, canManage(item)), [canManage])

  const carriedIds = useMemo(() => new Set((equip?.carried.equipped ?? []).map((i) => i.id)), [equip])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items
      .filter((item) => {
        if (isCharacterScope && !showShared && !canManage(item)) return false
        if (kindFilter === 'kits' && item.kind !== 'kit') return false
        if (kindFilter === 'archetypes' && !item.isArchetype) return false
        if (kindFilter === 'items' && (item.kind === 'kit' || item.isArchetype)) return false
        if (equippedOnly && equip && !carriedIds.has(item.id) && !(item.kind === 'kit' && equip.carried.kits[item.id] !== 'none')) {
          return false
        }
        if (term && !`${item.title ?? ''} ${item.name}`.toLowerCase().includes(term)) return false
        return true
      })
      .sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name, undefined, { sensitivity: 'base' }))
  }, [items, search, isCharacterScope, showShared, canManage, kindFilter, equippedOnly, equip, carriedIds])

  const tierItems = useMemo(() => items.filter((i) => tierOf(i) === currentTier), [items, tierOf, currentTier])
  const folderRows = useMemo(
    () => (searching ? [] : childFolderRows(currentFolder, tierItems, managed ? tree : [])),
    [searching, currentFolder, tierItems, managed, tree],
  )
  const sharedTierRows = useMemo(
    () => (isCharacterScope && inOwnTier && !searching && currentFolder === '' && showShared ? tierRows(items, tierOf) : []),
    [isCharacterScope, inOwnTier, searching, currentFolder, showShared, items, tierOf],
  )
  const visible = useMemo(
    () => (searching ? filtered : filtered.filter((i) => tierOf(i) === currentTier && isSameFolder(i.folder ?? '', currentFolder))),
    [searching, filtered, tierOf, currentTier, currentFolder],
  )
  const currentTierLabel = useMemo(() => {
    if (inOwnTier) return null
    const sample = items.find((i) => tierOf(i) === currentTier)
    return sample ? tierLabel(sample.origin) : 'Shared'
  }, [inOwnTier, items, tierOf, currentTier])

  const folderIsEmpty =
    !searching && folderRows.length === 0 && sharedTierRows.length === 0 &&
    !tierItems.some((i) => isSameFolder(i.folder ?? '', currentFolder))

  const submitNewFolder = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name || !container) return
    try {
      const folder = await actions.mutations.createFolder(container, joinFolder(currentFolder, name))
      showSuccessToast(`The folder "${folder.name}" is ready for the stock`)
      closeNewFolder()
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The folder would not be made'))
    }
  }

  const renameFolder = async (path: string, name: string): Promise<boolean> => {
    if (!container) return false
    try {
      const folder = await actions.mutations.renameFolder(container, path, name)
      showSuccessToast(`Renamed to "${folder.name}"`)
      return true
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The folder would not be renamed'))
      return false
    }
  }

  const deleteFolder = async (path: string): Promise<void> => {
    if (!container) return
    const parent = parentFolder(path)
    const count = tierItems.filter((i) => isUnderFolder(i.folder ?? '', path)).length
    const parentLabel = parent ? `"${folderName(parent)}"` : 'the top of the inventory'
    const message = count > 0
      ? `Send its ${plural(count, 'object')} up to ${parentLabel}? Only the folder itself goes.`
      : `Remove the folder "${folderName(path)}"?`
    if (!(await actions.requestConfirmation(message))) return
    try {
      const result = await actions.mutations.deleteFolder(container, path)
      showSuccessToast(result.movedItems > 0 ? `Folder removed; ${plural(result.movedItems, 'object')} moved up` : 'Folder removed')
      if (isUnderFolder(currentFolder, path)) navigate(currentTier, parent)
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The folder would not be removed'))
    }
  }

  const toggleSelected = useCallback(
    (item: ResolvedInventoryItem) => {
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

  const rowEquip = (item: ResolvedInventoryItem): InventoryRowEquip | undefined =>
    equip
      ? {
          equipped: carriedIds.has(item.id),
          kitState: item.kind === 'kit' ? equip.carried.kits[item.id] ?? 'none' : undefined,
          onEquip: equip.onEquip,
          onUnequip: equip.onUnequip,
        }
      : undefined

  const rowActions = {
    onEdit: actions.openEditor,
    onInstantiate: actions.openInstantiateArchetype,
    onDetach: (item: ResolvedInventoryItem) => void actions.detach(item),
    onDuplicate: (item: ResolvedInventoryItem) => void actions.duplicate(item),
    onMoveToFolder: (item: ResolvedInventoryItem) => actions.openFolderPicker([item]),
    onTransfer: actions.openTransfer,
    onToggleArchived: (item: ResolvedInventoryItem) => void actions.toggleArchived(item),
    onDelete: (item: ResolvedInventoryItem) => void actions.remove(item),
  }

  return (
    <section className="flex flex-col min-h-0 relative">
      <div className="flex flex-col gap-2 mb-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the inventory…"
          className="qt-input qt-input-sm"
          aria-label="Search the inventory by name"
        />
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Object kind">
          {(['items', 'kits', 'archetypes'] as KindFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kindFilter === k}
              onClick={() => setKindFilter(k)}
              className={`qt-button-sm ${kindFilter === k ? 'qt-button-secondary' : 'qt-button-ghost'}`}
            >
              {k === 'items' ? 'Items' : k === 'kits' ? 'Kits' : 'Archetypes'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {equip && (
            <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
              <input type="checkbox" checked={equippedOnly} onChange={(e) => setEquippedOnly(e.target.checked)} className="qt-checkbox" />
              Equipped only
            </label>
          )}
          <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
            <input type="checkbox" checked={showArchived} onChange={(e) => onShowArchivedChange(e.target.checked)} className="qt-checkbox" />
            Show archived
          </label>
          {isCharacterScope && (
            <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
              <input
                type="checkbox"
                checked={showShared}
                onChange={(e) => {
                  setShowShared(e.target.checked)
                  if (!e.target.checked && !inOwnTier) navigate(OWN_TIER, '')
                }}
                className="qt-checkbox"
              />
              Show shared
            </label>
          )}
        </div>
        {container && (
          <ItemFolderBar
            rootLabel="Inventory"
            navLabel="Inventory folders"
            searching={searching}
            tierLabel={inOwnTier ? null : currentTierLabel}
            currentFolder={currentFolder}
            onNavigateRoot={() => navigate(OWN_TIER, '')}
            onNavigateTier={() => navigate(currentTier, '')}
            onNavigateFolder={(path) => navigate(currentTier, path)}
            managed={managed}
            newFolderOpen={newFolderOpen}
            onNewFolder={() => setNewFolderName('')}
            selectMode={selectMode}
            onToggleSelect={() => {
              setSelectMode(!selectMode)
              clearSelection()
            }}
            testId="inventory-folder-bar"
          />
        )}
        {newFolderOpen && managed && !searching && (
          <NewFolderInput name={newFolderName} onChange={setNewFolderName} onSubmit={() => void submitNewFolder()} onCancel={closeNewFolder} />
        )}
      </div>

      <div className={`flex-1 space-y-1 pb-12 ${scrollList ? 'overflow-y-auto max-h-[55vh]' : ''}`}>
        {!container ? (
          <div className="text-sm qt-text-secondary px-3 py-4">Select an inventory to browse.</div>
        ) : loading ? (
          <div className="text-sm qt-text-secondary px-3 py-4">Loading…</div>
        ) : (
          <>
            {folderRows.map((row) => (
              <ItemFolderRow
                key={row.path}
                row={row}
                manageable={managed}
                onOpen={() => navigate(currentTier, row.path)}
                onRename={(name) => renameFolder(row.path, name)}
                onDelete={() => void deleteFolder(row.path)}
                testId="inventory-folder-row"
                countNoun="object"
              />
            ))}
            {sharedTierRows.map((row) => (
              <ItemTierRow
                key={row.key}
                label={row.label}
                scope={row.scope}
                itemCount={row.itemCount}
                onOpen={() => navigate(row.key, '')}
                testId="inventory-tier-row"
                countNoun="object"
              />
            ))}
            {folderIsEmpty ? (
              <div className="text-sm qt-text-secondary px-3 py-4">Nothing on this shelf yet.</div>
            ) : visible.length === 0 && folderRows.length === 0 && sharedTierRows.length === 0 ? (
              <div className="text-sm qt-text-secondary px-3 py-4">Nothing matches this filter.</div>
            ) : (
              visible.map((item) => (
                <InventoryItemRow
                  key={item.id}
                  item={item}
                  manageable={canManage(item)}
                  actions={rowActions}
                  equip={rowEquip(item)}
                  selection={selectMode ? { selected: selectedIds.has(item.id), onToggle: toggleSelected } : undefined}
                  folderCrumb={searching && item.folder ? folderCrumb(item.folder) : null}
                />
              ))
            )}
            {selectMode && (
              <ItemSelectBar
                count={selectedIds.size}
                sticky={scrollList}
                testId="inventory-select-bar"
                onCancel={() => {
                  setSelectMode(false)
                  clearSelection()
                }}
              >
                <button
                  type="button"
                  className="qt-button-secondary qt-button-sm"
                  disabled={selectedItems.length === 0}
                  onClick={() => actions.openFolderPicker(selectedItems)}
                >
                  Move to folder…
                </button>
              </ItemSelectBar>
            )}
          </>
        )}
      </div>

      <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 qt-bg-default border-t qt-border-default flex flex-wrap items-center gap-2 justify-end">
        <button
          type="button"
          className="qt-button-ghost qt-button-sm"
          disabled={!container}
          onClick={() => container && actions.openInstantiateInto(container, inOwnTier ? currentFolder : '')}
        >
          + From archetype
        </button>
        <button
          type="button"
          className="qt-button-ghost qt-button-sm"
          disabled={!container}
          onClick={() => actions.openCreate('kit', inOwnTier ? currentFolder : '')}
        >
          + New Kit
        </button>
        <button
          type="button"
          className="qt-button-ghost qt-button-sm"
          disabled={!container}
          onClick={() => actions.openCreate('archetype', inOwnTier ? currentFolder : '')}
        >
          + New Archetype
        </button>
        <button
          type="button"
          className="qt-button-primary qt-button-sm"
          disabled={!container}
          onClick={() => actions.openCreate('item', inOwnTier ? currentFolder : '')}
        >
          + New Item
        </button>
      </div>
    </section>
  )
}
