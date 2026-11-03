/**
 * Which viewer a file opens in, stated once for every browser and preview
 * surface: `image`, `pdf`, `docx` (rendered read-only to HTML), `markdown`,
 * `text`, or `unsupported` (metadata and a download). `getPreviewType`
 * (`components/files/FilePreview/types.ts`) is a caller.
 *
 * A file is judged by its MIME type when one is known, then by its stored
 * file type, then by its extension — document-store rows often carry no MIME
 * type at all, so the extension has to be enough.
 *
 * Client-safe: pure.
 *
 * @module lib/folder-browser/preview-kind
 */

export type PreviewKind = 'image' | 'pdf' | 'docx' | 'markdown' | 'text' | 'unsupported'

export interface PreviewSubject {
  /** A file name or path; its extension is the last resort. */
  name?: string | null
  mimeType?: string | null
  /** A document store's stored type (`markdown`, `txt`, `pdf`, `docx`, `blob`, …). */
  fileType?: string | null
  /** Text detection said it reads as plain text. */
  isPlainText?: boolean
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const TEXT_MIMES = new Set([
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/x-ndjson',
  'application/yaml',
])

const EXTENSION_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  docx: DOCX_MIME,
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
}

const FILE_TYPE_KINDS: Record<string, PreviewKind> = {
  markdown: 'markdown',
  txt: 'text',
  json: 'text',
  jsonl: 'text',
  pdf: 'pdf',
  docx: 'docx',
}

function extensionOf(name: string | null | undefined): string {
  const base = (name ?? '').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** A MIME type for a file name, from its extension; `application/octet-stream` when unknown. */
export function mimeTypeForName(name: string | null | undefined): string {
  return EXTENSION_MIMES[extensionOf(name)] ?? 'application/octet-stream'
}

function kindOfMime(mime: string): PreviewKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === DOCX_MIME) return 'docx'
  if (mime.includes('markdown')) return 'markdown'
  if (mime.startsWith('text/') || TEXT_MIMES.has(mime)) return 'text'
  return null
}

/** The viewer a file opens in. */
export function previewKindOf(subject: PreviewSubject): PreviewKind {
  const mime = (subject.mimeType ?? '').toLowerCase()
  const byMime = mime && mime !== 'application/octet-stream' ? kindOfMime(mime) : null
  if (byMime) return byMime
  const byFileType = subject.fileType ? FILE_TYPE_KINDS[subject.fileType] : undefined
  if (byFileType) return byFileType
  const byExtension = kindOfMime(mimeTypeForName(subject.name))
  if (byExtension) return byExtension
  return subject.isPlainText ? 'text' : 'unsupported'
}
