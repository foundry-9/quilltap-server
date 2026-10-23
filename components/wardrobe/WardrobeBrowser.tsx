'use client'

/**
 * The wardrobe browser — one container's closet as a small file manager:
 * a breadcrumb, the subfolders of the folder you are in, then its items, with
 * the search, kind, slot, sort, visibility and pronoun-aware filters, row actions, a select
 * mode for filing several items at once, and a "+ New Item" button — plus
 * `WardrobeItemOverlays`, the editor / move-copy / full-screen picture the row
 * actions open.
 *
 * Folders are the operator's filing (an item's folder is its path under
 * `Wardrobe/`); they never change what a character can wear. In a
 * character's container the root is the character's own closet, and each
 * shared wardrobe they borrow from is one tier row after the own subfolders —
 * entering it shows that wardrobe's own tree. Folders are never merged across
 * tiers. The search box looks everywhere and shows each hit's folder.
 *
 * Mounted by the Wardrobe dialog (left column, any container) and by the
 * Prospero project page's Wardrobe card (that project's container). The data
 * comes from `useWardrobeListData`, the actions from `useWardrobeItemActions`,
 * the folder tree and its mutations from `use-wardrobe-folders`, and the view
 * rules from `lib/wardrobe/folder-view`; this file lays them out.
 *
 * @module components/wardrobe/WardrobeBrowser
 */

