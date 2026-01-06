'use client'

/**
 * FilePreviewText Component
 *
 * Renders a text file in the preview modal with syntax highlighting hints.
 */

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { FileInfo } from '../types'

interface FilePreviewTextProps {
  /** The file being previewed */
  file: FileInfo
  /** The text content to display */
  content: string | null
  /** Whether content is loading */
  isLoading: boolean
  /** Error message if loading failed */
  error: string | null
}

/**
 * Get a language hint from MIME type for styling
 */
function getLanguageHint(mimeType: string): string {
  if (mimeType.includes('json')) return 'json'
  if (mimeType.includes('javascript')) return 'javascript'
  if (mimeType.includes('typescript')) return 'typescript'
  if (mimeType.includes('html')) return 'html'
  if (mimeType.includes('css')) return 'css'
  if (mimeType.includes('xml')) return 'xml'
  if (mimeType.includes('markdown')) return 'markdown'
  if (mimeType.includes('yaml')) return 'yaml'
  return 'text'
}

export default function FilePreviewText({
  file,
  content,
  isLoading,
  error,
}: Readonly<FilePreviewTextProps>) {
  const languageHint = getLanguageHint(file.mimeType)

  useEffect(() => {
    clientLogger.debug('[FilePreviewText] Rendering text', {
      fileId: file.id,
      languageHint,
      contentLength: content?.length,
    })
  }, [file.id, languageHint, content?.length])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[300px]">
        <div className="animate-pulse text-muted-foreground">Loading file...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full min-h-[300px] text-center text-muted-foreground">
        <div className="text-4xl mb-2">{'\u{1F4C3}'}</div>
        <p>{error}</p>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full min-h-[300px] text-center text-muted-foreground">
        <div className="text-4xl mb-2">{'\u{1F4C3}'}</div>
        <p>No content available</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full max-h-[70vh] overflow-auto">
      <pre className="p-4 bg-muted rounded-lg text-sm font-mono whitespace-pre-wrap break-all">
        <code data-language={languageHint}>{content}</code>
      </pre>
    </div>
  )
}
