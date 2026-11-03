'use client'

/**
 * Move / Copy / Hard link a store's files or a folder to a folder in this
 * store or another: `DestinationPickerDialog` with a store chooser above the
 * folder tree. The stores offered are the ones that can take what is sent —
 * any enabled, quiescent store for a move or copy; for a hard link only the
 * stores `canLinkBetween` allows.
 *
 * @module components/document-browser/DocumentDestinationDialog
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DestinationPickerDialog, type DestinationMode } from '@/components/item-browser/DestinationPickerDialog'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { deriveMountCapabilities } from '@/lib/mount-index/capabilities'
import { canLinkBetween, capabilitiesOf, type BrowserStore } from '@/lib/folder-browser/document-actions'
import { fetchDocumentListing } from './useDocumentStoreSource'
import type { DocMountPoint } from '@/lib/schemas/mount-index.types'

interface StoreSummary extends BrowserStore {
  name: string
  storeType: 'documents' | 'character'
}

/** The stores a destination may be chosen from, with their capabilities derived. */
export function useStoreCatalogue(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.mountPoints.list(),
    queryFn: ({ signal }) => apiFetch<{ mountPoints: DocMountPoint[] }>('/api/v1/mount-points', { signal }),
    enabled,
    select: (data): StoreSummary[] =>
      data.mountPoints
        .map((mp) => ({
          id: mp.id,
          name: mp.name,
          mountType: mp.mountType,
          storeType: mp.storeType,
          enabled: mp.enabled,
          capabilities: deriveMountCapabilities(mp),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  })
}

export interface DocumentDestination {
  mountPointId: string
  folder: string
}

export interface DocumentDestinationDialogProps {
  isOpen: boolean
  mode: DestinationMode
  source: BrowserStore
  /** What is sent, for the title (`"notes.md"`, `3 files`, `folder "Drafts"`). */
  subject: string
  /** The folder the items share in the source store (disabled for a move there), or null. */
  currentFolder: string | null
  working: boolean
  onClose: () => void
  onSubmit: (destination: DocumentDestination) => void | Promise<void>
}

const NOTES: Record<DestinationMode, string> = {
  move: 'Choose a store and a folder. A file of the same name already there stops the move.',
  copy: 'Choose a store and a folder. The copy is independent of the original.',
  link: 'A hard link is the same file in two places: an edit through either reaches both.',
}

export function DocumentDestinationDialog({
  isOpen,
  mode,
  source,
  subject,
  currentFolder,
  working,
  onClose,
  onSubmit,
}: DocumentDestinationDialogProps) {
  const queryClient = useQueryClient()
  const stores = useStoreCatalogue(isOpen)
  const [chosen, setChosen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const eligible = useMemo(
    () =>
      (stores.data ?? []).filter((s) =>
        mode === 'link' ? canLinkBetween(source, s) : s.enabled !== false && capabilitiesOf(s).canMoveIn,
      ),
    [stores.data, mode, source],
  )
  const destId = chosen && eligible.some((s) => s.id === chosen) ? chosen : (eligible.find((s) => s.id === source.id)?.id ?? eligible[0]?.id ?? '')

  const listing = useQuery({
    queryKey: queryKeys.mountPoints.files(destId),
    queryFn: ({ signal }) => fetchDocumentListing(destId, signal),
    enabled: isOpen && destId !== '',
  })
  const folders = useMemo(
    () => [...(listing.data?.folders ?? [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map((path) => ({ path })),
    [listing.data],
  )

  const createFolder = async (path: string): Promise<{ path: string }> => {
    setCreating(true)
    try {
      await apiFetch(`/api/v1/mount-points/${encodeURIComponent(destId)}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.store(destId) })
      return { path }
    } finally {
      setCreating(false)
    }
  }

  const container = (
    <div className="mb-3">
      <label htmlFor="document-destination-store" className="qt-label block mb-1">
        Store
      </label>
      <select
        id="document-destination-store"
        className="qt-select w-full"
        value={destId}
        onChange={(e) => setChosen(e.target.value)}
        disabled={working || stores.isLoading}
      >
        {eligible.length === 0 && <option value="">{stores.isLoading ? 'Loading stores…' : 'No store can take this'}</option>}
        {eligible.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.id === source.id ? ' (this store)' : ''}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <DestinationPickerDialog
      isOpen={isOpen}
      mode={mode}
      subject={subject}
      container={container}
      containerKey={destId}
      folders={destId ? folders : []}
      loading={listing.isLoading}
      rootLabel="Top of the store"
      onCreateFolder={createFolder}
      creating={creating}
      currentFolder={destId === source.id ? currentFolder : null}
      working={working}
      note={NOTES[mode]}
      onClose={onClose}
      onSubmit={(folder) => (destId ? onSubmit({ mountPointId: destId, folder }) : undefined)}
    />
  )
}