import { useCallback, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { WARDROBE_SLOT_TYPES, WARDROBE_SLOT_META, isComposite } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import {
  WARDROBE_LIST_SORTS,
  sortAndFilterWardrobeItems,
  type WardrobeListSort,
} from '@/lib/wardrobe/wear-display'
import {
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import {
  folderCrumb,
  folderName,
  folderSegments,
  isSameFolder,
  isUnderFolder,
  joinFolder,
  parentFolder,
} from '@/lib/wardrobe/folders'
import {
  OWN_TIER,
  childFolderRows,
  tierLabel,
  tierRows,
  viewTierOf,
  type FolderRowView,
} from '@/lib/wardrobe/folder-view'
import { useWardrobeFolderMutations, useWardrobeFolders } from '@/lib/hooks/use-wardrobe-folders'
import type { TierItem } from '@/lib/hooks/use-wardrobe-tier'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { WardrobeListData } from './hooks/useWardrobeListData'
import type { WardrobeItemActions } from './hooks/useWardrobeItemActions'
import { WardrobeItemRow } from './wardrobe-item-row'
import { WardrobeItemEditor } from './wardrobe-item-editor'
import { WardrobeImageViewer } from './wardrobe-image-viewer'
import { WardrobeTransferDialog } from './WardrobeTransferDialog'
import { WardrobeFolderPickerDialog } from './WardrobeFolderPickerDialog'
import { ItemFolderBar, NewFolderInput } from '@/components/item-browser/ItemFolderBar'
import { ItemFolderRow } from '@/components/item-browser/ItemFolderRow'
import { ItemSelectBar } from '@/components/item-browser/ItemSelectBar'
import { ItemTierRow } from '@/components/item-browser/ItemTierRow'
import type { ComponentMode } from './WardrobeComponentModeFieldset'
import { PronounAwareToggle } from './PronounAwareToggle'
import type { PronounGuidanceFilter } from '@/lib/hooks/use-pronoun-guidance-filter'

type SlotFilter = 'all' | WardrobeItemType
const SLOT_FILTERS: SlotFilter[] = ['all', ...WARDROBE_SLOT_TYPES]
type ItemKind = 'items' | 'outfits'

/** Wear controls on each row — only when a character is being dressed. */
export interface WardrobeRowWearControls {
  equipLabel: string
  addAction: 'layer' | 'add'
  onEquip: (item: WardrobeItem) => void
  onAddToSlot: (item: WardrobeItem, slot: WardrobeItemType) => void
}

export interface WardrobeBrowserProps {
  container: WardrobeContainer | null
  data: WardrobeListData
  actions: WardrobeItemActions
  showArchived: boolean
  onShowArchivedChange: (next: boolean) => void
  wear?: WardrobeRowWearControls
  /** Character view only: open the import-from-image flow. */
  onImportFromImage?: () => void
  /** Cap the list's height (the dialog) instead of letting it grow (a card). */
  scrollList?: boolean
  /**
   * Character view only: the pronoun-aware filter (owned by the caller so the
   * composers beside the list share its switch).
   */
  pronounFilter?: PronounGuidanceFilter
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

export function WardrobeBrowser({
  container,
  data,
  actions,
  showArchived,
  onShowArchivedChange,
  wear,
  onImportFromImage,
  scrollList = true,
  pronounFilter,
}: WardrobeBrowserProps) {
  const isCharacterScope = container?.scope === 'character'
  const { listItems, resolutionPool, loading, canManage } = data

  /**
   * "Show shared": on by default, a purely client-side filter. The character
   * view's list *is* the merge of the character's own garments with every
   * shared tier above them, so hiding shared items means dropping the
   * un-manageable rows (and their tier rows) after the merge, not asking the
   * server for less.
   */
  const [showShared, setShowShared] = useState(true)
  const [listSort, setListSort] = useState<WardrobeListSort>('title')
  const [neverWornOnly, setNeverWornOnly] = useState(false)
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('all')
  const [kindFilter, setKindFilter] = useState<ItemKind>('items')
  const [titleFilter, setTitleFilter] = useState('')

  // Where in the tree we are: the tier (a character's own closet, or one
  // borrowed wardrobe) and the folder within it. Each piece of view state
  // remembers the container (or view) it was set in, and reads as its
  // starting value anywhere else — so a new container opens at its root with
  // nothing selected, and leaving a folder or toggling search drops the
  // selection, without an effect to reset them.
  const containerKey = container ? encodeWardrobeContainer(container) : ''
  const [view, setView] = useState({ key: containerKey, tier: OWN_TIER, folder: '' })
  const [selectModeState, setSelectModeState] = useState({ key: containerKey, on: false })
  const [newFolderState, setNewFolderState] = useState({ key: '', name: '' })
  // The Move-to-folder picker's state lives in the actions hook, so the
  // dialog's `overlayOpen` counts it (bug 229).
  const picker = actions.folderPicker
  const [moving, setMoving] = useState(false)

  const searching = titleFilter.trim().length > 0
  // Hiding shared wardrobes while inside one reads as the closet's root.
  const viewIsCurrent = view.key === containerKey && (showShared || view.tier === OWN_TIER)
  const currentTier = viewIsCurrent ? view.tier : OWN_TIER
  const currentFolder = viewIsCurrent ? view.folder : ''
  const inOwnTier = currentTier === OWN_TIER
  const selectMode = selectModeState.key === containerKey && selectModeState.on
  const setSelectMode = useCallback(
    (on: boolean) => setSelectModeState({ key: containerKey, on }),
    [containerKey],
  )

  const viewKey = `${containerKey}|${currentTier}|${currentFolder}|${searching}`
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string> }>(() => ({
    key: viewKey,
    ids: new Set(),
  }))
  const selectedIds: ReadonlySet<string> = selection.key === viewKey ? selection.ids : EMPTY_SELECTION
  const clearSelection = useCallback(() => setSelection({ key: viewKey, ids: new Set() }), [viewKey])

  const newFolderOpen = newFolderState.key === viewKey
  const newFolderName = newFolderOpen ? newFolderState.name : ''
  const setNewFolderName = (name: string) => setNewFolderState({ key: viewKey, name })
  const closeNewFolder = () => setNewFolderState({ key: '', name: '' })
  // Folders are managed only in the wardrobe being browsed — never in a
  // wardrobe a character merely borrows from.
  const managed = inOwnTier && container !== null

  const { folders: tree } = useWardrobeFolders(container)
  const folderOps = useWardrobeFolderMutations()

  const tierOf = useCallback(
    (item: TierItem): string => viewTierOf(item, canManage(item), isCharacterScope),
    [canManage, isCharacterScope],
  )

  const navigate = useCallback(
    (tier: string, folder: string) => setView({ key: containerKey, tier, folder }),
    [containerKey],
  )

  // Pronoun guidance narrows the pool itself (character view, switch on), so
  // tier and folder counts agree with the rows beneath them.
  const offeredItems = useMemo(
    () => (isCharacterScope && pronounFilter ? pronounFilter.offer(listItems) : listItems),
    [isCharacterScope, pronounFilter, listItems],
  )

  const filteredItems = useMemo(() => {
    const sorted = sortAndFilterWardrobeItems(offeredItems, { sort: listSort, neverWornOnly })
    const term = titleFilter.trim().toLowerCase()
    return sorted.filter((i) => {
      // No archived filter here on purpose: the fetch already omitted them
      // unless "Show archived" is ticked. Shared items are the other way
      // round — the one rule for "is this shared" is `canManage`, the same
      // predicate that badges the row.
      if (isCharacterScope && !showShared && !canManage(i)) return false
      const composite = isComposite(i)
      if (kindFilter === 'items' && composite) return false
      if (kindFilter === 'outfits' && !composite) return false
      if (slotFilter !== 'all' && !i.types.includes(slotFilter)) return false
      if (term && !i.title.toLowerCase().includes(term)) return false
      return true
    })
  }, [
    offeredItems,
    listSort,
    neverWornOnly,
    slotFilter,
    kindFilter,
    titleFilter,
    showShared,
    isCharacterScope,
    canManage,
  ])

  // Everything in the tier being browsed, filters aside — what folder rows
  // count and what "nothing hangs here" is judged against.
  const tierItems = useMemo(
    () => offeredItems.filter((i) => tierOf(i) === currentTier),
    [offeredItems, tierOf, currentTier],
  )

  const folderRows = useMemo<FolderRowView[]>(
    () => (searching ? [] : childFolderRows(currentFolder, tierItems, managed ? tree : [])),
    [searching, currentFolder, tierItems, managed, tree],
  )

  const sharedTierRows = useMemo(
    () =>
      isCharacterScope && inOwnTier && !searching && currentFolder === '' && showShared
        ? tierRows(offeredItems, tierOf)
        : [],
    [isCharacterScope, inOwnTier, searching, currentFolder, showShared, offeredItems, tierOf],
  )

  const visibleItems = useMemo(
    () =>
      searching
        ? filteredItems
        : filteredItems.filter(
            (i) => tierOf(i) === currentTier && isSameFolder(i.folder ?? '', currentFolder),
          ),
    [searching, filteredItems, tierOf, currentTier, currentFolder],
  )

  const currentTierLabel = useMemo(() => {
    if (inOwnTier) return null
    const sample = listItems.find((i) => tierOf(i) === currentTier)
    return sample ? tierLabel(sample.origin) : 'Shared'
  }, [inOwnTier, listItems, tierOf, currentTier])

  const folderIsEmpty =
    !searching &&
    folderRows.length === 0 &&
    sharedTierRows.length === 0 &&
    !tierItems.some((i) => isSameFolder(i.folder ?? '', currentFolder))

  // ---- folder mutations ---------------------------------------------------

  const submitNewFolder = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name || !container) return
    try {
      const folder = await folderOps.createFolder(container, joinFolder(currentFolder, name))
      showSuccessToast(`The folder "${folder.name}" is ready for hanging things in`)
      closeNewFolder()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'The folder would not be made')
    }
  }

  const renameFolder = async (path: string, name: string): Promise<boolean> => {
    if (!container) return false
    try {
      const folder = await folderOps.renameFolder(container, path, name)
      showSuccessToast(`Renamed to "${folder.name}"`)
      return true
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'The folder would not be renamed')
      return false
    }
  }

  const deleteFolder = async (path: string): Promise<void> => {
    if (!container) return
    const parent = parentFolder(path)
    // The list holds archived pieces only when "Show archived" is ticked, but
    // the server moves them all; say so rather than understate the move.
    const count = tierItems.filter((i) => isUnderFolder(i.folder ?? '', path)).length
    const archivedNote = showArchived ? '' : ' (and any archived pieces filed there)'
    const parentLabel = parent ? `"${folderName(parent)}"` : 'the top of the wardrobe'
    const message =
      count > 0
        ? `Send its ${plural(count, 'item')}${archivedNote} up to ${parentLabel}? Only the folder itself goes.`
        : showArchived
          ? `Remove the empty folder "${folderName(path)}"?`
          : `Remove the folder "${folderName(path)}"? Anything archived in it goes up to ${parentLabel}.`
    if (!(await actions.confirm(message))) return
    try {
      const result = await folderOps.deleteFolder(container, path)
      showSuccessToast(
        result.movedItems > 0
          ? `Folder removed; ${plural(result.movedItems, 'item')} moved up a peg`
          : 'Folder removed',
      )
      if (isUnderFolder(currentFolder, path)) navigate(currentTier, parent)
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'The folder would not be removed')
    }
  }

  // ---- filing items -------------------------------------------------------

  const toggleSelected = useCallback(
    (item: WardrobeItem) => {
      setSelection((prev) => {
        const next = new Set(prev.key === viewKey ? prev.ids : [])
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return { key: viewKey, ids: next }
      })
    },
    [viewKey],
  )

  const pickerHome = picker ? actions.addressOf(picker.items[0]) : null
  const pickerCurrentFolder = useMemo(() => {
    if (!picker) return null
    const first = picker.items[0].folder ?? ''
    return picker.items.every((i) => isSameFolder(i.folder ?? '', first)) ? first : null
  }, [picker])

  const pickerOutfits = useMemo(() => (picker ? picker.items.filter(isComposite) : []), [picker])

  const fileToFolder = async (folder: string, components?: ComponentMode): Promise<void> => {
    if (!picker || !pickerHome) return
    const copying = picker.mode === 'copy'
    setMoving(true)
    try {
      const ids = picker.items.map((i) => i.id)
      const filed = copying
        ? await folderOps.copyItems(pickerHome, ids, folder, components === 'move' ? undefined : components)
        : await folderOps.moveItems(pickerHome, ids, folder, components)
      const where = folder ? `"${folderCrumb(filed[0]?.folder || folder)}"` : 'the top of the wardrobe'
      showSuccessToast(
        copying
          ? picker.items.length === 1
            ? `A copy of "${picker.items[0].title}" now hangs in ${where}`
            : `Copies of ${plural(filed.length, 'item')} now hang in ${where}`
          : picker.items.length === 1
            ? `"${picker.items[0].title}" now hangs in ${where}`
            : `${plural(filed.length, 'item')} now hang in ${where}`,
      )
      actions.closeFolderPicker()
      clearSelection()
      setSelectMode(false)
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : copying ? 'The items would not be copied' : 'The items would not be moved',
      )
    } finally {
      setMoving(false)
    }
  }

  const selectedItems = useMemo(
    () => listItems.filter((i) => selectedIds.has(i.id)),
    [listItems, selectedIds],
  )

  const selectBar = selectMode && (
    <ItemSelectBar
      count={selectedIds.size}
      sticky={scrollList}
      testId="wardrobe-select-bar"
      onCancel={() => {
        setSelectMode(false)
        clearSelection()
      }}
    >
      <button
        type="button"
        className="qt-button-secondary qt-button-sm"
        disabled={selectedItems.length === 0}
        onClick={() => actions.openFolderPicker(selectedItems, 'move')}
      >
        Move to folder…
      </button>
      <button
        type="button"
        className="qt-button-secondary qt-button-sm"
        disabled={selectedItems.length === 0}
        onClick={() => actions.openFolderPicker(selectedItems, 'copy')}
      >
        Copy to folder…
      </button>
    </ItemSelectBar>
  )

  return (
    <section className="flex flex-col min-h-0 relative">
      <div className="flex flex-col gap-2 mb-2">
        <input
          type="search"
          value={titleFilter}
          onChange={(e) => setTitleFilter(e.target.value)}
          placeholder="Search wardrobe…"
          className="qt-input qt-input-sm"
          aria-label="Search wardrobe by title"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Item kind"
            className="inline-flex gap-1 qt-bg-muted/50 rounded-lg p-1 self-start"
          >
            {(['items', 'outfits'] as ItemKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kindFilter === k}
                onClick={() => setKindFilter(k)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  kindFilter === k
                    ? 'qt-bg-default text-foreground shadow-sm'
                    : 'qt-text-secondary hover:text-foreground'
                }`}
              >
                {k === 'items' ? 'Items' : 'Outfits'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
            Sort
            <select
              value={listSort}
              onChange={(e) => setListSort(e.target.value as WardrobeListSort)}
              className="qt-select qt-select-sm"
              aria-label="Sort wardrobe"
            >
              {WARDROBE_LIST_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1">
          {SLOT_FILTERS.map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => setSlotFilter(slot)}
              className={`qt-button-sm ${slotFilter === slot ? 'qt-button-secondary' : 'qt-button-ghost'}`}
            >
              {slot === 'all' ? 'All' : WARDROBE_SLOT_META[slot].label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => onShowArchivedChange(e.target.checked)}
              className="qt-checkbox"
            />
            Show archived
          </label>
          {/* Only the character view merges in other tiers; browsing a
              container, every row already belongs to it. */}
          {isCharacterScope && (
            <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
              <input
                type="checkbox"
                checked={showShared}
                onChange={(e) => {
                  setShowShared(e.target.checked)
                  // Hiding shared wardrobes from inside one goes back to the closet.
                  if (!e.target.checked && !inOwnTier) navigate(OWN_TIER, '')
                }}
                className="qt-checkbox"
              />
              Show shared
            </label>
          )}
          <label className="flex items-center gap-2 qt-text-xs qt-text-secondary">
            <input
              type="checkbox"
              checked={neverWornOnly}
              onChange={(e) => setNeverWornOnly(e.target.checked)}
              className="qt-checkbox"
            />
            Never worn
          </label>
          {isCharacterScope && pronounFilter && (
            <PronounAwareToggle filter={pronounFilter} items={listItems} />
          )}
        </div>

        {/* Folder bar: where we are, and the filing controls. */}
        {container && (
          <ItemFolderBar
            rootLabel="Wardrobe"
            navLabel="Wardrobe folders"
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
            testId="wardrobe-folder-bar"
          />
        )}
        {newFolderOpen && managed && !searching && (
          <NewFolderInput
            name={newFolderName}
            onChange={setNewFolderName}
            onSubmit={() => void submitNewFolder()}
            onCancel={closeNewFolder}
          />
        )}
      </div>

      <div className={`flex-1 space-y-1 pb-12 ${scrollList ? 'overflow-y-auto max-h-[55vh]' : ''}`}>
        {!container ? (
          <div className="text-sm qt-text-secondary px-3 py-4">Select a wardrobe to browse.</div>
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
                testId="wardrobe-folder-row"
              />
            ))}
            {sharedTierRows.map((row) => (
              <ItemTierRow
                key={row.key}
                label={row.label}
                scope={row.scope}
                itemCount={row.itemCount}
                onOpen={() => navigate(row.key, '')}
                testId="wardrobe-tier-row"
              />
            ))}
            {folderIsEmpty ? (
              <div className="text-sm qt-text-secondary px-3 py-4">Nothing hangs here yet.</div>
            ) : visibleItems.length === 0 && folderRows.length === 0 && sharedTierRows.length === 0 ? (
              <div className="text-sm qt-text-secondary px-3 py-4">No items match this filter.</div>
            ) : (
              visibleItems.map((item) => (
                <WardrobeItemRow
                  key={item.id}
                  item={item}
                  allItems={resolutionPool}
                  // Wear / +Layer show whenever a character is being dressed;
                  // browsing a shared container there is nobody to dress.
                  inChat={Boolean(wear)}
                  canManage={canManage}
                  equipLabel={wear?.equipLabel}
                  addAction={wear?.addAction}
                  isUpdatingDefault={actions.updatingDefaultId === item.id}
                  onToggleDefault={actions.toggleDefault}
                  onToggleArchived={actions.toggleArchived}
                  onGenerateImage={actions.generateImage}
                  generatingImageIds={actions.generatingImageIds}
                  onOpenImage={actions.openImage}
                  onEdit={actions.openEditor}
                  onDuplicate={actions.duplicate}
                  onMove={actions.move}
                  onCopy={actions.copy}
                  onMoveToFolder={(i) => actions.openFolderPicker([i], 'move')}
                  onCopyToFolder={(i) => actions.openFolderPicker([i], 'copy')}
                  selection={
                    selectMode
                      ? { selected: selectedIds.has(item.id), onToggle: toggleSelected }
                      : undefined
                  }
                  folderCrumb={searching && item.folder ? folderCrumb(item.folder) : null}
                  onDelete={actions.remove}
                  onEquip={wear?.onEquip}
                  onAddToSlot={wear?.onAddToSlot}
                />
              ))
            )}
            {selectBar}
          </>
        )}
      </div>

      {/* Sticky create / import controls. Import-from-image analyzes a
          reference photo against a character, so it stays character-only. */}
      <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 qt-bg-default border-t qt-border-default flex items-center gap-2 justify-end">
        {onImportFromImage && (
          <button
            type="button"
            onClick={onImportFromImage}
            className="qt-button-ghost qt-button-sm"
            title="Import wardrobe items from a reference image"
          >
            Import from image
          </button>
        )}
        <button
          type="button"
          className="qt-button-primary qt-button-sm"
          disabled={!container}
          onClick={() => actions.openCreate('single', [], { folder: inOwnTier ? currentFolder : '' })}
        >
          + New Item
        </button>
      </div>

      {picker && pickerHome && (
        <WardrobeFolderPickerDialog
          isOpen
          mode={picker.mode}
          container={pickerHome}
          subject={picker.items.length === 1 ? `"${picker.items[0].title}"` : plural(picker.items.length, 'item')}
          outfits={pickerOutfits}
          currentFolder={pickerCurrentFolder}
          working={moving}
          onClose={actions.closeFolderPicker}
          onSubmit={fileToFolder}
        />
      )}
    </section>
  )
}

export interface WardrobeItemOverlaysProps {
  container: WardrobeContainer | null
  /** Display name of `container`, for the editor's pinned destination note. */
  containerLabel: string
  data: WardrobeListData
  actions: WardrobeItemActions
}

/** The overlays a browser's row actions open, stacked above it. */
export function WardrobeItemOverlays({
  container,
  containerLabel,
  data,
  actions,
}: WardrobeItemOverlaysProps) {
  const isCharacterScope = container?.scope === 'character'
  const characterId = isCharacterScope ? container.id : null
  const { editor, transfer, imageView } = actions

  return (
    <>
      {/* A row's picture, full screen — above the dialog and the editor */}
      {imageView?.item.imageFileId && (
        <WardrobeImageViewer
          onClose={actions.closeImage}
          itemId={imageView.item.id}
          itemTitle={imageView.item.title}
          container={imageView.container}
          fileId={imageView.item.imageFileId}
        />
      )}

      {editor && container && (
        <WardrobeItemEditor
          characterId={characterId}
          item={editor.kind === 'edit' ? editor.item : null}
          projectId={data.projectId}
          container={container}
          containerLabel={containerLabel}
          initialMode={editor.kind === 'create' ? editor.mode : undefined}
          initialComponentItemIds={
            editor.kind === 'create' && editor.mode === 'bundle' ? editor.componentItemIds : undefined
          }
          autoFocusTitle={editor.kind === 'create' && editor.mode === 'bundle'}
          initialFolder={editor.kind === 'create' ? editor.folder : undefined}
          onClose={actions.closeEditor}
          onSave={async () => {
            actions.closeEditor()
            await actions.refresh()
          }}
          onImageChanged={() => {
            void actions.refresh()
          }}
        />
      )}

      {transfer && container && (
        <WardrobeTransferDialog
          isOpen
          mode={transfer.mode}
          item={transfer.item}
          sourceCharacterId={characterId}
          sourceProjectId={data.projectId}
          // Name the item's home as the source whenever it is known: the
          // browsed shared container, or in the character view the wardrobe
          // the item's origin names. Only an origin-less merged item falls
          // back to the server's probe across the character's tiers.
          source={
            isCharacterScope ? (transfer.item.origin ? actions.addressOf(transfer.item) : null) : container
          }
          excludeDestination={
            isCharacterScope
              ? transfer.item.origin || transfer.item.characterId
                ? actions.addressOf(transfer.item)
                : null
              : container
          }
          onClose={actions.closeTransfer}
          onTransferred={async () => {
            actions.closeTransfer()
            await actions.refresh()
          }}
        />
      )}
    </>
  )
}
