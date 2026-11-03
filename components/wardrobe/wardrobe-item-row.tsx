'use client'

/**
 * Wardrobe Item Row
 *
 * One line in the dialog's wardrobe list. Shows the item title (allowed to
 * wrap to two lines, with a hover tooltip for the full title), slot-color
 * chips, and three controls:
 *
 *  - Primary equip button (`Wear` / `Try on`, label depends on which right-
 *    column tab is active).
 *  - `[+]` icon that adds the item to a slot. For single-slot items this
 *    targets the item's only slot directly; for multi-slot items it opens
 *    the shared `ItemActionMenu` to pick one.
 *  - `⋮` kebab menu with secondary actions: Edit, Generate image, toggle the
 *    default-outfit flag, Duplicate, Archive, Move to folder…, Copy to folder…, Move to another
 *    wardrobe…, Copy to another wardrobe…, and Delete. Which of these appear
 *    is governed by the `canManage` predicate: items living in the container
 *    being browsed get the full set, items merged in from another shared
 *    tier keep only the two cross-wardrobe actions (a borrowed item is filed
 *    by whoever manages its own wardrobe).
 *
 * In the browser's select mode a manageable row shows a checkbox and its
 * other controls go quiet; a search hit shows the folder it lives in.
 *
 * Composite items keep a `▶/▼` expander on the left so the user can peek at
 * the components without entering the editor.
 *
 * When the item has a current picture, a 40 px thumbnail sits at the left of
 * the title block; an item without one shows nothing there. With
 * `onOpenImage` the thumbnail opens the picture full screen.
 *
 * Under the badges sits one muted line from the wear ledger (`Worn 4× · last
 * …` / `Never worn`); an item read without a `wear` annotation is never worn.
 */

