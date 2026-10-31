'use client'

/**
 * A document-store file shown read-only, in whichever viewer its kind takes
 * (`documentPreviewKind`): images and PDFs from the file's raw bytes,
 * Markdown and text from its UTF-8 read, a `.docx` from the server's HTML
 * rendering, anything else as metadata and a download.
 *
 * `DocumentViewer` is the body alone, so the Salon's Document pane can host
 * it; `DocumentViewerModal` puts it in a dialog with Download for the
 * Scriptorium browser.
 *
 * @module components/document-browser/DocumentViewer
 */

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { queryKeys } from '@/lib/query/keys'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { buildMountFileItemUrl, buildMountFileRawUrl } from '@/components/files/mountBlobUrl'
import { downloadFetchedFile } from '@/lib/download-utils'
import { showErrorToast } from '@/lib/toast'
import { mimeTypeForName } from '@/lib/folder-browser/preview-kind'
import { documentPreviewKind } from '@/lib/folder-browser/document-actions'
import type { FileInfo } from '@/components/files/types'
import type { DocMountBrowserEntry } from '@/lib/schemas/mount-index.types'
import FilePreviewImage from '@/components/files/FilePreview/FilePreviewImage'
import FilePreviewDocx from '@/components/files/FilePreview/FilePreviewDocx'
import FilePreviewFallback from '@/components/files/FilePreview/FilePreviewFallback'

// pdf.js and the Markdown stack are heavy; load each only when a file needs it.
const FilePreviewPdf = dynamic(() => import('@/components/files/FilePreview/FilePreviewPdf'), {
  ssr: false,
  loading: () => <div className="animate-pulse qt-text-secondary p-6">Loading PDF viewer…</div>,
})
const FilePreviewText = dynamic(() => import('@/components/files/FilePreview/FilePreviewText'), {
  ssr: false,
  loading: () => <div className="animate-pulse qt-text-secondary p-6">Opening the file…</div>,
})

export type ViewableEntry = Pick<
  DocMountBrowserEntry,
  'id' | 'mountPointId' | 'relativePath' | 'fileName' | 'fileType' | 'fileSizeBytes' | 'originalMimeType' | 'description' | 'createdAt' | 'updatedAt'
>

/** The shared preview components' file shape, for a store row. */
export function fileInfoOf(entry: ViewableEntry): FileInfo {
  return {
    id: entry.id,
    originalFilename: entry.fileName,
    filename: entry.fileName,
    mimeType: entry.originalMimeType || mimeTypeForName(entry.fileName),
    size: entry.fileSizeBytes,
    category: 'DOCUMENT',
    description: entry.description || null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    mountPointId: entry.mountPointId,
    relativePath: entry.relativePath,
  }
}

export function DocumentViewer({ entry }: { entry: ViewableEntry }) {
  const kind = documentPreviewKind(entry)
  const file = fileInfoOf(entry)
  const url = buildMountFileRawUrl(entry.mountPointId, entry.relativePath)

  const text = useQuery({
    queryKey: queryKeys.mountPoints.content(entry.mountPointId, entry.relativePath),
    queryFn: ({ signal }) =>
      apiFetch<{ content: string }>(
        // A text file stored as a blob reads as base64 by default; the viewer wants its text.
        `${buildMountFileItemUrl(entry.mountPointId, entry.relativePath)}?encoding=utf-8`,
        { signal },
      ).then(
        (r) => r.content,
      ),
    enabled: kind === 'markdown' || kind === 'text',
  })
  const rendered = useQuery({
    queryKey: queryKeys.mountPoints.rendered(entry.mountPointId, entry.relativePath),
    queryFn: ({ signal }) =>
      apiFetch<{ html: string }>(
        `${buildMountFileItemUrl(entry.mountPointId, entry.relativePath)}?action=render-html`,
        { signal },
      ).then((r) => r.html),
    enabled: kind === 'docx',
  })

  switch (kind) {
    case 'image':
      return <FilePreviewImage file={file} fileUrl={url} />
    case 'pdf':
      return <FilePreviewPdf file={file} fileUrl={url} />
    case 'docx':
      return (
        <FilePreviewDocx
          html={rendered.data ?? null}
          isLoading={rendered.isLoading}
          error={rendered.error ? apiErrorMessage(rendered.error, 'The document would not open') : null}
        />
      )
    case 'markdown':
    case 'text':
      return (
        <FilePreviewText
          file={file}
          content={text.data ?? null}
          isLoading={text.isLoading}
          error={text.error ? apiErrorMessage(text.error, 'The file would not open') : null}
        />
      )
    default:
      return <FilePreviewFallback file={file} fileUrl={url} />
  }
}

export async function downloadDocument(entry: Pick<ViewableEntry, 'mountPointId' | 'relativePath' | 'fileName'>) {
  try {
    await downloadFetchedFile(buildMountFileRawUrl(entry.mountPointId, entry.relativePath), entry.fileName)
  } catch (error) {
    showErrorToast(apiErrorMessage(error, 'The file would not download'))
  }
}

export function DocumentViewerModal({ entry, onClose }: { entry: ViewableEntry | null; onClose: () => void }) {
  return (
    <BaseModal
      isOpen={entry !== null}
      onClose={onClose}
      title={entry?.fileName ?? ''}
      maxWidth="4xl"
      footer={
        entry && (
          <div className="flex items-center justify-between gap-2">
            <span className="qt-text-xs qt-text-secondary truncate" title={entry.relativePath}>
              {entry.relativePath} · read-only
            </span>
            <div className="flex gap-2">
              <button type="button" className="qt-button-secondary qt-button-sm" onClick={() => void downloadDocument(entry)}>
                Download
              </button>
              <button type="button" className="qt-button-primary qt-button-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )
      }
    >
      {entry && <DocumentViewer key={entry.id} entry={entry} />}
    </BaseModal>
  )
}
