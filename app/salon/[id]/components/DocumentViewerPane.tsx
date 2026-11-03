'use client'

/**
 * DocumentViewerPane — an open document Document Mode only views: an image,
 * a PDF, a `.docx`, any other store file that is not text. The header
 * matches the editor's (badge, title, close), a ribbon says it is read-only,
 * and the body is the Scriptorium's `DocumentViewer`, which reads the bytes
 * from the store itself. Nothing here writes, so nothing autosaves.
 *
 * @module app/salon/[id]/components/DocumentViewerPane
 */

import { Icon } from '@/components/ui/icon'
import { DocumentViewer, downloadDocument } from '@/components/document-browser/DocumentViewer'
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions'

interface DocumentViewerPaneProps {
  displayTitle: string
  viewer: DocumentViewTarget
  onCloseDocument: () => void
}

export function DocumentViewerPane({ displayTitle, viewer, onCloseDocument }: DocumentViewerPaneProps) {
  const entry = {
    id: `${viewer.mountPointId}:${viewer.relativePath}`,
    mountPointId: viewer.mountPointId,
    relativePath: viewer.relativePath,
    fileName: viewer.fileName,
    fileType: viewer.fileType as never,
    fileSizeBytes: viewer.fileSizeBytes,
    originalMimeType: viewer.originalMimeType,
    description: '',
    createdAt: viewer.updatedAt,
    updatedAt: viewer.updatedAt,
  }

  return (
    <div className="flex flex-col h-full" data-testid="document-viewer-pane">
      <div className="qt-doc-header">
        <span className="qt-doc-badge">Document</span>
        <span className="qt-doc-title" title={viewer.relativePath}>
          {displayTitle}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={() => void downloadDocument(entry)}
            title="Download"
            aria-label="Download document"
          >
            <Icon name="download" className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="qt-doc-header-button"
            onClick={onCloseDocument}
            title="Close document"
            aria-label="Close document"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="qt-doc-uri-row" role="note">
        <span className="qt-doc-uri-label">Read-only</span>
        <span className="qt-doc-uri-value">View only — this kind of file cannot be edited here.</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto relative">
        <DocumentViewer key={entry.id} entry={entry} />
      </div>
    </div>
  )
}
