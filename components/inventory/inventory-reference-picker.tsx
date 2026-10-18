'use client'

/**
 * InventoryReferencePicker — choose an Inventory object to NAME, not to carry.
 *
 * The Inventory twin of `WardrobeReferencePicker`, for Pascal's Workbench: browse
 * what a vantage can reach, each object with its picture (a picker is a
 * selection surface), where it lives and whether it is an archetype or a kit,
 * and click one to pick it. `pick_up` names archetypes, so only archetypes are
 * pickable for it; `equip` and `unequip` grey archetypes out. The picker knows
 * nothing about drafts; it hands back the object and whether the author wants
 * it referenced by its label (title, else name) or by id.
 *
 * @module components/inventory/inventory-reference-picker
 */

import { useMemo, useState, type ReactNode } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { InventoryPicture } from '@/components/inventory/inventory-glyph'
import { useInventoryVantageItems } from '@/lib/hooks/use-inventory-vantage-items'
import { inventoryOriginLabel } from '@/lib/inventory/container'
import { inventoryDisplayName } from '@/lib/inventory/resolve'
import type { InventoryEffectAction } from '@/lib/pascal/custom-tool.types'
import type { WardrobeVantage } from '@/lib/pascal/tool-draft'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

/** How a picked object is written down: by its label (title, else name) or its exact id. */
export type InventoryReferenceForm = 'label' | 'id'

export interface InventoryReferencePickerProps {
  isOpen: boolean
  onClose: () => void
  vantage: WardrobeVantage
  /** A control rendered at the top — the vantage select. */
  headerControl?: ReactNode
  /** The gesture the pick is for: pick_up wants archetypes; the others want anything but. */
  action: InventoryEffectAction
  highlightId?: string | null
  reference: InventoryReferenceForm
  onReferenceChange: (next: InventoryReferenceForm) => void
  onPick: (item: ResolvedInventoryItem, opts: { reference: InventoryReferenceForm }) => void
}

export function InventoryReferencePicker(props: Readonly<InventoryReferencePickerProps>) {
  if (!props.isOpen) return null
  return <PickerBody {...props} />
}

/** Whether `action` may name this object, and why not when it may not. */
export function inventoryPickRule(item: ResolvedInventoryItem, action: InventoryEffectAction): string | null {
  if (action === 'pick_up') return item.isArchetype ? null : 'Pick up names an archetype'
  if (item.isArchetype) return 'An archetype is picked up, not equipped'
  return null
}

function PickerBody({
  onClose,
  vantage,
  headerControl,
  action,
  highlightId = null,
  reference,
  onReferenceChange,
  onPick,
}: Readonly<InventoryReferencePickerProps>) {
  const { items, fetched } = useInventoryVantageItems(vantage)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((item) => showArchived || !item.archivedAt)
      .filter((item) => !q || inventoryDisplayName(item).toLowerCase().includes(q))
      .sort((a, b) => Number(b.isArchetype === (action === 'pick_up')) - Number(a.isArchetype === (action === 'pick_up')))
  }, [items, query, showArchived, action])

  const footer = (
    <div className="flex items-center justify-between w-full gap-2 flex-wrap">
      <label className="flex items-center gap-2 text-sm">
        Write it down by
        <select
          value={reference}
          onChange={(e) => onReferenceChange(e.target.value as InventoryReferenceForm)}
          className="qt-select qt-select-sm"
          aria-label="Reference form"
        >
          <option value="label">title or name</option>
          <option value="id">id</option>
        </select>
      </label>
      <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={onClose}>
        Done
      </button>
    </div>
  )

  return (
    <BaseModal isOpen onClose={onClose} title="Choose an object" maxWidth="2xl" footer={footer} showCloseButton>
      <div className="space-y-3">
        {headerControl && <div>{headerControl}</div>}
        {vantage.kind === 'none' ? (
          <p className="text-sm qt-text-secondary">Choose whose inventory to browse above.</p>
        ) : fetched && items.length === 0 ? (
          <p className="text-sm qt-text-secondary">Nothing is kept here yet. Objects are added from the Inventory.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an object"
                className="qt-input flex-1 min-w-48 text-sm"
                aria-label="Find an object"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="qt-checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
            </div>
            <ul className="space-y-1" data-testid="inventory-reference-picker-list">
              {visible.map((item) => {
                const refusal = inventoryPickRule(item, action)
                const origin = inventoryOriginLabel(item.origin)
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-3 rounded border px-2 py-1 text-left ${
                        item.id === highlightId ? 'qt-border-primary' : 'qt-border-default'
                      } ${refusal ? 'opacity-50' : 'hover:opacity-80'}`}
                      disabled={refusal !== null}
                      title={refusal ?? undefined}
                      onClick={() => {
                        onPick(item, { reference })
                        onClose()
                      }}
                    >
                      <InventoryPicture item={item} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm text-foreground">{inventoryDisplayName(item)}</span>
                        <span className="flex flex-wrap items-center gap-1">
                          {item.isArchetype && <span className="qt-badge qt-badge-info">archetype</span>}
                          {item.kind === 'kit' && <span className="qt-badge qt-badge-outline">kit</span>}
                          {origin && <span className="qt-badge qt-badge-secondary">{origin}</span>}
                          {item.archivedAt && <span className="qt-badge qt-badge-secondary">archived</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </BaseModal>
  )
}

export default InventoryReferencePicker
