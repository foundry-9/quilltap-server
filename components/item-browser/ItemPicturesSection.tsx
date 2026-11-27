'use client'

/**
 * The Pictures section of an Inventory object's or an Atlas entry's editor:
 * upload, generate, choose the current one, delete, and view full screen in
 * `ItemImageViewer` (Previous / Next walk the pictures).
 *
 * Everything that differs between the kinds — the images query, the images
 * route, the request helper, the queries to refresh, the refusal wording and
 * the copy — is the kind's {@link ItemPicturesSpec}, declared beside its
 * editor. The wardrobe keeps its own, richer section
 * (`WardrobeItemImageSection`: profile picker, history captions, checks).
 *
 * @module components/item-browser/ItemPicturesSection
 */

import { useState, type ReactNode } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { showErrorToast } from '@/lib/toast'
import type { ItemImageSummary } from '@/lib/mount-index/item-family-images'
import type { WardrobeContainer } from '@/lib/wardrobe/wardrobe-container'
import { ItemImageViewer } from './ItemImageViewer'

/** What one kind's pictures section reads, writes and says. */
export interface ItemPicturesSpec {
  kind: 'inventory' | 'atlas'
  /** The item's pictures (a stable hook per kind). */
  useImages: (
    container: WardrobeContainer | null,
    itemId: string | null,
  ) => { images: ItemImageSummary[]; current: string | null; loading: boolean }
  /** The kind's images route, with an `?action=`. */
  imagesUrl: (container: WardrobeContainer, itemId: string, action: string) => string
  /** The kind's JSON request helper; throws the kind's request error on refusal. */
  request: (url: string, method: string, body?: unknown) => Promise<unknown>
  /** The queries a picture change refreshes. */
  refreshKeys: (itemId: string) => QueryKey[]
  describeError: (error: unknown, fallback: string) => string
  /** The Generate button's label while a picture is drawn. */
  generatingLabel: string
  /** Shown when the item has no picture. */
  emptyText: ReactNode
  /** Shown when the pictures are inherited (an Inventory instance's archetype's). */
  inheritedNote?: ReactNode
  /** The accessible name of a thumbnail's view button. */
  viewLabel: (index: number, itemTitle: string) => string
  /** The upload input's accessible name, when it has one. */
  uploadLabel?: (itemTitle: string) => string
  /** Give the heading an id and name the section by it. */
  headingIdPrefix?: string
  /** Caption the current picture "Current picture" in the viewer. */
  noteCurrent?: boolean
}

export interface ItemPicturesSectionProps {
  spec: ItemPicturesSpec
  container: WardrobeContainer
  itemId: string
  itemTitle: string
}

export function ItemPicturesSection({ spec, container, itemId, itemTitle }: ItemPicturesSectionProps) {
  const queryClient = useQueryClient()
  const { images, current, loading } = spec.useImages(container, itemId)
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const refresh = () => Promise.all(spec.refreshKeys(itemId).map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
      await refresh()
    } catch (error) {
      showErrorToast(spec.describeError(error, 'The picture would not oblige'))
    } finally {
      setBusy(null)
    }
  }
  const upload = (file: File) =>
    run('upload', async () => {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch(spec.imagesUrl(container, itemId, 'upload'), { method: 'POST', body: form })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload failed')
    })
  const imageAction = (label: string, action: string, body: Record<string, unknown>) =>
    void run(label, () => spec.request(spec.imagesUrl(container, itemId, action), 'POST', body))
  const inherited = images.some((image) => image.inherited)
  const headingId = spec.headingIdPrefix ? `${spec.headingIdPrefix}-${itemId}` : undefined

  return (
    <section className="space-y-2 border-t qt-border-default pt-3" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm qt-text">Pictures</h3>
        <div className="flex items-center gap-2">
          <label className="qt-button-ghost qt-button-sm cursor-pointer">
            Upload…
            <input
              type="file"
              accept="image/*"
              className="hidden"
              aria-label={spec.uploadLabel?.(itemTitle)}
              onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
            />
          </label>
          <button
            type="button"
            className="qt-button-secondary qt-button-sm"
            disabled={busy !== null}
            onClick={() => imageAction('generate', 'generate', {})}
          >
            {busy === 'generate' ? spec.generatingLabel : 'Generate'}
          </button>
        </div>
      </div>
      {inherited && spec.inheritedNote && <p className="qt-text-xs qt-text-secondary">{spec.inheritedNote}</p>}
      {loading ? (
        <div className="qt-text-xs qt-text-secondary">Loading pictures…</div>
      ) : images.length === 0 ? (
        <div className="qt-text-xs qt-text-secondary">{spec.emptyText}</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li key={image.fileId} className="flex flex-col items-center gap-1">
              <button type="button" onClick={() => setViewing(index)} aria-label={spec.viewLabel(index, itemTitle)}>
                <img
                  src={image.thumbnailUrl}
                  alt=""
                  className={`w-20 h-20 rounded object-cover border ${image.fileId === current ? 'qt-border-primary' : 'qt-border-default'}`}
                />
              </button>
              {!image.inherited && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="qt-button-ghost qt-button-sm"
                    disabled={image.fileId === current || busy !== null}
                    onClick={() => imageAction('current', 'set-current', { fileId: image.fileId })}
                  >
                    {image.fileId === current ? 'Current' : 'Use'}
                  </button>
                  <button
                    type="button"
                    className="qt-button-ghost qt-button-sm qt-text-destructive"
                    disabled={busy !== null}
                    onClick={() => imageAction('delete', 'delete-image', { fileId: image.fileId })}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {viewing !== null && images[viewing] && (
        <ItemImageViewer
          kind={spec.kind}
          onClose={() => setViewing(null)}
          itemId={itemId}
          itemTitle={itemTitle}
          container={container}
          fileId={images[viewing].fileId}
          note={spec.noteCurrent ? (images[viewing].fileId === current ? 'Current picture' : null) : undefined}
          onPrev={images.length > 1 ? () => setViewing((viewing - 1 + images.length) % images.length) : undefined}
          onNext={images.length > 1 ? () => setViewing((viewing + 1) % images.length) : undefined}
        />
      )}
    </section>
  )
}
