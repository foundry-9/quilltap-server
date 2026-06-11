'use client'

/**
 * Heavy-costume React wrapper around SVAR's <Filemanager>.
 *
 * Owns the data lifecycle (load the mount listing → SVAR tree, reload on
 * mutation) and capability gating; delegates every server round-trip to
 * `wireSvarAdapter`. This is the only adapter file besides `svar-types.ts` that
 * pulls in the SVAR *runtime* (the component + <Willow> theme wrapper) — the
 * quarantine boundary the plan requires.
 *
 * Reload model (v1): after any mutating op the adapter calls `onReloadNeeded`;
 * we re-fetch the listing and remount the component with fresh data. That is
 * correct (reconciles new ids on success, reverts on failure) but collapses
 * tree expansion — preserving expansion via SVAR id-reconciliation is a tracked
 * follow-up, not a correctness gap.
 *
 * @module components/files/svar/SvarFileManager
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Filemanager, Willow } from '@svar-ui/react-filemanager'
import '@svar-ui/react-filemanager/all.css'
// Quilltap theme bridge — MUST import after SVAR's CSS (both unlayered; the
// bridge wins by source order + a :root specificity bump). See the file header.
import './svar-theme-bridge.css'
import type { MountCapabilities } from '@/lib/mount-index/capabilities'
import type { IApi, IEntity, IParsedEntity } from './svar-types'
import { wireSvarAdapter, loadMountTree } from './createSvarAdapter'
import { encodeRelPath, extOf, nodeIdToRelPath } from './node-id'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'])

export interface SvarFileManagerProps {
  mountId: string
  capabilities: MountCapabilities
}

export function SvarFileManager({ mountId, capabilities }: SvarFileManagerProps) {
  const [data, setData] = useState<IEntity[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const apiRef = useRef<IApi | null>(null)

  const reload = useCallback(async () => {
    try {
      const tree = await loadMountTree(mountId)
      setData(tree)
      // Remount the component so SVAR rebinds to the fresh, server-authoritative
      // tree (and any optimistic temp ids are reconciled to real paths).
      setReloadKey((k) => k + 1)
    } catch {
      setError('I couldn’t read that repository just now. Do try again.')
    }
  }, [mountId])

  // Initial load — inline (state is set after the await, in an async callback) so
  // there's no synchronous setState in the effect body. No remount key bump here:
  // there is no live SVAR instance to rebind on the first render. Mutations use
  // `reload` (above), which does bump the key.
  useEffect(() => {
    let live = true
    loadMountTree(mountId)
      .then((tree) => { if (live) setData(tree) })
      .catch(() => { if (live) setError('I couldn’t read that repository just now. Do try again.') })
    return () => { live = false }
  }, [mountId])

  const init = useCallback(
    (api: IApi) => {
      apiRef.current = api
      wireSvarAdapter(
        api,
        { mountId, capabilities },
        {
          onError: (message) => setError(message),
          onReloadNeeded: () => void reload(),
          onIndexing: () => setError(null),
          log: (message, payload) => {
            if (process.env.NODE_ENV !== 'production') console.debug(message, payload)
          },
        }
      )
    },
    [mountId, capabilities, reload]
  )

  // Image thumbnails/preview straight from the byte-serving item route.
  const previews = useCallback(
    (file: Partial<IParsedEntity> & { type: string }): string | null => {
      if (!file.id || file.type !== 'file') return null
      const relativePath = nodeIdToRelPath(file.id)
      if (!IMAGE_EXTS.has(extOf(relativePath))) return null
      return `/api/v1/mount-points/${mountId}/files/${encodeRelPath(relativePath)}?raw=1`
    },
    [mountId]
  )

  if (data === null) {
    return <div className="qt-section-title p-6">Opening the repository…</div>
  }

  return (
    <Willow>
      {error && (
        <div className="qt-alert-warning mb-3 flex items-center justify-between gap-3 rounded-md p-3 text-sm">
          <span>{error}</span>
          <button className="qt-button-ghost" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <div style={{ height: '70vh' }}>
        <Filemanager
          key={reloadKey}
          data={data}
          readonly={!capabilities.canWrite}
          preview
          previews={previews}
          init={init}
        />
      </div>
    </Willow>
  )
}

export default SvarFileManager
