'use client'

/**
 * The Inventory browser — one tier's objects as a small file manager, laid
 * out like the wardrobe's (and built from the same `components/item-browser`
 * pieces): a search box that looks everywhere, the *Items / Kits /
 * Archetypes* filter, *Equipped only* (in a chat), *Show archived* and *Show
 * shared*, the breadcrumb and folder rows, a character's borrowed tiers as
 * tier rows, select mode with *Move / Copy to folder…*, and the rows
 * themselves. The view state and layout are the shared
 * `useFolderBrowserState` / `FolderBrowserShell`; this file adds the
 * Inventory's filters, rows and wording.
 *
 * Folders are the operator's filing (an object's folder is its path under
 * `Inventory/`); they never change what anyone carries.
 *
 * @module components/inventory/InventoryBrowser
 */

import { useCallback, useMemo, useState } from 'react'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { encodeInventoryContainer, type InventoryContainer } from '@/lib/inventory/container'
import { folderCrumb } from '@/lib/inventory/folders'
import { OWN_TIER } from '@/lib/folder-browser/view'
import { encodeWardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { useInventoryFolders } from '@/lib/hooks/use-inventory'
import { ItemFolderPickerDialog, type ItemFolderPickerWording } from '@/components/item-browser/ItemFolderPickerDialog'
import { FolderBrowserShell } from '@/components/item-browser/FolderBrowserShell'
import { useFolderBrowserState, useItemFolderHandlers } from '@/components/item-browser/useFolderBrowserState'
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

const INVENTORY_PICKER_WORDING: ItemFolderPickerWording = {
  rootLabel: 'Inventory (top level)',
  noun: 'object',
  rootPhrase: 'the top of the inventory',
  rests: ['sits', 'sit'],
  moveNote: 'Folders are for your browsing; what anyone carries stays exactly as it was.',
  copyNote: 'Each copy is a new object of its own; nobody carries it until it is equipped.',
  describeError: describeInventoryRefusal,
}

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
  const searching = search.trim().length > 0

  const { folders: tree } = useInventoryFolders(container)
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

  const state = useFolderBrowserState({
    containerKey: container ? encodeInventoryContainer(container) : '',
    items,
    filtered,
    tree,
    tierOf,
    characterView: isCharacterScope,
    showShared,
    searching,
  })
  const { inOwnTier, currentFolder, selectMode, selectedIds, setSelectMode } = state
  const picker = actions.folderPicker

  const folderHandlers = useItemFolderHandlers({
    state,
    ops: container
      ? {
          create: (path) => actions.mutations.createFolder(container, path),
          rename: (path, name) => actions.mutations.renameFolder(container, path, name),
          remove: (path) => actions.mutations.deleteFolder(container, path),
        }
      : null,
    wording: {
      noun: 'object',
      rootPhrase: 'the top of the inventory',
      created: (name) => `The folder "${name}" is ready for the stock`,
      movedUp: (count) => `Folder removed; ${count} moved up`,
    },
    confirm: actions.requestConfirmation,
    describeError: describeInventoryRefusal,
  })

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
    onMoveToFolder: (item: ResolvedInventoryItem) => actions.openFolderPicker([item], 'move'),
    onCopyToFolder: (item: ResolvedInventoryItem) => actions.openFolderPicker([item], 'copy'),
    onTransfer: actions.openTransfer,
    onToggleArchived: (item: ResolvedInventoryItem) => void actions.toggleArchived(item),
    onDelete: (item: ResolvedInventoryItem) => void actions.remove(item),
  }

  const createFolder = inOwnTier ? currentFolder : ''

  return (
    <FolderBrowserShell
      state={state}
      hasContainer={container !== null}
      loading={loading}
      testIdPrefix="inventory"
      rootLabel="Inventory"
      countNoun="object"
      scrollList={scrollList}
      folderHandlers={folderHandlers}
      text={{
        noContainer: 'Select an inventory to browse.',
        folderEmpty: 'Nothing on this shelf yet.',
        noMatch: 'Nothing matches this filter.',
      }}
      filters={(
        <>
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
        </>
      )}
      toggles={{
        before: equip && (
          <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
            <input type="checkbox" checked={equippedOnly} onChange={(e) => setEquippedOnly(e.target.checked)} className="qt-checkbox" />
            Equipped only
          </label>
        ),
        archived: { checked: showArchived, onChange: onShowArchivedChange },
        shared: isCharacterScope ? { checked: showShared, onChange: setShowShared } : undefined,
      }}
      renderItem={(item) => (
        <InventoryItemRow
          key={item.id}
          item={item}
          manageable={canManage(item)}
          actions={rowActions}
          equip={rowEquip(item)}
          selection={selectMode ? { selected: selectedIds.has(item.id), onToggle: state.toggleSelected } : undefined}
          folderCrumb={searching && item.folder ? folderCrumb(item.folder) : null}
        />
      )}
      folderFiling={{
        open: actions.openFolderPicker,
        copyBlocked: (selected) => (selected.some((i) => !i.canCopy) ? 'Some of these objects cannot be copied' : undefined),
      }}
      footer={(
        <>
          <button
            type="button"
            className="qt-button-ghost qt-button-sm"
            disabled={!container}
            onClick={() => container && actions.openInstantiateInto(container, createFolder)}
          >
            + From archetype
          </button>
          <button type="button" className="qt-button-ghost qt-button-sm" disabled={!container} onClick={() => actions.openCreate('kit', createFolder)}>
            + New Kit
          </button>
          <button
            type="button"
            className="qt-button-ghost qt-button-sm"
            disabled={!container}
            onClick={() => actions.openCreate('archetype', createFolder)}
          >
            + New Archetype
          </button>
          <button type="button" className="qt-button-primary qt-button-sm" disabled={!container} onClick={() => actions.openCreate('item', createFolder)}>
            + New Item
          </button>
        </>
      )}
    >
      {picker && (
        <ItemFolderPickerDialog
          mode={picker.mode}
          items={picker.items}
          container={actions.addressOf(picker.items[0])}
          port={{ useFolders: useInventoryFolders, createFolder: actions.mutations.createFolder, creating: actions.mutations.pending }}
          wording={INVENTORY_PICKER_WORDING}
          file={(folder) =>
            actions.mutations.fileItems(picker.mode, actions.addressOf(picker.items[0]), picker.items.map((i) => i.id), folder)
          }
          onFiled={() => setSelectMode(false)}
          onClose={actions.closeFolderPicker}
        />
      )}
    </FolderBrowserShell>
  )
}
