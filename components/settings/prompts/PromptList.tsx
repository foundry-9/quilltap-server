'use client'

import { PromptTemplate } from './types'
import { PromptCard } from './PromptCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader } from '@/components/ui/SectionHeader'

interface PromptListProps {
  title: string
  description: string
  templates: PromptTemplate[]
  isBuiltIn: boolean
  copiedId: string | null
  deleteConfirmId?: string | null
  isDeleting: boolean
  onPreview: (template: PromptTemplate) => void
  onCopy: (template: PromptTemplate) => void
  onEdit?: (template: PromptTemplate) => void
  onCopyAsNew: (template: PromptTemplate) => void
  onDelete?: (templateId: string) => void
  onDeleteConfirmToggle: (templateId: string | null) => void
  emptyStateTitle: string
  emptyStateDescription?: string
  emptyStateAction?: {
    label: string
    onClick: () => void
  }
  headerAction?: {
    label: string
    onClick: () => void
  }
}

/**
 * List component for displaying prompt templates
 */
export function PromptList({
  title,
  description,
  templates,
  isBuiltIn,
  copiedId,
  deleteConfirmId,
  isDeleting,
  onPreview,
  onCopy,
  onEdit,
  onCopyAsNew,
  onDelete,
  onDeleteConfirmToggle,
  emptyStateTitle,
  emptyStateDescription,
  emptyStateAction,
  headerAction,
}: PromptListProps) {
  return (
    <section>
      <SectionHeader
        title={title}
        level="h2"
        action={headerAction}
      />
      <p className="qt-text-small mb-4">{description}</p>

      {templates.length === 0 ? (
        <EmptyState
          title={emptyStateTitle}
          description={emptyStateDescription}
          action={emptyStateAction}
          variant="dashed"
        />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {templates.map(template => (
            <PromptCard
              key={template.id}
              template={template}
              isBuiltIn={isBuiltIn}
              isCopied={copiedId === template.id}
              isDeleting={isDeleting}
              onPreview={onPreview}
              onCopy={onCopy}
              onEdit={onEdit}
              onCopyAsNew={onCopyAsNew}
              onDelete={onDelete}
              deleteConfirmId={deleteConfirmId}
              onDeleteConfirmToggle={onDeleteConfirmToggle}
            />
          ))}
        </div>
      )}
    </section>
  )
}
