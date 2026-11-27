'use client'

/**
 * InventoryEffectFields — an Inventory side-effect row's fields: the action
 * (equip / unequip / pick up), up to eight object references, and the
 * "equip on pick-up" switch.
 *
 * Each reference is read through the editor's VANTAGE (the same one the
 * wardrobe rows use, set by `WardrobeVantageSelect`) and resolves by the one
 * rule the applier uses (`resolveInventoryRef`, archetypes and archived
 * included so the chip can say what it found). A resolved reference renders
 * as a chip with the object's picture, where it lives and whether it is an
 * archetype or a kit; a templated one keeps its text box ("chosen at run
 * time"); an unresolved one keeps its text box under an advisory — the lens
 * is partial and the applier fail-soft. *Choose…* opens the Inventory picker.
 *
 * @module components/custom-tools/InventoryEffectFields
 */

import type { ReactNode } from 'react'
import { InventoryPicture } from '@/components/inventory/inventory-glyph'
import { inventoryPickRule } from '@/components/inventory/inventory-reference-picker'
import { inventoryOriginLabel } from '@/lib/inventory/container'
import { resolveInventoryRef, type ResolvedInventoryPool } from '@/lib/inventory/refs'
import { inventoryDisplayName, inventoryLabel } from '@/lib/inventory/resolve'
import {
  MAX_INVENTORY_EFFECT_ITEMS,
  MAX_INVENTORY_REF_LENGTH,
  type InventoryEffectAction,
} from '@/lib/pascal/custom-tool.types'
import type { DraftInventoryGesture, WardrobeVantage } from '@/lib/pascal/tool-draft'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import { ReferenceRows } from './ReferenceRows'

const INVENTORY_ACTIONS: ReadonlyArray<{ value: InventoryEffectAction; label: string; title: string }> = [
  { value: 'equip', label: 'equip', title: 'The rolling character takes up these objects (or kits)' },
  { value: 'unequip', label: 'unequip', title: 'The rolling character sets these objects down' },
  { value: 'pick_up', label: 'pick up', title: 'Make an instance of each archetype in the rolling character’s vault' },
]

const NO_EQUIPPED: ReadonlySet<string> = new Set()

interface InventoryEffectFieldsProps {
  gesture: DraftInventoryGesture
  hasErrors: boolean
  disabled: boolean
  onChange: (next: DraftInventoryGesture) => void
  pool: ResolvedInventoryPool
  poolFetched: boolean
  vantage: WardrobeVantage
  vantageName: string | null
  onChoose: (index: number, highlightId: string | null) => void
}

export function InventoryEffectFields({
  gesture,
  hasErrors,
  disabled,
  onChange,
  pool,
  poolFetched,
  vantage,
  vantageName,
  onChoose,
}: Readonly<InventoryEffectFieldsProps>) {
  const set = (partial: Partial<DraftInventoryGesture>) => onChange({ ...gesture, ...partial })
  const resolveRow = (ref: string) =>
    vantage.kind === 'none' || ref.includes('{{')
      ? undefined
      : resolveInventoryRef(ref, pool, NO_EQUIPPED, { includeArchetypes: true, includeArchived: true }).find(
          (match) => inventoryPickRule(match.item, gesture.action) === null,
        )?.item ??
        resolveInventoryRef(ref, pool, NO_EQUIPPED, { includeArchetypes: true, includeArchived: true })[0]?.item

  const renderResolved = ({
    item,
    ref,
    index,
    trash,
    setRef,
  }: {
    item: ResolvedInventoryItem
    ref: string
    index: number
    trash: ReactNode
    setRef: (value: string) => void
  }) => {
    const byId = ref.trim() === item.id
    const refusal = inventoryPickRule(item, gesture.action)
    const origin = inventoryOriginLabel(item.origin)
    return (
      <div key={index} className="space-y-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex flex-1 min-w-48 items-center gap-2 rounded border qt-border-default px-2 py-1 text-left hover:opacity-80"
            onClick={() => onChoose(index, item.id)}
            disabled={disabled}
            aria-label={`Object ${index + 1}: ${inventoryLabel(item)} — choose another`}
            data-testid="inventory-reference-chip"
          >
            <InventoryPicture item={item} size={28} />
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block break-words text-sm qt-text">{inventoryDisplayName(item)}</span>
              <span className="flex flex-wrap items-center gap-1">
                {item.isArchetype && <span className="qt-badge qt-badge-info">archetype</span>}
                {item.kind === 'kit' && <span className="qt-badge qt-badge-outline">kit</span>}
                {origin && <span className="qt-badge qt-badge-secondary">{origin}</span>}
                {item.archivedAt && <span className="qt-badge qt-badge-secondary">archived</span>}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="qt-button qt-button-ghost qt-button-sm"
            onClick={() => setRef(byId ? inventoryLabel(item) : item.id)}
            disabled={disabled}
            title={byId ? 'Referenced by id — click to name it instead' : 'Referenced by name — click to use its id'}
          >
            {byId ? 'by id' : 'by name'}
          </button>
          {trash}
        </div>
        {refusal && <p className="text-xs qt-text-secondary">⚠ {refusal}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2">
          Action
          <select
            value={gesture.action}
            onChange={(e) => set({ action: e.target.value as InventoryEffectAction })}
            disabled={disabled}
            className="qt-select qt-select-sm"
            aria-label="Inventory action"
          >
            {INVENTORY_ACTIONS.map((action) => (
              <option key={action.value} value={action.value} title={action.title}>
                {action.label}
              </option>
            ))}
          </select>
        </label>
        {gesture.action === 'pick_up' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={gesture.equip}
              onChange={(e) => set({ equip: e.target.checked })}
              disabled={disabled}
            />
            equip it at once
          </label>
        )}
      </div>

      <ReferenceRows
        refs={gesture.items}
        onChange={(next) => set({ items: next })}
        resolve={resolveRow}
        isTemplated={(ref) => ref.includes('{{')}
        renderResolved={renderResolved}
        canFlagUnresolved={vantage.kind !== 'none' && poolFetched}
        unresolvedText={`not in ${vantageName ?? 'this inventory'}`}
        unresolvedTestId="inventory-reference-unresolved"
        onChoose={(index) => onChoose(index, null)}
        max={MAX_INVENTORY_EFFECT_ITEMS}
        maxLength={MAX_INVENTORY_REF_LENGTH}
        hasErrors={hasErrors}
        disabled={disabled}
        placeholder={(index) => (index === 0 ? (gesture.action === 'pick_up' ? 'magic bow' : 'Excalibur') : '{{params.loot}}')}
        inputLabel={(index) => `Object ${index + 1}`}
        removeTitle="Remove this object"
        chooseTitle="Browse the inventory and pick an object"
        addLabel="Add object"
        atMaxTitle={`At most ${MAX_INVENTORY_EFFECT_ITEMS} objects`}
        hintLead="an id, title or name"
      />
    </div>
  )
}

export default InventoryEffectFields
