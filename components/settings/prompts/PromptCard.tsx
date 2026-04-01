'use client'

import { PromptTemplate } from './types'
import { SettingsCard, SettingsCardBadge, SettingsCardAction } from '@/components/ui/SettingsCard'

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
 * Uses SettingsCard for consistent styling
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
  // Build badges array
  const badges: SettingsCardBadge[] = []
  if (isBuiltIn) {
    badges.push({ text: 'Sample', variant: 'info' })
  }

  // Build actions array
  const actions: SettingsCardAction[] = [
    { label: 'Preview', onClick: () => onPreview(template), variant: 'secondary' },
    { label: isCopied ? 'Copied!' : 'Copy', onClick: () => onCopy(template), variant: 'secondary' },
    { label: 'Copy as New', onClick: () => onCopyAsNew(template), variant: 'secondary' },
  ]

  if (onEdit && !isBuiltIn) {
    actions.push({ label: 'Edit', onClick: () => onEdit(template), variant: 'secondary' })
  }

  // Delete config (only for non-built-in templates)
  const deleteConfig = onDelete && !isBuiltIn ? {
    isConfirming: deleteConfirmId === template.id,
    onConfirmChange: (confirming: boolean) => onDeleteConfirmToggle?.(confirming ? template.id : null),
    onConfirm: () => onDelete(template.id),
    message: 'Are you sure you want to delete this template?',
    isDeleting,
  } : undefined

  return (
    <SettingsCard
      title={template.name}
      subtitle={template.description || undefined}
      badges={badges}
      actions={actions}
      actionsPosition="footer"
      deleteConfig={deleteConfig}
    >
      {/* Category and model hint badges */}
      {(template.category || template.modelHint) && (
        <div className="flex gap-2 flex-wrap">
          {template.category && (
            <span className="qt-badge-secondary">{template.category}</span>
          )}
          {template.modelHint && (
            <span className="qt-badge-secondary">{template.modelHint}</span>
          )}
        </div>
      )}
    </SettingsCard>
  )
}
