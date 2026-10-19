'use client'

/**
 * *Carrying now* — what one cast member carries in this chat, beside the
 * Inventory browser when the dialog is opened from a chat: each object with
 * its glyph and an Unequip button, the kits within reach with their
 * all / some / none state (Equip / Unequip the whole kit), *Take up…* (a
 * picker over everything the character can reach, pictures shown) and
 * *Reset to defaults*.
 *
 * @module components/inventory/CarryingNowPane
 */

import { useMemo } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import type { CarriedEntry } from '@/lib/hooks/use-inventory'
import { inventoryDisplayName } from '@/lib/inventory/resolve'
import { InventoryGlyph, InventoryPicture } from './inventory-glyph'

interface CarryingNowPaneProps {
  characterName: string
  carried: CarriedEntry
  /** Everything the character can reach (for kits' names and the picker). */
  pool: ResolvedInventoryItem[]
  busy: boolean
  onEquip: (ids: string[]) => void
  onUnequip: (ids: string[]) => void
  onReset: () => void
  /** The *Take up…* picker's open state, held by the dialog so its own Escape and click-outside stand down while the picker is up. */
  picking: boolean
  onPickingChange: (open: boolean) => void
}

export function CarryingNowPane({
  characterName,
  carried,
  pool,
  busy,
  onEquip,
  onUnequip,
  onReset,
  picking,
  onPickingChange: setPicking,
}: CarryingNowPaneProps) {
  const byId = useMemo(() => new Map(pool.map((i) => [i.id, i])), [pool])
  const carriedIds = useMemo(() => new Set(carried.equipped.map((i) => i.id)), [carried])
  const kits = useMemo(
    () => Object.entries(carried.kits).map(([id, state]) => ({ kit: byId.get(id), state })).filter((k) => k.kit),
    [carried.kits, byId],
  )
  const choices = useMemo(
    () => pool.filter((i) => !i.isArchetype && !i.archivedAt && i.kind !== 'kit' && !carriedIds.has(i.id)),
    [pool, carriedIds],
  )

  return (
    <section className="flex flex-col min-h-0 gap-2" data-testid="inventory-carrying-now">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm text-foreground">Carrying now · {characterName} in this chat</h3>
        <div className="flex items-center gap-1">
          <button type="button" className="qt-button-secondary qt-button-sm" onClick={() => setPicking(true)} disabled={busy}>
            Take up…
          </button>
          <button type="button" className="qt-button-ghost qt-button-sm" onClick={onReset} disabled={busy}>
            Reset to defaults
          </button>
        </div>
      </div>
      {carried.equipped.length === 0 ? (
        <p className="qt-text-xs qt-text-secondary px-1">Empty-handed. Equip something from the list, or take it up here.</p>
      ) : (
        <ul className="space-y-1" aria-label="Carried objects">
          {carried.equipped.map((item) => (
            <li key={item.id} className="qt-card py-1.5 px-2 flex items-center gap-2">
              <InventoryGlyph item={item} size="sm" />
              <span className="flex-1 min-w-0 text-sm truncate">{inventoryDisplayName(item)}</span>
              {!item.description && <span className="qt-text-xs qt-text-secondary" title="No description: the model is told nothing about it">silent</span>}
              <button type="button" className="qt-button-ghost qt-button-sm" disabled={busy} onClick={() => onUnequip([item.id])}>
                Unequip
              </button>
            </li>
          ))}
        </ul>
      )}
      {kits.length > 0 && (
        <div className="space-y-1">
          <h4 className="qt-text-xs qt-text-secondary px-1">Kits</h4>
          <ul className="space-y-1" aria-label="Kits">
            {kits.map(({ kit, state }) => (
              <li key={kit!.id} className="qt-card py-1.5 px-2 flex items-center gap-2">
                <InventoryGlyph item={kit!} size="sm" />
                <span className="flex-1 min-w-0 text-sm truncate">{inventoryDisplayName(kit!)}</span>
                <span className="qt-badge qt-badge-info">{state}</span>
                {state !== 'all' && (
                  <button type="button" className="qt-button-secondary qt-button-sm" disabled={busy} onClick={() => onEquip([kit!.id])}>
                    Equip
                  </button>
                )}
                {state !== 'none' && (
                  <button type="button" className="qt-button-ghost qt-button-sm" disabled={busy} onClick={() => onUnequip([kit!.id])}>
                    Unequip
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {picking && (
        <BaseModal
          isOpen
          onClose={() => setPicking(false)}
          title={`Take up — ${characterName}`}
          maxWidth="lg"
          overlayClassName="z-[70]"
          showCloseButton
          footer={(
            <div className="flex items-center justify-end w-full">
              <button type="button" onClick={() => setPicking(false)} className="qt-button-secondary qt-button-sm">Cancel</button>
            </div>
          )}
        >
          {choices.length === 0 ? (
            <p className="text-sm qt-text-secondary">Nothing within reach that is not already carried.</p>
          ) : (
            <ul role="listbox" aria-label="Objects within reach" className="space-y-1 max-h-[55vh] overflow-y-auto">
              {choices.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:qt-bg-muted"
                    onClick={() => {
                      setPicking(false)
                      onEquip([item.id])
                    }}
                  >
                    <InventoryPicture item={item} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground truncate">{inventoryDisplayName(item)}</span>
                      {item.description && <span className="block qt-text-xs qt-text-secondary truncate">{item.description}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </BaseModal>
      )}
    </section>
  )
}
