'use client'

/**
 * Calliope's Atelier — the Files panel (Spec F, Stage 1).
 *
 * Every file in the draft with its size and what uses it, the totals against
 * the bundle's limits, "remove" for each unused one, and a link to the
 * draft's folder in the Scriptorium. What uses what is the server's file
 * list (the engine's `bundleFileUsage`); nothing here re-derives it.
 *
 * @module components/theme-editor/assets/FilesPanel
 */

import { useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { useWorkspaceLink } from '@/components/workspace/useWorkspaceLink'
import { themeDraftAction, type DraftDetail } from '../use-theme-drafts'
import { useDraftOperations } from './use-draft-operations'
import { formatBytes } from '@/lib/utils/format-bytes'
import { ConfirmRemoveDialog } from './shared'

const KIND_LABELS: Record<DraftDetail['files'][number]['kind'], string> = {
  manifest: 'Manifest',
  tokens: 'Tokens',
  styles: 'Stylesheet',
  font: 'Font',
  licence: 'Licence',
  image: 'Image',
  other: 'Other',
}

/** A share of a limit, as a whole percentage. */
const percent = (n: number, of: number) => (of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0)

export function FilesPanel({ detail }: { detail: DraftDetail }) {
  const ops = useDraftOperations()
  const openIn = useWorkspaceLink()
  const [removing, setRemoving] = useState<string | null>(null)
  const { totals, files } = detail
  const href = `/scriptorium/${detail.mountPointId}`
  const tooLarge = files.filter((f) => f.size > totals.limits.fileBytes)
  const unusedCount = files.filter((f) => f.unused).length

  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="qt-text-small">
        {totals.files} of {totals.limits.files} files ({percent(totals.files, totals.limits.files)}%), {formatBytes(totals.bytes)} of{' '}
        {formatBytes(totals.limits.bytes)} ({percent(totals.bytes, totals.limits.bytes)}%). No one file may pass{' '}
        {formatBytes(totals.limits.fileBytes)}.
      </p>
      {tooLarge.length > 0 && (
        <p className="qt-alert-warning qt-text-small" role="status">
          {tooLarge.map((f) => f.path).join(', ')} {tooLarge.length === 1 ? 'is' : 'are'} past the one-file limit, and the install will refuse{' '}
          {tooLarge.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      {unusedCount > 0 && (
        <p className="qt-text-xs qt-text-secondary">
          A file marked unused stays in the draft but is left out when the theme is installed.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full qt-text-small">
          <caption className="sr-only">Files in this draft</caption>
          <thead>
            <tr className="text-left qt-text-xs qt-text-secondary">
              <th scope="col" className="py-1 pr-3 font-medium">File</th>
              <th scope="col" className="py-1 pr-3 font-medium">Kind</th>
              <th scope="col" className="py-1 pr-3 font-medium text-right">Size</th>
              <th scope="col" className="py-1 pr-3 font-medium">Used by</th>
              <th scope="col" className="py-1 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path} className="border-t qt-border-default align-top">
                <td className="py-1.5 pr-3 font-mono break-all">{file.path}</td>
                <td className="py-1.5 pr-3">{KIND_LABELS[file.kind]}</td>
                <td className={`py-1.5 pr-3 text-right whitespace-nowrap ${file.size > totals.limits.fileBytes ? 'qt-text-destructive' : ''}`}>
                  {file.size > totals.limits.fileBytes && (
                    <Icon name="alert-triangle" className="qt-icon-inline-note" />
                  )}
                  {formatBytes(file.size)}
                  {file.size > totals.limits.fileBytes && <span className="sr-only"> (over the per-file limit)</span>}
                </td>
                <td className="py-1.5 pr-3">
                  {file.unused ? (
                    <span className="qt-badge-warning">Unused</span>
                  ) : file.usedBy.length > 0 ? (
                    file.usedBy.join('; ')
                  ) : (
                    <span className="qt-text-muted">—</span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {file.unused && (
                    <button
                      type="button"
                      className="qt-button qt-button-ghost qt-button-sm"
                      disabled={ops.busy}
                      onClick={() => setRemoving(file.path)}
                      aria-label={`Remove ${file.path}`}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="qt-text-xs qt-text-secondary">
        The files live in the folder <span className="font-mono">Themes/{detail.id}/</span> of Quilltap General.{' '}
        <Link href={href} onClick={(e) => openIn(href, e)} className="qt-inline-link">
          Open Quilltap General in the Scriptorium
        </Link>
      </p>
      <ConfirmRemoveDialog
        subject={removing}
        title="Remove this file?"
        body={removing && <p>{removing} leaves the draft for good. Nothing in the theme uses it.</p>}
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
