'use client'

import { PromptTemplate } from './types'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'

interface PromptCardProps {
  template: PromptTemplate
  isBuiltIn: boolean
  isCopied: boolean
  isDeleting: boolean
  onPreview: (template: PromptTemplate) => void
  onCopy: (template: PromptTemplate) => void
  onEdit?: (template: PromptTemplate) => void
  onCopyAsNew: (template: PromptTemplate) => void
  onDelete?: (templateId: string) => void
  deleteConfirmId?: string | null
  onDeleteConfirmToggle?: (templateId: string | null) => void
}

/**
 * Card component for displaying a single prompt template
 */
export function PromptCard({
  template,
  isBuiltIn,
  isCopied,
  isDeleting,
  onPreview,
  onCopy,
  onEdit,
  onCopyAsNew,
  onDelete,
  deleteConfirmId,
  onDeleteConfirmToggle,
}: PromptCardProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="qt-text-primary truncate">{template.name}</h3>
          {template.description && (
            <p className="qt-text-small mt-1 line-clamp-2">{template.description}</p>
          )}
        </div>
        {isBuiltIn && (
          <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded shrink-0">
            Sample
          </span>
        )}
      </div>

      {(template.category || template.modelHint) && (
        <div className="flex gap-2 mb-3 flex-wrap">
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

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onPreview(template)}
          className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => onCopy(template)}
          className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
        >
          {isCopied ? 'Copied!' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={() => onCopyAsNew(template)}
          className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
        >
          Copy as New
        </button>
        {onEdit && !isBuiltIn && (
          <button
            type="button"
            onClick={() => onEdit(template)}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
          >
            Edit
          </button>
        )}
        {onDelete && !isBuiltIn && (
          <div className="relative">
            <button
              type="button"
              onClick={() => onDeleteConfirmToggle?.(deleteConfirmId === template.id ? null : template.id)}
              className="px-3 py-1.5 text-sm rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10"
            >
              Delete
            </button>
            <DeleteConfirmPopover
              isOpen={deleteConfirmId === template.id}
              isDeleting={isDeleting}
              onCancel={() => onDeleteConfirmToggle?.(null)}
              onConfirm={() => onDelete(template.id)}
              message="Are you sure you want to delete this template?"
            />
          </div>
        )}
      </div>
    </div>
  )
}
