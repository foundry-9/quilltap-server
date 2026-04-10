'use client'

import { RoleplayTemplate } from './types'
import { SettingsCard, SettingsCardBadge, SettingsCardAction } from '@/components/ui/SettingsCard'

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

/**
 * Card component for displaying a single roleplay template
 * Uses SettingsCard for consistent styling
 */
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
  // Build badges array
  const badges: SettingsCardBadge[] = []
  if (isBuiltIn) {
    badges.push({ text: 'Built-in', variant: 'info' })
  }

  // Build actions array
  const actions: SettingsCardAction[] = [
    { label: 'Preview', onClick: () => onPreview(template), variant: 'secondary' },
  ]

  if (onCopyAsNew) {
    actions.push({ label: 'Copy as New', onClick: () => onCopyAsNew(template), variant: 'secondary' })
  }

  if (onEdit) {
    actions.push({ label: 'Edit', onClick: () => onEdit(template), variant: 'secondary' })
  }

  // Delete config using popover pattern for consistency
  const deleteConfig = onDelete ? {
    isConfirming: deleteConfirm === template.id,
    onConfirmChange: (confirming: boolean) => {
      if (confirming) {
        onDelete(template.id)
      } else {
        onCancelDelete?.()
      }
    },
    onConfirm: () => onConfirmDelete?.(template.id),
    message: 'Are you sure you want to delete this template?',
    isDeleting: saving,
  } : undefined

  return (
    <SettingsCard
      title={template.name}
      subtitle={template.description || undefined}
      badges={badges}
      actions={actions}
      actionsPosition="footer"
      deleteConfig={deleteConfig}
    />
  )
}
