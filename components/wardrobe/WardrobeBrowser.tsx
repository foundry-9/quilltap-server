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
 * the folder tree and its mutations from `use-wardrobe-folders`, the view
 * state from the shared `useFolderBrowserState` and the layout from
 * `FolderBrowserShell`; this file adds the wardrobe's filters, rows and
 * wording.
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
import { folderCrumb } from '@/lib/wardrobe/folders'
import { viewTierOf } from '@/lib/wardrobe/folder-view'
import { useWardrobeFolderMutations, useWardrobeFolders } from '@/lib/hooks/use-wardrobe-folders'
import type { TierItem } from '@/lib/hooks/use-wardrobe-tier'
import type { WardrobeListData } from './hooks/useWardrobeListData'
import type { WardrobeItemActions } from './hooks/useWardrobeItemActions'
import { WardrobeItemRow } from './wardrobe-item-row'
import { WardrobeItemEditor } from './wardrobe-item-editor'
import { ItemImageViewer } from '@/components/item-browser/ItemImageViewer'
import { WardrobeTransferDialog } from './WardrobeTransferDialog'
import { ItemFolderPickerDialog, type ItemFolderPickerWording } from '@/components/item-browser/ItemFolderPickerDialog'
import { FolderBrowserShell } from '@/components/item-browser/FolderBrowserShell'
import { useFolderBrowserState, useItemFolderHandlers } from '@/components/item-browser/useFolderBrowserState'
import {
  WardrobeComponentModeFieldset,
  defaultComponentMode,
  type ComponentMode,
} from './WardrobeComponentModeFieldset'
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
  /** Open the portrait-cue (image prompt) optimizer for the browsed tier. */
  onOptimizePrompts?: () => void
  /** Cap the list's height (the dialog) instead of letting it grow (a card). */
  scrollList?: boolean
  /**
   * Character view only: the pronoun-aware filter (owned by the caller so the
   * composers beside the list share its switch).
   */
  pronounFilter?: PronounGuidanceFilter
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const WARDROBE_PICKER_WORDING: ItemFolderPickerWording = {
  rootLabel: 'Wardrobe (top level)',
  noun: 'item',
  rootPhrase: 'the top of the wardrobe',
  rests: ['hangs', 'hang'],
  moveNote: 'Folders are for your browsing; what anyone can wear stays exactly as it was.',
  copyNote: 'Each copy is a new item with its own ID and a "(copy)" title, filed in the folder you choose.',
  describeError: (error, fallback) => (error instanceof Error ? error.message : fallback),
}

