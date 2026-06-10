'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@/components/ui/icon'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

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
  const { copied, copy } = useCopyToClipboard()

  useEscapeKey(onClose)

  const handleCopy = () => copy(prompt)

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
          <h3 className="qt-heading-4">
            Generated Prompt{characterName ? ` for ${characterName}` : ''}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 qt-label text-foreground qt-shadow-sm hover:qt-bg-muted"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Icon name="check" className="w-4 h-4 qt-text-success" />
                  Copied
                </>
              ) : (
                <>
                  <Icon name="copy" className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border qt-border-default qt-bg-card px-3 py-1.5 qt-label text-foreground qt-shadow-sm hover:qt-bg-muted"
              title="Download as Markdown file"
            >
              <Icon name="download" className="w-4 h-4" />
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
