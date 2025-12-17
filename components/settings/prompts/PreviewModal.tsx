'use client'

import { PromptTemplate } from './types'
import ReactMarkdown from 'react-markdown'

interface PreviewModalProps {
  template: PromptTemplate | null
  copiedId: string | null
  onClose: () => void
  onCopy: (template: PromptTemplate) => void
  onCopyAsNew: (template: PromptTemplate) => void
}

/**
 * Modal component for previewing a prompt template
 */
export function PreviewModal({
  template,
  copiedId,
  onClose,
  onCopy,
  onCopyAsNew,
}: PreviewModalProps) {
  if (!template) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">{template.name}</h2>
              {template.description && (
                <p className="qt-text-small mt-1">{template.description}</p>
              )}
              {(template.category || template.modelHint) && (
                <div className="flex gap-2 mt-2">
                  {template.category && (
                    <span className="px-2 py-0.5 qt-text-xs bg-muted rounded">
                      {template.category}
                    </span>
                  )}
                  {template.modelHint && (
                    <span className="px-2 py-0.5 qt-text-xs bg-muted rounded">
                      {template.modelHint}
                    </span>
                  )}
                </div>
              )}
            </div>
            {template.isBuiltIn && (
              <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                Sample
              </span>
            )}
          </div>

          <div className="border border-border rounded-lg p-4 bg-muted/30 prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{template.content}</ReactMarkdown>
          </div>

          <div className="flex justify-end gap-3 mt-6 flex-wrap">
            <button
              type="button"
              onClick={() => onCopy(template)}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
            >
              {copiedId === template.id ? 'Copied!' : 'Copy to Clipboard'}
            </button>
            {template.isBuiltIn && (
              <button
                type="button"
                onClick={() => {
                  onCopyAsNew(template)
                  onClose()
                }}
                className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
              >
                Copy as New
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
