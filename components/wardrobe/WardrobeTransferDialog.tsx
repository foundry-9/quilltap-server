'use client'

/**
 * Move or copy one wardrobe item to another wardrobe — a character's vault, a
 * group's or project's store, or Quilltap General. A move keeps the item's
 * id; a copy is a new item. A composite outfit asks what becomes of its
 * components (all or nothing). The destinations are the shared container
 * catalogue (`useContainerCatalogue`) in the shared `ContainerSelect`, the
 * item's own wardrobe left out; the transfer is a TanStack mutation.
 *
 * @module components/wardrobe/WardrobeTransferDialog
 */

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { isComposite as isCompositeItem, type WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { fetchJson } from '@/lib/fetch-helpers'
import { useContainerCatalogue } from '@/lib/hooks/use-container-catalogue'
import { ContainerSelect } from '@/components/item-browser/ContainerSelect'
import { ItemTransferFooter } from '@/components/item-browser/ItemTransferFooter'
import {
  GENERAL_CONTAINER,
  GENERAL_WARDROBE_NAME,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import {
  WardrobeComponentModeFieldset,
  defaultComponentMode,
  type ComponentMode,
} from './WardrobeComponentModeFieldset'

type TransferMode = 'move' | 'copy'

interface WardrobeTransferDialogProps {
  isOpen: boolean
  mode: TransferMode
  item: WardrobeItem
  /**
   * Character-view source: the server probes the character's reachable tiers
   * (vault → project → groups → General) for the item. Null when the dialog
   * is browsing a shared container — pass `source` instead.
   */
  sourceCharacterId: string | null
  sourceProjectId: string | null
  /**
   * Explicit source container (shared-container views): the server resolves
   * the item straight from this container, no character probing.
   */
  source?: WardrobeContainer | null
  /**
   * The container the item is known to live in — hidden from the destination
   * list, since moving or copying an item onto itself is refused anyway.
   */
  excludeDestination?: WardrobeContainer | null
  onClose: () => void
  onTransferred: () => Promise<void> | void
}

export function WardrobeTransferDialog({
  isOpen,
  mode,
  item,
  sourceCharacterId,
  sourceProjectId,
  source = null,
  excludeDestination = null,
  onClose,
  onTransferred,
}: WardrobeTransferDialogProps) {
  const catalogue = useContainerCatalogue()
  const excludedKey = excludeDestination ? encodeWardrobeContainer(excludeDestination) : null
  const generalKey = encodeWardrobeContainer(GENERAL_CONTAINER)
  // General is the natural first choice, unless the item already lives there.
  const [chosen, setChosen] = useState<string | null>(null)
  const selectedDestination = chosen ?? (excludedKey === generalKey ? '' : generalKey)
  const selection = decodeWardrobeContainer(selectedDestination)
  // Composite outfits prompt for their components — all or nothing. A move
  // defaults to moving them along; a copy defaults to copying them, since an
  // outfit that arrives without its pieces is rarely what anyone meant.
  const isComposite = isCompositeItem(item)
  const [componentMode, setComponentMode] = useState<ComponentMode>(defaultComponentMode(mode))

  const transfer = useMutation({
    mutationFn: async (destination: WardrobeContainer) => {
      const result = await fetchJson('/api/v1/wardrobe/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          itemId: item.id,
          ...(sourceCharacterId ? { sourceCharacterId } : {}),
          sourceProjectId,
          ...(source ? { source: { scope: source.scope, ...(source.id ? { id: source.id } : {}) } } : {}),
          ...(isComposite ? { components: componentMode } : {}),
          destination: { scope: destination.scope, ...(destination.id ? { id: destination.id } : {}) },
        }),
      })
      if (!result.ok) throw new Error(result.error || `Failed to ${mode} wardrobe item`)
    },
    onSuccess: async () => {
      showSuccessToast(mode === 'move' ? `Moved "${item.title}"` : `Copied "${item.title}"`)
      await onTransferred()
    },
    onError: (error) => showErrorToast(error instanceof Error ? error.message : String(error)),
  })
  const working = transfer.isPending

  const submitLabel = mode === 'move' ? 'Move item' : 'Copy item'
  const title = mode === 'move' ? 'Move wardrobe item' : 'Copy wardrobe item'

  const handleSubmit = (): void => {
    if (selection) transfer.mutate(selection)
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="lg"
      closeOnClickOutside={!working}
      closeOnEscape={!working}
      footer={(
        <ItemTransferFooter
          mode={mode}
          working={working}
          submitLabel={submitLabel}
          submitDisabled={catalogue.loading || !selection}
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
      )}
    >
      <div className="space-y-3">
        <p className="text-sm">
          {mode === 'move' ? 'Move' : 'Copy'} <span className="font-medium">&quot;{item.title}&quot;</span> to:
        </p>

        {catalogue.loading ? (
          <p className="text-sm qt-text-secondary">Loading destinations…</p>
        ) : (
          <div>
            <label htmlFor="wardrobe-transfer-destination" className="text-sm qt-text-secondary">
              Destination
            </label>
            <ContainerSelect
              id="wardrobe-transfer-destination"
              className="qt-select w-full mt-1"
              value={selectedDestination}
              onChange={setChosen}
              catalogue={catalogue}
              generalName={GENERAL_WARDROBE_NAME}
              placeholder="Choose a wardrobe"
              exclude={excludedKey ? [excludedKey] : []}
              disabled={working}
            />
          </div>
        )}

        {isComposite && (
          <WardrobeComponentModeFieldset
            mode={mode}
            value={componentMode}
            onChange={setComponentMode}
            legend={`This outfit bundles ${item.componentItemIds.length} ${
              item.componentItemIds.length === 1 ? 'component' : 'components'
            }`}
            destination="wardrobe"
            name="wardrobe-transfer-components"
            disabled={working}
          />
        )}

        <p className="qt-text-xs qt-text-secondary">
          Copy creates a new item ID in the destination. Move keeps the item ID and removes it from its current location.
        </p>
      </div>
    </BaseModal>
  )
}