import { useMemo, useState } from 'react'
import { ItemActionMenu } from '@/components/item-browser/ItemActionMenu'
import { WARDROBE_SLOT_META, isComposite as isCompositeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { wardrobeOriginLabel, type ListedWardrobeItem } from '@/lib/wardrobe/wardrobe-container'
import { formatWearLine, wearOf, type WearAnnotated } from '@/lib/wardrobe/wear-display'
import { WardrobeItemThumbnail } from './wardrobe-item-thumbnail'
import { SlotBadge } from './slot-ui'
import { formatPronounGuidance } from '@/lib/wardrobe/pronoun-guidance'

/** A listed item, plus the wear-ledger annotation the collection reads attach. */
type RowItem = ListedWardrobeItem & WearAnnotated

interface WardrobeItemRowProps {
  item: RowItem
  /** All items in the cache (this character + shared archetypes) — used to render composite components inline. */
  allItems: RowItem[]
  /** When set, equip controls are visible. */
  inChat: boolean
  /**
   * Whether an item can be managed (edited / starred / duplicated / deleted)
   * from the current view — true when the item lives in the container being
   * browsed, false when it was merged in from a shared tier elsewhere. Items
   * failing this check keep only Move and Copy, and carry a chip naming the
   * wardrobe they were borrowed from (`Project · Thornfield`).
   * Defaults to the character-view rule: manageable iff character-owned.
   */
  canManage?: (item: WardrobeItem) => boolean
  /** Label for the equip-replace button. Defaults to "Wear". */
  equipLabel?: string
  /**
   * Whether the `[+]` icon should be framed as "layer onto" (Live outfit) or
   * "add to" (Outfit Builder). Affects the tooltip only.
   */
  addAction?: 'layer' | 'add'
  isUpdatingDefault?: boolean
  onToggleDefault: (item: WardrobeItem) => void
  onEdit: (item: WardrobeItem) => void
  onDuplicate: (item: WardrobeItem) => void
  onMove: (item: WardrobeItem) => void
  onCopy: (item: WardrobeItem) => void
  /** File the item in another folder of its own wardrobe (manageable rows only). */
  onMoveToFolder?: (item: WardrobeItem) => void
  /** Copy to another folder of the same wardrobe (offered beside Move to folder…). */
  onCopyToFolder?: (item: WardrobeItem) => void
  /**
   * Select mode: a checkbox on a manageable row (never on a borrowed one),
   * and the wear buttons and `⋮` disabled while it is on.
   */
  selection?: { selected: boolean; onToggle: (item: WardrobeItem) => void }
  /** A search hit's folder, shown as a muted crumb (`Formal › Evening`). */
  folderCrumb?: string | null
  onDelete: (item: WardrobeItem) => void
  /**
   * Archive an active garment, or restore an archived one. Optional — a
   * surface that can't archive (the outfit composer) simply omits it and the
   * menu entry doesn't render.
   */
  onToggleArchived?: (item: WardrobeItem) => void
  /**
   * Draw a picture with the designated wardrobe profile. Optional — offered
   * under Edit for manageable rows only; a borrowed garment is drawn by
   * whoever manages its own wardrobe.
   */
  onGenerateImage?: (item: WardrobeItem) => void
  /**
   * Items whose picture is being generated right now. Passed down to nested
   * component rows too, so every representation of an item is busy while its
   * commission is out.
   */
  generatingImageIds?: ReadonlySet<string>
  /** Open the item's current picture full screen. Passed down to nested rows. */
  onOpenImage?: (item: ListedWardrobeItem) => void
  onEquip?: (item: WardrobeItem) => void
  onAddToSlot?: (item: WardrobeItem, slot: WardrobeItemType) => void
  /** Nesting depth for composite components — used for indentation. */
  depth?: number
}

export function WardrobeItemRow({
  item,
  allItems,
  inChat,
  canManage,
  equipLabel = 'Wear',
  addAction = 'layer',
  isUpdatingDefault,
  onToggleDefault,
  onEdit,
  onDuplicate,
  onMove,
  onCopy,
  onMoveToFolder,
  onCopyToFolder,
  selection,
  folderCrumb,
  onDelete,
  onToggleArchived,
  onGenerateImage,
  generatingImageIds,
  onOpenImage,
  onEquip,
  onAddToSlot,
  depth = 0,
}: WardrobeItemRowProps) {
  const isGeneratingImage = generatingImageIds?.has(item.id) ?? false
  const isComposite = isCompositeItem(item)
  const [expanded, setExpanded] = useState(false)
  // Without an explicit predicate, fall back to the character-view rule:
  // personal items are manageable, shared-tier items are Move/Copy only.
  const manageable = canManage ? canManage(item) : Boolean(item.characterId)
  // "May this view edit it" and "where did it come from" are separate
  // questions; the chip answers the second, and only for borrowed rows.
  const originLabel = wardrobeOriginLabel(item.origin)
  const selectMode = selection !== undefined

  const components = useMemo(() => {
    if (!isComposite) return []
    const byId = new Map(allItems.map((i) => [i.id, i]))
    return item.componentItemIds
      .map((id) => byId.get(id))
      .filter((c): c is RowItem => Boolean(c))
  }, [allItems, item.componentItemIds, isComposite])

  const addTooltip =
    item.types.length === 1
      ? `${addAction === 'layer' ? 'Layer onto' : 'Add to'} ${WARDROBE_SLOT_META[item.types[0]].label.toLowerCase()}`
      : addAction === 'layer'
        ? 'Layer onto a slot'
        : 'Add to a slot'

  return (
    <div
      className="qt-card-interactive py-2 px-3"
      style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          manageable ? (
            <input
              type="checkbox"
              className="qt-checkbox mt-1"
              checked={selection.selected}
              onChange={() => selection.onToggle(item)}
              aria-label={`Select ${item.title}`}
            />
          ) : (
            <span className="inline-block w-4" aria-hidden />
          )
        )}
        {isComposite ? (
          <button
            type="button"
            className="qt-text-secondary hover:text-foreground mt-0.5"
            aria-label={expanded ? 'Collapse components' : 'Expand components'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="inline-block w-3" aria-hidden />
        )}

        <WardrobeItemThumbnail
          fileId={item.imageFileId}
          size={40}
          onOpen={onOpenImage ? () => onOpenImage(item) : undefined}
          openLabel={`View the picture of ${item.title}`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-sm text-foreground"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
                maxWidth: '100%',
                minWidth: 0,
              }}
              title={item.title}
            >
              {item.title}
            </span>
            {isComposite && (
              <span className="qt-text-xs qt-text-secondary">· bundle</span>
            )}
            {item.isDefault && (
              <span className="qt-text-xs qt-text-secondary">· default</span>
            )}
            {item.archivedAt && (
              <span className="qt-badge qt-badge-secondary">archived</span>
            )}
            {item.types.map((t) => (
              <SlotBadge key={t} slot={t} />
            ))}
            {!manageable && originLabel && (
              <span
                className="qt-badge qt-badge-wardrobe-shared"
                title={`Borrowed from ${originLabel}`}
              >
                {originLabel}
              </span>
            )}
          </div>
          {folderCrumb && (
            <div className="qt-text-xs qt-text-secondary mt-0.5" data-testid="wardrobe-folder-crumb">
              {folderCrumb}
            </div>
          )}
          {/* Wear ledger tally — the count is what gets compared across rows;
              the full breakdown is the editor's job. */}
          <div className="qt-text-xs qt-text-secondary mt-0.5" data-testid="wardrobe-wear-line">
            {formatWearLine(wearOf(item))}
          </div>
          {item.appropriateness && (
            <div className="qt-text-xs qt-text-secondary truncate mt-0.5">
              {item.appropriateness}
            </div>
          )}
          {(item.pronounGuidance?.length ?? 0) > 0 && (
            <div className="qt-text-xs qt-text-secondary truncate mt-0.5" data-testid="wardrobe-pronoun-guidance">
              For {formatPronounGuidance(item.pronounGuidance)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Primary equip button — label depends on the active right-column
              tab (Wear in Live outfit, Try on in Outfit Builder). */}
          {inChat && onEquip && (
            <button
              type="button"
              onClick={() => onEquip(item)}
              disabled={selectMode}
              className="qt-button-ghost qt-button-sm"
              title="Puts it on across every slot it covers — layers or replaces per the item's setting"
            >
              {equipLabel}
            </button>
          )}

          {/* Single-icon add button. For single-typed items it adds directly;
              for multi-typed it opens a slot picker — the shared menu, fixed
              to the viewport so the dialog's scrolling list cannot clip it. */}
          {inChat && onAddToSlot && (
            item.types.length === 1 ? (
              <button
                type="button"
                onClick={() => onAddToSlot(item, item.types[0])}
                disabled={selectMode}
                className="qt-button-ghost qt-button-sm"
                title={addTooltip}
                aria-label={addTooltip}
              >
                +
              </button>
            ) : (
              <ItemActionMenu
                label={addTooltip}
                trigger={{ content: '+', ariaLabel: addTooltip }}
                disabled={selectMode}
                room={240}
                minWidthClass="min-w-[10rem]"
                entries={item.types.map((slot) => ({
                  key: `slot-${slot}`,
                  label: (
                    <span className="flex items-center justify-between gap-2">
                      <span>{WARDROBE_SLOT_META[slot].label}</span>
                      <SlotBadge slot={slot} />
                    </span>
                  ),
                  onSelect: () => onAddToSlot(item, slot),
                }))}
              />
            )
          )}

          {/* Kebab menu — item actions */}
          <ItemActionMenu
            disabled={selectMode}
            entries={[
              manageable && { key: 'edit', label: 'Edit', onSelect: () => onEdit(item) },
              manageable && onGenerateImage && {
                key: 'generate-image',
                label: isGeneratingImage ? 'Generating image…' : 'Generate image',
                disabled: isGeneratingImage,
                onSelect: () => onGenerateImage(item),
              },
              manageable && {
                key: 'default',
                label: item.isDefault ? '☆ Unmark as default' : '★ Mark as default outfit item',
                disabled: isUpdatingDefault,
                onSelect: () => onToggleDefault(item),
              },
              manageable && { key: 'duplicate', label: 'Duplicate', onSelect: () => onDuplicate(item) },
              manageable && onToggleArchived && {
                key: 'archive',
                label: item.archivedAt ? 'Restore from archive' : 'Archive',
                onSelect: () => onToggleArchived(item),
              },
              manageable && onMoveToFolder && { key: 'move-to-folder', label: 'Move to folder…', onSelect: () => onMoveToFolder(item) },
              manageable && onCopyToFolder && { key: 'copy-to-folder', label: 'Copy to folder…', onSelect: () => onCopyToFolder(item) },
              { key: 'transfer-move', label: 'Move to another wardrobe…', onSelect: () => onMove(item) },
              { key: 'transfer-copy', label: 'Copy to another wardrobe…', onSelect: () => onCopy(item) },
              manageable && { key: 'delete', label: 'Delete', destructive: true, onSelect: () => onDelete(item) },
            ]}
          />
        </div>
      </div>

      {/* Nested components (read-only here; click Edit to change) */}
      {isComposite && expanded && (
        <div className="mt-2 border-l-2 qt-border-default pl-2 space-y-1">
          {components.length === 0 ? (
            <div className="qt-text-xs qt-text-secondary px-2 py-1">
              Components missing from this wardrobe.
            </div>
          ) : (
            components.map((c) => (
              <WardrobeItemRow
                key={c.id}
                item={c}
                allItems={allItems}
                inChat={false}
                canManage={canManage}
                onToggleDefault={onToggleDefault}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onMove={onMove}
                onCopy={onCopy}
                onDelete={onDelete}
                onGenerateImage={onGenerateImage}
                generatingImageIds={generatingImageIds}
                onOpenImage={onOpenImage}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
