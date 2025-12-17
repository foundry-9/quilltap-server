'use client'

import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface CapabilitiesReportDialogProps {
  isOpen: boolean
  onClose: () => void
  reportId: string
  filename: string
  content: string
}

export function CapabilitiesReportDialog({
  isOpen,
  onClose,
  reportId,
  filename,
  content,
}: CapabilitiesReportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      // Prevent body scroll when dialog is open
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <button
        className="qt-dialog-overlay !p-0 cursor-default border-none z-40"
        onClick={onClose}
        aria-label="Close dialog"
        type="button"
      />

      {/* Dialog Container */}
      <div className="fixed inset-4 md:inset-8 lg:inset-12 z-50 pointer-events-auto flex items-center justify-center">
        <div
          ref={dialogRef}
          className="qt-dialog w-full h-full max-w-6xl flex flex-col"
        >
          {/* Header */}
          <div className="qt-dialog-header flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="qt-dialog-title text-xl font-semibold">
                {filename}
              </h2>
              <button
                onClick={onClose}
                className="p-1 hover:bg-muted rounded transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <p className="qt-dialog-description qt-text-small">
              Capabilities Report
            </p>
          </div>

          {/* Body - Scrollable */}
          <div className="qt-dialog-body flex-1 overflow-y-auto min-h-0">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Custom table styling
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-4">
                      <table className="min-w-full border-collapse border border-border">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-muted">{children}</thead>
                  ),
                  th: ({ children }) => (
                    <th className="border border-border px-3 py-2 text-left font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-border px-3 py-2">
                      {children}
                    </td>
                  ),
                  // Custom heading styling
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold mt-6 mb-4 pb-2 border-b border-border">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-semibold mt-6 mb-3 pb-1 border-b border-border">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-lg font-semibold mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-base font-semibold mt-3 mb-2">
                      {children}
                    </h4>
                  ),
                  // List styling
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside my-2 space-y-1">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => (
                    <li className="ml-2">{children}</li>
                  ),
                  // Code styling
                  code: ({ children, className }) => {
                    const isInline = !className
                    if (isInline) {
                      return (
                        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                          {children}
                        </code>
                      )
                    }
                    return (
                      <code className={className}>{children}</code>
                    )
                  },
                  // Paragraph styling
                  p: ({ children }) => (
                    <p className="my-2 leading-relaxed">{children}</p>
                  ),
                  // Strong styling
                  strong: ({ children }) => (
                    <strong className="font-semibold">{children}</strong>
                  ),
                  // Emphasis styling
                  em: ({ children }) => (
                    <em className="italic qt-text-small">{children}</em>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>

          {/* Footer */}
          <div className="qt-dialog-footer flex-shrink-0 flex justify-end gap-3">
            <a
              href={`/api/tools/capabilities-report/${reportId}?download=true`}
              download={filename}
              className="qt-button qt-button-secondary flex items-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download
            </a>
            <button onClick={onClose} className="qt-button qt-button-primary">
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
