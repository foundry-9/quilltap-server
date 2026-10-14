'use client'

import { useEffect, useMemo, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { isComposite as isCompositeItem, type WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  GENERAL_CONTAINER,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  sameWardrobeContainer,
  type WardrobeContainer,
  type WardrobeContainerScope,
} from '@/lib/wardrobe/wardrobe-container'
import {
  WardrobeComponentModeFieldset,
  defaultComponentMode,
  type ComponentMode,
} from './WardrobeComponentModeFieldset'

type TransferMode = 'move' | 'copy'

interface DestinationOption {
  id: string
  name: string
}

interface DestinationsPayload {
  general: { available: boolean; label: string }
  projects: DestinationOption[]
  groups: DestinationOption[]
  users: DestinationOption[]
}

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
  const [loadingDestinations, setLoadingDestinations] = useState(false)
  const [destinations, setDestinations] = useState<DestinationsPayload | null>(null)
  const [selectedDestination, setSelectedDestination] = useState('')
  const [working, setWorking] = useState(false)
  // Composite outfits prompt for their components — all or nothing. A move
  // defaults to moving them along; a copy defaults to copying them, since an
  // outfit that arrives without its pieces is rarely what anyone meant.
  const isComposite = isCompositeItem(item)
  const [componentMode, setComponentMode] = useState<ComponentMode>(defaultComponentMode(mode))

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open; async fetch callback drives the lasting state
    setLoadingDestinations(true)
    setDestinations(null)
    setSelectedDestination('')
    setComponentMode(defaultComponentMode(mode))

    void fetch('/api/v1/wardrobe/transfers')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load destinations (${res.status})`)
        return res.json() as Promise<{ destinations: DestinationsPayload }>
      })
      .then((body) => {
        setDestinations(body.destinations)
        const generalExcluded = sameWardrobeContainer(excludeDestination, GENERAL_CONTAINER)
        if (body.destinations.general.available && !generalExcluded) {
          setSelectedDestination(encodeWardrobeContainer(GENERAL_CONTAINER))
        }
      })
      .catch((error) => {
        showErrorToast(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setLoadingDestinations(false)
      })
  }, [isOpen, mode, excludeDestination])

  const selection = useMemo(
    () => decodeWardrobeContainer(selectedDestination),
    [selectedDestination],
  )

  // The item's known home container is dropped from the list — the server
  // refuses same-place transfers, so offering it would only invite a scolding.
  const visibleDestinations = useMemo<DestinationsPayload | null>(() => {
    if (!destinations) return null
    if (!excludeDestination) return destinations
    const excluded = (scope: WardrobeContainerScope, id: string | null): boolean =>
      sameWardrobeContainer(excludeDestination, { scope, id })
    return {
      general: {
        ...destinations.general,
        available: destinations.general.available && !excluded('general', null),
      },
      projects: destinations.projects.filter((p) => !excluded('project', p.id)),
      groups: destinations.groups.filter((g) => !excluded('group', g.id)),
      users: destinations.users.filter((u) => !excluded('character', u.id)),
    }
  }, [destinations, excludeDestination])

  const submitLabel = mode === 'move' ? 'Move item' : 'Copy item'
  const title = mode === 'move' ? 'Move wardrobe item' : 'Copy wardrobe item'

  const handleSubmit = async (): Promise<void> => {
    if (!selection) return
    setWorking(true)
    try {
      const res = await fetch('/api/v1/wardrobe/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          itemId: item.id,
          ...(sourceCharacterId ? { sourceCharacterId } : {}),
          sourceProjectId,
          ...(source
            ? { source: { scope: source.scope, ...(source.id ? { id: source.id } : {}) } }
            : {}),
          ...(isComposite ? { components: componentMode } : {}),
          destination: {
            scope: selection.scope,
            ...(selection.id ? { id: selection.id } : {}),
          },
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(body.error || `Failed to ${mode} wardrobe item`)
      }
      showSuccessToast(mode === 'move' ? `Moved "${item.title}"` : `Copied "${item.title}"`)
      await onTransferred()
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(false)
    }
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
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="qt-button-secondary qt-button-sm"
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSubmit()
            }}
            className="qt-button-primary qt-button-sm"
            disabled={working || loadingDestinations || !selection}
          >
            {working ? (mode === 'move' ? 'Moving…' : 'Copying…') : submitLabel}
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm">
          {mode === 'move' ? 'Move' : 'Copy'} <span className="font-medium">&quot;{item.title}&quot;</span> to:
        </p>

        {loadingDestinations ? (
          <p className="text-sm qt-text-secondary">Loading destinations…</p>
        ) : (
          <div>
            <label htmlFor="wardrobe-transfer-destination" className="text-sm qt-text-secondary">
              Destination
            </label>
            <select
              id="wardrobe-transfer-destination"
              className="qt-select w-full mt-1"
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
              disabled={working}
            >
              {!visibleDestinations?.general.available &&
                visibleDestinations?.projects.length === 0 &&
                visibleDestinations?.groups.length === 0 &&
                visibleDestinations?.users.length === 0 && (
                  <option value="">No destinations available</option>
                )}

              {visibleDestinations?.general.available && (
                <optgroup label="General">
                  <option value={encodeWardrobeContainer(GENERAL_CONTAINER)}>{visibleDestinations.general.label}</option>
                </optgroup>
              )}

              {visibleDestinations && visibleDestinations.projects.length > 0 && (
                <optgroup label="Projects">
                  {visibleDestinations.projects.map((project) => (
                    <option
                      key={`project-${project.id}`}
                      value={encodeWardrobeContainer({ scope: 'project', id: project.id })}
                    >
                      {project.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {visibleDestinations && visibleDestinations.groups.length > 0 && (
                <optgroup label="Groups">
                  {visibleDestinations.groups.map((group) => (
                    <option key={`group-${group.id}`} value={encodeWardrobeContainer({ scope: 'group', id: group.id })}>
                      {group.name}
                    </option>
                  ))}
                </optgroup>
              )}

              {visibleDestinations && visibleDestinations.users.length > 0 && (
                <optgroup label="Users">
                  {visibleDestinations.users.map((user) => (
                    <option
                      key={`character-${user.id}`}
                      value={encodeWardrobeContainer({ scope: 'character', id: user.id })}
                    >
                      {user.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
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
