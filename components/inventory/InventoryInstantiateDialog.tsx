'use client'

/**
 * Make an instance of an archetype — two ways in:
 *
 *   - from a tier ("+ From archetype"): choose one of the archetypes this
 *     tier can reach, shown with their pictures (the picture is for
 *     choosing);
 *   - from an archetype's row ("Instantiate…"): choose the tier the
 *     instance lands in.
 *
 * Instantiating is not copying: `canCopy` does not apply. The instance
 * inherits every field it does not override, and follows later edits to
 * the archetype until it is detached.
 *
 * @module components/inventory/InventoryInstantiateDialog
 */

import { useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import {
  GENERAL_INVENTORY_CONTAINER,
  GENERAL_INVENTORY_NAME,
  decodeInventoryContainer,
  encodeInventoryContainer,
  type InventoryContainer,
} from '@/lib/inventory/container'
import { useInventoryArchetypes } from '@/lib/hooks/use-inventory'
import type { InventoryItemActions } from './hooks/useInventoryItemActions'
import { describeInventoryRefusal } from './hooks/useInventoryItemActions'
import type { InventoryCatalogue } from './InventoryTransferDialog'
import { InventoryPicture } from './inventory-glyph'

interface InventoryInstantiateDialogProps {
  /** Choose an archetype for this destination… */
  destination?: { container: InventoryContainer; folder: string }
  /** …or a destination for this archetype. */
  archetype?: ResolvedInventoryItem
  /** The project tier a character's archetypes may come from. */
  projectId?: string | null
  catalogue: InventoryCatalogue
  actions: InventoryItemActions
  onClose: () => void
}

export function InventoryInstantiateDialog({
  destination,
  archetype,
  projectId,
  catalogue,
  actions,
  onClose,
}: InventoryInstantiateDialogProps) {
  // An archetype in a project store reaches a character's vault through that project.
  const effectiveProjectId = projectId ?? (archetype?.origin?.scope === 'project' ? archetype.origin.id : null)
  const { archetypes, loading } = useInventoryArchetypes(destination?.container ?? null, effectiveProjectId)
  const [chosenArchetype, setChosenArchetype] = useState<string | null>(archetype?.id ?? null)
  const [target, setTarget] = useState(destination ? encodeInventoryContainer(destination.container) : '')
  const [working, setWorking] = useState(false)

  const submit = async () => {
    const to = decodeInventoryContainer(target)
    if (!to || !chosenArchetype) return
    setWorking(true)
    try {
      const made = await actions.mutations.instantiate(to, {
        archetypeId: chosenArchetype,
        folder: destination?.folder || undefined,
        projectId: effectiveProjectId ?? undefined,
      })
      showSuccessToast(`"${made.title || made.name}" is made from its archetype`)
      onClose()
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The archetype would not be instantiated'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={archetype ? `Instantiate "${archetype.title || archetype.name}"` : 'Make an object from an archetype'}
      maxWidth="lg"
      overlayClassName="z-[70]"
      closeOnClickOutside={!working}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="qt-button-secondary qt-button-sm" onClick={onClose} disabled={working}>Cancel</button>
          <button type="button" className="qt-button-primary qt-button-sm" onClick={() => void submit()} disabled={!chosenArchetype || !target || working}>
            {working ? 'Making…' : 'Instantiate'}
          </button>
        </div>
      )}
    >
      <p className="qt-text-xs qt-text-secondary mb-2">
        The instance follows its archetype — later edits reach it — except for whatever you override on it.
      </p>
      {archetype ? (
        <>
          <label className="text-sm text-foreground" htmlFor="inventory-instantiate-target">Into</label>
          <select id="inventory-instantiate-target" className="qt-select w-full mt-1" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="" disabled>Choose an inventory</option>
            {catalogue.characters.length > 0 && (
              <optgroup label="Characters">
                {catalogue.characters.map((c) => (
                  <option key={c.id} value={encodeInventoryContainer({ scope: 'character', id: c.id })}>{c.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="General">
              <option value={encodeInventoryContainer(GENERAL_INVENTORY_CONTAINER)}>{GENERAL_INVENTORY_NAME}</option>
            </optgroup>
            {catalogue.projects.length > 0 && (
              <optgroup label="Projects">
                {catalogue.projects.map((p) => (
                  <option key={p.id} value={encodeInventoryContainer({ scope: 'project', id: p.id })}>{p.name}</option>
                ))}
              </optgroup>
            )}
            {catalogue.groups.length > 0 && (
              <optgroup label="Groups">
                {catalogue.groups.map((g) => (
                  <option key={g.id} value={encodeInventoryContainer({ scope: 'group', id: g.id })}>{g.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="qt-text-xs qt-text-secondary mt-1">
            The destination must be able to reach the archetype (a character reaches their own vault, their groups, a named project and General).
          </p>
        </>
      ) : loading ? (
        <div className="text-sm qt-text-secondary">Looking for archetypes…</div>
      ) : archetypes.length === 0 ? (
        <div className="text-sm qt-text-secondary">No archetypes are within reach of this inventory yet.</div>
      ) : (
        <ul role="listbox" aria-label="Archetypes" className="space-y-1 max-h-[50vh] overflow-y-auto">
          {archetypes.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={chosenArchetype === a.id}
                onClick={() => setChosenArchetype(a.id)}
                className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${chosenArchetype === a.id ? 'qt-bg-muted' : ''}`}
              >
                <InventoryPicture item={a} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-foreground truncate">{a.title || a.name}</span>
                  {a.description && <span className="block qt-text-xs qt-text-secondary truncate">{a.description}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BaseModal>
  )
}
