'use client'

/**
 * Calliope's Atelier — the Images section (Spec F, Stage 1).
 *
 * A grid of the draft's pictures with their size and what uses each; add,
 * remove (an image something still uses is kept until it is let go), and
 * the choice of the preview image the theme list shows. Originals stay in
 * the draft; the install carries WebP (Spec D decision 11).
 *
 * @module components/theme-editor/assets/ImagesSection
 */

import { useState } from 'react'
import { themeDraftAction, themeDraftUpload, type DraftDetail } from '../use-theme-drafts'
import { useDraftOperations } from './use-draft-operations'
import { IMAGE_ACCEPT, formatBytes, imageUrl, normalisePath, pictureFiles } from './model'
import { ConfirmRemoveDialog, FileChooser } from './shared'

type Upload = { draft: DraftDetail; path?: string }

export function ImagesSection({ detail }: { detail: DraftDetail }) {
  const ops = useDraftOperations()
  const [removing, setRemoving] = useState<string | null>(null)
  const pictures = pictureFiles(detail.files)
  const previewImage = typeof detail.manifest?.previewImage === 'string' ? normalisePath(detail.manifest.previewImage) : null

  const add = async (files: File[]) => {
    for (const file of files) {
      const result = await ops.run((manifestRevision, id) => themeDraftUpload<Upload>(id, 'add-image', file, { manifestRevision }))
      if (!result.ok) return
    }
  }

  const setPreviewImage = (path: string | null) =>
    ops.run((manifestRevision, id) => themeDraftAction(id, 'set-manifest', { manifestRevision, fields: { previewImage: path } }))

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <FileChooser label="Add images" accept={IMAGE_ACCEPT} multiple disabled={ops.busy} onFiles={(files) => void add(files)} />
        <span className="qt-text-xs qt-text-secondary">
          The draft keeps each picture as you gave it; the installed theme carries it as WebP, which is lighter to wear.
        </span>
      </div>
      {pictures.length === 0 ? (
        <p className="qt-text-small qt-text-muted">No pictures yet. Add one, then name it in an image token (a page background, say).</p>
      ) : (
        <ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]" aria-label="Images in this draft">
          {pictures.map((file) => {
            const url = imageUrl(detail, file.path)
            const isPreview = previewImage === file.path
            const usedBy = file.usedBy.filter((_, i) => file.users[i]?.kind !== 'preview-image')
            return (
              <li key={file.path} className="qt-card p-2 space-y-1 flex flex-col">
                <div className="aspect-video qt-bg-muted rounded overflow-hidden flex items-center justify-center">
                  {url ? <img src={url} alt="" className="max-w-full max-h-full object-contain" /> : <span className="qt-text-xs qt-text-muted">No preview</span>}
                </div>
                <p className="font-mono qt-text-xs break-all">{file.path}</p>
                <p className="qt-text-xs qt-text-secondary">{formatBytes(file.size)}</p>
                <p className="qt-text-xs">
                  {file.unused ? (
                    <span className="qt-badge-warning">Unused</span>
                  ) : usedBy.length > 0 ? (
                    <>In use by {usedBy.join('; ')}</>
                  ) : null}
                  {isPreview && <span className="qt-badge-primary ml-1">Preview image</span>}
                </p>
                <div className="flex gap-1 flex-wrap mt-auto">
                  <button
                    type="button"
                    className="qt-button qt-button-ghost qt-button-sm"
                    disabled={ops.busy}
                    aria-pressed={isPreview}
                    onClick={() => void setPreviewImage(isPreview ? null : file.path)}
                    aria-label={isPreview ? `Stop using ${file.path} as the preview image` : `Use ${file.path} as the preview image`}
                  >
                    {isPreview ? 'Not the preview' : 'Make it the preview'}
                  </button>
                  <button
                    type="button"
                    className="qt-button qt-button-ghost qt-button-sm"
                    disabled={ops.busy || !file.unused}
                    title={file.unused ? undefined : 'Something still uses this picture; let it go first.'}
                    onClick={() => setRemoving(file.path)}
                    aria-label={`Remove ${file.path}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmRemoveDialog
        subject={removing}
        title="Remove this picture?"
        body={removing && <p>{removing} leaves the draft for good.</p>}
        onConfirm={async () => {
          if (!removing) return false
          const path = removing
          const result = await ops.run((manifestRevision, id) => themeDraftAction(id, 'remove-file', { manifestRevision, path }))
          return result.ok
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  )
}
