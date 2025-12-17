'use client'

import { RoleplayTemplate } from './types'

interface TemplateCardProps {
  template: RoleplayTemplate
  isBuiltIn?: boolean
  onPreview: (template: RoleplayTemplate) => void
  onEdit?: (template: RoleplayTemplate) => void
  onCopyAsNew?: (template: RoleplayTemplate) => void
  onDelete?: (templateId: string) => void
  deleteConfirm?: string | null
  onConfirmDelete?: (templateId: string) => void
  onCancelDelete?: () => void
  saving?: boolean
}

export function TemplateCard({
  template,
  isBuiltIn = false,
  onPreview,
  onEdit,
  onCopyAsNew,
  onDelete,
  deleteConfirm,
  onConfirmDelete,
  onCancelDelete,
  saving = false,
}: TemplateCardProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card shadow-sm">
      <div className={isBuiltIn ? 'flex items-start justify-between gap-2' : ''}>
        <div className="flex-1 min-w-0">
          <h3 className="qt-text-primary truncate">{template.name}</h3>
          {template.description && (
            <p className="qt-text-small mt-1 line-clamp-2">
              {template.description}
            </p>
          )}
        </div>
        {isBuiltIn && (
          <span className="px-2 py-0.5 qt-text-label-xs bg-primary/10 text-primary rounded">
            Built-in
          </span>
        )}
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        <button
          type="button"
          onClick={() => onPreview(template)}
          className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
        >
          Preview
        </button>

        {onCopyAsNew && (
          <button
            type="button"
            onClick={() => onCopyAsNew(template)}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
          >
            Copy as New
          </button>
        )}

        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(template)}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
          >
            Edit
          </button>
        )}

        {onDelete && deleteConfirm === template.id ? (
          <>
            <button
              type="button"
              onClick={() => onConfirmDelete?.(template.id)}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
            >
              Cancel
            </button>
          </>
        ) : (
          onDelete && (
            <button
              type="button"
              onClick={() => onDelete(template.id)}
              className="px-3 py-1.5 text-sm rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10"
            >
              Delete
            </button>
          )
        )}
      </div>
    </div>
  )
}