export function WardrobeBrowser({
  container,
  data,
  actions,
  showArchived,
  onShowArchivedChange,
  wear,
  onImportFromImage,
  onOptimizePrompts,
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
  // The Move-to-folder picker's state lives in the actions hook, so the
  // dialog's `overlayOpen` counts it (bug 229).
  const picker = actions.folderPicker
  const searching = titleFilter.trim().length > 0

  const { folders: tree } = useWardrobeFolders(container)
  const folderOps = useWardrobeFolderMutations()

  const tierOf = useCallback(
    (item: TierItem): string => viewTierOf(item, canManage(item), isCharacterScope),
    [canManage, isCharacterScope],
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

  const state = useFolderBrowserState({
    containerKey: container ? encodeWardrobeContainer(container) : '',
    items: offeredItems,
    filtered: filteredItems,
    tree,
    tierOf,
    characterView: isCharacterScope,
    showShared,
    searching,
  })
  const { inOwnTier, currentFolder, selectMode, selectedIds, setSelectMode } = state

  const folderHandlers = useItemFolderHandlers({
    state,
    ops: container
      ? {
          create: (path) => folderOps.createFolder(container, path),
          rename: (path, name) => folderOps.renameFolder(container, path, name),
          remove: (path) => folderOps.deleteFolder(container, path),
        }
      : null,
    wording: {
      noun: 'item',
      rootPhrase: 'the top of the wardrobe',
      created: (name) => `The folder "${name}" is ready for hanging things in`,
      movedUp: (count) => `Folder removed; ${count} moved up a peg`,
      // The list holds archived pieces only when "Show archived" is ticked,
      // but the server moves them all; say so rather than understate the move.
      deleteMessage: ({ name, count, parentLabel }) => {
        const archivedNote = showArchived ? '' : ' (and any archived pieces filed there)'
        return count > 0
          ? `Send its ${plural(count, 'item')}${archivedNote} up to ${parentLabel}? Only the folder itself goes.`
          : showArchived
            ? `Remove the empty folder "${name}"?`
            : `Remove the folder "${name}"? Anything archived in it goes up to ${parentLabel}.`
      },
    },
    confirm: actions.confirm,
    describeError: (error, fallback) => (error instanceof Error ? error.message : fallback),
  })

  // ---- filing items -------------------------------------------------------

  const pickerHome = picker ? actions.addressOf(picker.items[0]) : null
  const pickerOutfits = useMemo(() => (picker ? picker.items.filter(isComposite) : []), [picker])
  const componentCount = pickerOutfits.reduce((n, o) => n + o.componentItemIds.length, 0)
  const componentsLegend =
    pickerOutfits.length === 1
      ? `This outfit bundles ${plural(componentCount, 'component')}`
      : `${pickerOutfits.length} of these are outfits, bundling ${plural(componentCount, 'component')} between them`

  return (
    <FolderBrowserShell
      state={state}
      hasContainer={container !== null}
      loading={loading}
      testIdPrefix="wardrobe"
      rootLabel="Wardrobe"
      scrollList={scrollList}
      folderHandlers={folderHandlers}
      text={{
        noContainer: 'Select a wardrobe to browse.',
        folderEmpty: 'Nothing hangs here yet.',
        noMatch: 'No items match this filter.',
      }}
      filters={(
        <>
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
                      ? 'qt-bg-default qt-text shadow-sm'
                      : 'qt-text-secondary hover:qt-text'
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
                aria-pressed={slotFilter === slot}
                className={`qt-button-sm ${slotFilter === slot ? 'qt-button-secondary' : 'qt-button-ghost'}`}
              >
                {slot === 'all' ? 'All' : WARDROBE_SLOT_META[slot].label}
              </button>
            ))}
          </div>
        </>
      )}
      toggles={{
        archived: { checked: showArchived, onChange: onShowArchivedChange },
        // Only the character view merges in other tiers; browsing a
        // container, every row already belongs to it.
        shared: isCharacterScope ? { checked: showShared, onChange: setShowShared } : undefined,
        after: (
          <>
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
          </>
        ),
      }}
      renderItem={(item) => (
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
          selection={selectMode ? { selected: selectedIds.has(item.id), onToggle: () => state.toggleSelected(item) } : undefined}
          folderCrumb={searching && item.folder ? folderCrumb(item.folder) : null}
          onDelete={actions.remove}
          onEquip={wear?.onEquip}
          onAddToSlot={wear?.onAddToSlot}
        />
      )}
      folderFiling={{ open: actions.openFolderPicker }}
      footer={(
        <>
          {/* Import-from-image analyzes a reference photo against a
              character, so it stays character-only. */}
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
          {/* The portrait-cue wizard reviews only the browsed tier's own pieces. */}
          {onOptimizePrompts && (
            <button
              type="button"
              onClick={onOptimizePrompts}
              className="qt-button-ghost qt-button-sm"
              title="Check every garment's image prompt against its description"
            >
              Polish portrait cues
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
        </>
      )}
    >
      {picker && pickerHome && (
        <ItemFolderPickerDialog<WardrobeItem, ComponentMode>
          mode={picker.mode}
          items={picker.items}
          container={pickerHome}
          port={{ useFolders: useWardrobeFolders, createFolder: folderOps.createFolder, creating: folderOps.pending }}
          wording={WARDROBE_PICKER_WORDING}
          choice={
            pickerOutfits.length > 0
              ? {
                  initial: defaultComponentMode(picker.mode),
                  render: (value, onChange, working) => (
                    <WardrobeComponentModeFieldset
                      mode={picker.mode}
                      value={value}
                      onChange={onChange}
                      legend={componentsLegend}
                      destination="folder"
                      name="wardrobe-folder-components"
                      disabled={working}
                    />
                  ),
                }
              : undefined
          }
          file={(folder, components) => {
            const ids = picker.items.map((i) => i.id)
            return picker.mode === 'copy'
              ? folderOps.copyItems(pickerHome, ids, folder, components === 'move' ? undefined : components)
              : folderOps.moveItems(pickerHome, ids, folder, components)
          }}
          onFiled={() => setSelectMode(false)}
          onClose={actions.closeFolderPicker}
        />
      )}
    </FolderBrowserShell>
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
        <ItemImageViewer
          kind="wardrobe"
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
