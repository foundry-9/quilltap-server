'use client'

/**
 * Inventory Item Row — one object in the Inventory browser.
 *
 * The glyph (SVG → emoji → default, never the picture), the title with the
 * name beside it when both differ, and chips: *Archetype*, *Instance of X*,
 * *Kit · all/some/none* (in a chat), *Equipped*, *Default*, the tier an object
 * is borrowed from, and *archived*. In a chat an Equip / Unequip button sits
 * on the row (never on an archetype). The ⋮ menu holds Edit, Instantiate
 * (archetypes), Detach (instances), Duplicate (only when copyable), Move to
 * folder…, Move / Copy to another tier…, Archive / Restore and Delete. A row
 * borrowed from another tier keeps only the cross-tier Copy (it is filed by
 * whoever manages its own tier).
 *
 * @module components/inventory/inventory-item-row
 */

import { useRef } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useFixedMenu } from '@/hooks/useFixedMenu'
import type { KitState, ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { inventoryOriginLabel } from '@/lib/inventory/container'
import { InventoryGlyph } from './inventory-glyph'

export interface InventoryRowActions {
  onEdit: (item: ResolvedInventoryItem) => void
  onInstantiate: (item: ResolvedInventoryItem) => void
  onDetach: (item: ResolvedInventoryItem) => void
  onDuplicate: (item: ResolvedInventoryItem) => void
  onMoveToFolder: (item: ResolvedInventoryItem) => void
  onTransfer: (item: ResolvedInventoryItem, mode: 'move' | 'copy') => void
  onToggleArchived: (item: ResolvedInventoryItem) => void
  onDelete: (item: ResolvedInventoryItem) => void
}

export interface InventoryRowEquip {
  equipped: boolean
  onEquip: (item: ResolvedInventoryItem) => void
  onUnequip: (item: ResolvedInventoryItem) => void
  /** A kit's state in the chat. */
  kitState?: KitState
}

interface InventoryItemRowProps {
  item: ResolvedInventoryItem
  /** The object lives in the tier being browsed. */
  manageable: boolean
  actions: InventoryRowActions
  /** Present only when the browser is opened from a chat with a character. */
  equip?: InventoryRowEquip
  selection?: { selected: boolean; onToggle: (item: ResolvedInventoryItem) => void }
  /** A search hit's folder. */
  folderCrumb?: string | null
}

const MENU_ITEM = 'block w-full text-left px-3 py-2 text-sm hover:qt-bg-muted disabled:opacity-50'
export function InventoryItemRow({ item, manageable, actions, equip, selection, folderCrumb }: InventoryItemRowProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { anchorRef: buttonRef, menuStyle, open: menuOpen, setOpen: setMenuOpen, close: closeMenu } = useFixedMenu(menuRef)
  useClickOutside(menuRef, closeMenu, { enabled: menuOpen, onEscape: closeMenu, escapeCapture: true })

  const label = item.title || item.name
  const showName = !!item.title && item.title.trim().toLowerCase() !== item.name.trim().toLowerCase()
  const borrowed = manageable ? null : inventoryOriginLabel(item.origin)
  const isInstance = !!item.parentId
  const run = (fn: (i: ResolvedInventoryItem) => void) => () => {
    setMenuOpen(false)
    fn(item)
  }

  return (
    <div
      className={`qt-card py-2 px-3 flex items-center gap-2 ${item.archivedAt ? 'opacity-60' : ''}`}
      data-testid="inventory-item-row"
    >
      {selection && manageable && (
        <input
          type="checkbox"
          className="qt-checkbox"
          checked={selection.selected}
          onChange={() => selection.onToggle(item)}
          aria-label={`Select ${label}`}
        />
      )}
      <InventoryGlyph item={item} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate" title={label}>
          {label}
          {showName && <span className="qt-text-xs qt-text-secondary ml-1">({item.name})</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          {item.isArchetype && <span className="qt-badge qt-badge-primary">Archetype</span>}
          {isInstance && (
            <span className="qt-badge qt-badge-outline" title={item.parentMissing ? 'Its archetype could not be found' : undefined}>
              {item.parentMissing ? 'Instance (archetype missing)' : `Instance of ${item.parentName ?? 'an archetype'}`}
            </span>
          )}
          {item.kind === 'kit' && (
            <span className="qt-badge qt-badge-info">
              Kit{equip?.kitState ? ` · ${equip.kitState}` : ` · ${item.itemIds.length}`}
            </span>
          )}
          {equip?.equipped && <span className="qt-badge qt-badge-success">Equipped</span>}
          {item.equippedByDefault && !item.isArchetype && <span className="qt-badge qt-badge-secondary">Default</span>}
          {borrowed && <span className="qt-badge qt-badge-wardrobe-shared">{borrowed}</span>}
          {item.archivedAt && <span className="qt-badge qt-badge-secondary">archived</span>}
          {folderCrumb && (
            <span className="qt-text-xs qt-text-secondary" data-testid="inventory-folder-crumb">
              {folderCrumb}
            </span>
          )}
        </div>
      </div>

      {equip && !item.isArchetype && !item.archivedAt && (
        item.kind === 'kit' || !equip.equipped ? (
          <button type="button" className="qt-button-secondary qt-button-sm" disabled={!!selection} onClick={() => equip.onEquip(item)}>
            Equip
          </button>
        ) : (
          <button type="button" className="qt-button-ghost qt-button-sm" disabled={!!selection} onClick={() => equip.onUnequip(item)}>
            Unequip
          </button>
        )
      )}

      <div className="relative" ref={menuRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          disabled={!!selection}
          className="qt-button-ghost qt-button-sm"
          aria-label="More actions"
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          ⋮
        </button>
        {menuOpen && (
          <div role="menu" style={menuStyle ?? undefined} className="z-30 min-w-[14rem] rounded border qt-border-default qt-bg-popover shadow-md">
            <ul className="divide-y qt-border-default">
              {manageable && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onEdit)}>
                    Edit
                  </button>
                </li>
              )}
              {equip && item.kind === 'kit' && equip.kitState && equip.kitState !== 'none' && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(equip.onUnequip)}>
                    Unequip the kit
                  </button>
                </li>
              )}
              {item.isArchetype && !item.archivedAt && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onInstantiate)}>
                    Instantiate…
                  </button>
                </li>
              )}
              {manageable && isInstance && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onDetach)}>
                    Detach from archetype…
                  </button>
                </li>
              )}
              {manageable && item.canCopy && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onDuplicate)}>
                    Duplicate
                  </button>
                </li>
              )}
              {manageable && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onMoveToFolder)}>
                    Move to folder…
                  </button>
                </li>
              )}
              {manageable && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setMenuOpen(false); actions.onTransfer(item, 'move') }}>
                    Move to another inventory…
                  </button>
                </li>
              )}
              {item.canCopy && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setMenuOpen(false); actions.onTransfer(item, 'copy') }}>
                    Copy to another inventory…
                  </button>
                </li>
              )}
              {manageable && (
                <li>
                  <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(actions.onToggleArchived)}>
                    {item.archivedAt ? 'Restore' : 'Archive'}
                  </button>
                </li>
              )}
              {manageable && (
                <li>
                  <button type="button" role="menuitem" className={`${MENU_ITEM} qt-text-destructive`} onClick={run(actions.onDelete)}>
                    Delete
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
