'use client'

/**
 * The wardrobe browser — one container's list with its search, kind, slot,
 * sort and visibility filters, row actions, and a "+ New Item" button — plus
 * `WardrobeItemOverlays`, the editor / move-copy / full-screen picture the row
 * actions open.
 *
 * Mounted by the Wardrobe dialog (left column, any container) and by the
 * Prospero project page's Wardrobe card (that project's container). The data
 * comes from `useWardrobeListData`, the actions from `useWardrobeItemActions`;
 * this file only lays them out.
 *
 * @module components/wardrobe/WardrobeBrowser
 */

import { useMemo, useState } from 'react'
import { WARDROBE_SLOT_TYPES, WARDROBE_SLOT_META, isComposite } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import {
  WARDROBE_LIST_SORTS,
  sortAndFilterWardrobeItems,
  type WardrobeListSort,
} from '@/lib/wardrobe/wear-display'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import type { WardrobeListData } from './hooks/useWardrobeListData'
import type { WardrobeItemActions } from './hooks/useWardrobeItemActions'
import { WardrobeItemRow } from './wardrobe-item-row'
import { WardrobeItemEditor } from './wardrobe-item-editor'
import { WardrobeImageViewer } from './wardrobe-image-viewer'
import { WardrobeTransferDialog } from './WardrobeTransferDialog'

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
}

export function WardrobeBrowser({
  container,
  data,
  actions,
  showArchived,
  onShowArchivedChange,
  wear,
  onImportFromImage,
  scrollList = true,
}: WardrobeBrowserProps) {
  const isCharacterScope = container?.scope === 'character'
  const { listItems, resolutionPool, loading, canManage } = data

  /**
   * "Show shared": on by default, a purely client-side filter. The character
   * view's list *is* the merge of the character's own garments with every
   * shared tier above them, so hiding shared items means dropping the
   * un-manageable rows after the merge, not asking the server for less.
   */
  const [showShared, setShowShared] = useState(true)
  const [listSort, setListSort] = useState<WardrobeListSort>('title')
  const [neverWornOnly, setNeverWornOnly] = useState(false)
  const [slotFilter, setSlotFilter] = useState<SlotFilter>('all')
  const [kindFilter, setKindFilter] = useState<ItemKind>('items')
  const [titleFilter, setTitleFilter] = useState('')

  const filteredItems = useMemo(() => {
    const sorted = sortAndFilterWardrobeItems(listItems, { sort: listSort, neverWornOnly })
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
    listItems,
    listSort,
    neverWornOnly,
    slotFilter,
    kindFilter,
    titleFilter,
    showShared,
    isCharacterScope,
    canManage,
  ])

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
                onChange={(e) => setShowShared(e.target.checked)}
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
        </div>
      </div>

      <div className={`flex-1 space-y-1 pb-12 ${scrollList ? 'overflow-y-auto max-h-[55vh]' : ''}`}>
        {!container ? (
          <div className="text-sm qt-text-secondary px-3 py-4">Select a wardrobe to browse.</div>
        ) : loading ? (
          <div className="text-sm qt-text-secondary px-3 py-4">Loading…</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-sm qt-text-secondary px-3 py-4">No items match this filter.</div>
        ) : (
          filteredItems.map((item) => (
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
              onDelete={actions.remove}
              onEquip={wear?.onEquip}
              onAddToSlot={wear?.onAddToSlot}
            />
          ))
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
          onClick={() => actions.openCreate('single')}
        >
          + New Item
        </button>
      </div>
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
