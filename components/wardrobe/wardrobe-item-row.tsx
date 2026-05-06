'use client'

/**
 * Wardrobe Item Row
 *
 * One line in the dialog's wardrobe list. Renders title + type badges,
 * an isDefault star toggle, edit/delete buttons, and (in chat) equip /
 * add-to-slot affordances. Composite items are rendered with a `▶/▼`
 * expander that reveals the component rows nested below.
 */

import { useMemo, useState } from 'react'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface WardrobeItemRowProps {
  item: WardrobeItem
  /** All items in the cache (this character + shared archetypes) — used to render composite components inline. */
  allItems: WardrobeItem[]
  /** When set, equip controls are visible. */
  inChat: boolean
  /** Label for the equip-replace button. Defaults to "Wear". */
  equipLabel?: string
  /** Label for the single-slot layer button. Defaults to "+ Layer". */
  layerLabel?: string
  isUpdatingDefault?: boolean
  onToggleDefault: (item: WardrobeItem) => void
  onEdit: (item: WardrobeItem) => void
  onDelete: (item: WardrobeItem) => void
  onEquip?: (item: WardrobeItem) => void
  onAddToSlot?: (item: WardrobeItem, slot: WardrobeItemType) => void
  /** Nesting depth for composite components — used for indentation. */
  depth?: number
}

const TYPE_BADGE_CLASS: Record<WardrobeItemType, string> = {
  top: 'qt-badge-wardrobe-top',
  bottom: 'qt-badge-wardrobe-bottom',
  footwear: 'qt-badge-wardrobe-footwear',
  accessories: 'qt-badge-wardrobe-accessories',
}

export function WardrobeItemRow({
  item,
  allItems,
  inChat,
  equipLabel = 'Wear',
  layerLabel = '+ Layer',
  isUpdatingDefault,
  onToggleDefault,
  onEdit,
  onDelete,
  onEquip,
  onAddToSlot,
  depth = 0,
}: WardrobeItemRowProps) {
  const isComposite = item.componentItemIds.length > 0
  const [expanded, setExpanded] = useState(false)
  const isShared = !item.characterId

  const components = useMemo(() => {
    if (!isComposite) return []
    const byId = new Map(allItems.map((i) => [i.id, i]))
    return item.componentItemIds
      .map((id) => byId.get(id))
      .filter((c): c is WardrobeItem => Boolean(c))
  }, [allItems, item.componentItemIds, isComposite])

  return (
    <div
      className="qt-card-interactive py-2 px-3"
      style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
    >
      <div className="flex items-start gap-2">
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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="qt-text-sm text-foreground truncate">{item.title}</span>
            {isComposite && (
              <span className="qt-text-xs qt-text-secondary">· composite</span>
            )}
            {isShared && <span className="qt-text-xs qt-text-secondary">· shared</span>}
            {item.types.map((t) => (
              <span key={t} className={`qt-badge ${TYPE_BADGE_CLASS[t]} qt-text-xs`}>
                {t}
              </span>
            ))}
          </div>
          {item.appropriateness && (
            <div className="qt-text-xs qt-text-secondary truncate mt-0.5">
              {item.appropriateness}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* isDefault toggle (star) */}
          <button
            type="button"
            onClick={() => onToggleDefault(item)}
            disabled={isUpdatingDefault}
            className={`qt-text-xs px-1 ${item.isDefault ? 'text-primary' : 'qt-text-secondary hover:text-foreground'}`}
            title={item.isDefault ? 'Default outfit item — click to remove' : 'Mark as default outfit item'}
            aria-pressed={item.isDefault}
          >
            {item.isDefault ? '★' : '☆'}
          </button>

          {/* Equip controls — labels vary based on whether the active tab is
              the live "Wearing now" or the transient "Fitting room". */}
          {inChat && onEquip && (
            <button
              type="button"
              onClick={() => onEquip(item)}
              className="qt-button-ghost qt-button-sm"
              title="Replaces every slot this item covers"
            >
              {equipLabel}
            </button>
          )}

          {inChat && onAddToSlot && item.types.length === 1 && (
            <button
              type="button"
              onClick={() => onAddToSlot(item, item.types[0])}
              className="qt-button-ghost qt-button-sm"
              title={`Layer onto ${item.types[0]}`}
            >
              {layerLabel}
            </button>
          )}

          {!isShared && (
            <>
              <button
                type="button"
                onClick={() => onEdit(item)}
                className="qt-button-ghost qt-button-sm"
                title="Edit"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="qt-button-ghost qt-button-sm qt-text-destructive"
                title="Delete"
              >
                Delete
              </button>
            </>
          )}
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
                onToggleDefault={onToggleDefault}
                onEdit={onEdit}
                onDelete={onDelete}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
