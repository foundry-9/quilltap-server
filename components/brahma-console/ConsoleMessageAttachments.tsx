'use client'

/**
 * ConsoleMessageAttachments
 *
 * The attachments on an operator's Console message: image thumbnails that
 * open the standard full-screen viewer, and name chips for other files that
 * open the stored file. A file that is gone shows as a struck-through chip.
 * Bytes are served by the existing mount-point blob route.
 *
 * @module components/brahma-console/ConsoleMessageAttachments
 */

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { FullScreenImageViewer } from '@/components/images/FullScreenImageViewer'

/** One attachment as the messages route resolves it. */
export interface ConsoleAttachmentView {
  id: string
  filename: string
  mimeType: string
  isImage: boolean
  path: string | null
  mountPointId: string | null
  missing: boolean
}

function blobUrl(a: ConsoleAttachmentView): string | null {
  if (!a.mountPointId || !a.path) return null
  return `/api/v1/mount-points/${encodeURIComponent(a.mountPointId)}/blobs/${a.path.split('/').map(encodeURIComponent).join('/')}`
}

export function ConsoleMessageAttachments({ attachments }: { attachments: ConsoleAttachmentView[] }) {
  const [viewing, setViewing] = useState<ConsoleAttachmentView | null>(null)
  if (attachments.length === 0) return null

  return (
    <>
      <ul className="qt-console-attachment-row qt-console-attachment-row-sent" aria-label="Attachments">
        {attachments.map(a => {
          const url = blobUrl(a)
          if (a.missing) {
            return (
              <li key={a.id} className="qt-console-attachment-chip qt-console-attachment-chip-missing" title="This file is no longer where it was left">
                <Icon name="file" className="w-4 h-4 shrink-0" />
                <s className="truncate">{a.filename}</s>
              </li>
            )
          }
          if (a.isImage && url) {
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className="qt-console-attachment-image"
                  onClick={() => setViewing(a)}
                  aria-label={`View ${a.filename}`}
                >
                  <img src={url} alt="" loading="lazy" />
                </button>
              </li>
            )
          }
          return (
            <li key={a.id} className="qt-console-attachment-chip">
              <Icon name="file" className="w-4 h-4 shrink-0" />
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="truncate" title={a.path ?? a.filename}>
                  {a.filename}
                </a>
              ) : (
                <span className="truncate">{a.filename}</span>
              )}
            </li>
          )
        })}
      </ul>
      {viewing && blobUrl(viewing) && (
        <FullScreenImageViewer
          isOpen
          onClose={() => setViewing(null)}
          src={blobUrl(viewing) as string}
          alt={viewing.filename}
          imageId={viewing.id}
          filename={viewing.filename}
          onMissingCleanup={async () => { /* the transcript shows it as missing */ }}
          caption={viewing.filename}
          zIndexClassName="qt-console-modal-layer"
        />
      )}
    </>
  )
}
