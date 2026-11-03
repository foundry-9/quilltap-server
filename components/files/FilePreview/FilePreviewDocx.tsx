'use client'

/**
 * FilePreviewDocx — a `.docx` shown read-only.
 *
 * The server renders the document to HTML with mammoth
 * (`?action=render-html`, which already neutralises link targets); the HTML
 * is sanitised again here with DOMPurify before it reaches the page, since
 * there is no DOM on the server to do it there. Formatting beyond what
 * mammoth maps (headings, emphasis, lists, tables, links, images) is not
 * reproduced — this is a reading copy, not an editor.
 */

import { useMemo } from 'react'
import DOMPurify from 'dompurify'

interface FilePreviewDocxProps {
  /** The rendered HTML, unsanitised; null while loading. */
  html: string | null
  isLoading: boolean
  error: string | null
}

/** Sanitise mammoth's HTML for display: no scripts, no handlers, only safe link targets. */
export function sanitizeDocxHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|data:image\/)/i,
  })
}

export default function FilePreviewDocx({ html, isLoading, error }: Readonly<FilePreviewDocxProps>) {
  const safe = useMemo(() => (html ? sanitizeDocxHtml(html) : ''), [html])

  if (isLoading) {
    return <div className="animate-pulse qt-text-secondary p-6">Unfolding the document…</div>
  }
  if (error) {
    return <div className="qt-text-destructive p-6">{error}</div>
  }
  return (
    <div className="w-full overflow-y-auto max-h-[70vh] p-4">
      <div className="qt-markdown" dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  )
}
