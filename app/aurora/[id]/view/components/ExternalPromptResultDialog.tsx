'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ExternalPromptResultDialogProps {
  characterName: string | undefined
  prompt: string
  onClose: () => void
}

export function ExternalPromptResultDialog({
  characterName,
  prompt,
  onClose,
}: ExternalPromptResultDialogProps) {
  const [copied, setCopied] = useState(false)

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = prompt
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    const safeName = (characterName || 'character').replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
    const filename = `${safeName}-external-prompt.md`
    const blob = new Blob([prompt], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md md:max-w-3xl rounded-2xl border qt-border-default qt-bg-card p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h3 className="text-lg font-semibold">
            Generated Prompt{characterName ? ` for ${characterName}` : ''}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4 qt-text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 text-sm font-medium text-foreground qt-shadow-sm hover:qt-bg-muted"
              title="Download as Markdown file"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 pr-2 -mr-2 rounded-lg border qt-border-default bg-background/50 p-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {prompt}
            </ReactMarkdown>
          </div>
        </div>

        <div className="mt-4 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
