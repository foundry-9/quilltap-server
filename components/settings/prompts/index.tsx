'use client'

import { useEffect, useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useFormState } from '@/hooks/useFormState'
import { PromptTemplate, INITIAL_FORM_DATA } from './types'
import { usePrompts } from './hooks/usePrompts'
import { PromptList } from './PromptList'
import { PromptModal } from './PromptModal'
import { PreviewModal } from './PreviewModal'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'

/**
 * Main prompts tab component for managing prompt templates
 */
export default function PromptsTab() {
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const form = useFormState(INITIAL_FORM_DATA)
  const prompts = usePrompts()

  // Fetch templates on mount
  useEffect(() => {
    prompts.fetchTemplates()
  }, [prompts])

  const openCreateModal = useCallback(() => {
    setEditingTemplate(null)
    form.resetForm()
    setShowPreview(false)
    setIsModalOpen(true)
  }, [form])

  const openEditModal = useCallback(
    (template: PromptTemplate) => {
      setEditingTemplate(template)
      form.setField('name', template.name)
      form.setField('description', template.description || '')
      form.setField('content', template.content)
      setShowPreview(false)
      setIsModalOpen(true)
    },
    [form]
  )

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingTemplate(null)
    form.resetForm()
    setShowPreview(false)
  }, [form])

  const handleSave = useCallback(async () => {
    const result = await prompts.saveTemplate(form.formData, editingTemplate?.id)
    if (result) {
      closeModal()
    }
  }, [prompts, form.formData, editingTemplate, closeModal])

  const handleCopyAsNew = useCallback(
    (template: PromptTemplate) => {
      clientLogger.debug('Copying template as new', { templateId: template.id })
      setEditingTemplate(null)
      form.setField('name', `${template.name} (Copy)`)
      form.setField('description', template.description || '')
      form.setField('content', template.content)
      setShowPreview(false)
      setIsModalOpen(true)
    },
    [form]
  )

  const handleDelete = useCallback(
    (templateId: string) => {
      prompts.deleteTemplate(templateId)
    },
    [prompts]
  )

  const builtInTemplates = prompts.templates.filter(t => t.isBuiltIn)
  const userTemplates = prompts.templates.filter(t => !t.isBuiltIn)

  if (prompts.fetchOp.loading) {
    return <LoadingState message="Loading templates..." />
  }

  return (
    <div className="space-y-6">
      {prompts.fetchOp.error && (
        <ErrorAlert
          message={prompts.fetchOp.error}
          onRetry={prompts.fetchTemplates}
        />
      )}

      {prompts.success && (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
          {prompts.success}
        </div>
      )}

      {prompts.saveOp.error && (
        <ErrorAlert
          message={prompts.saveOp.error}
          onRetry={() => {}}
        />
      )}

      {prompts.deleteOp.error && (
        <ErrorAlert
          message={prompts.deleteOp.error}
          onRetry={() => {}}
        />
      )}

      {/* Built-in templates list */}
      <PromptList
        title="Sample Prompts"
        description="These prompts are provided by Quilltap and cannot be modified. You can preview them or copy them to create your own version."
        templates={builtInTemplates}
        isBuiltIn={true}
        copiedId={prompts.copiedId}
        deleteConfirmId={prompts.deleteConfirm}
        isDeleting={prompts.deleteOp.loading}
        onPreview={setPreviewTemplate}
        onCopy={prompts.copyToClipboard}
        onCopyAsNew={handleCopyAsNew}
        onDelete={handleDelete}
        onDeleteConfirmToggle={prompts.setDeleteConfirm}
        emptyStateTitle="No sample prompts available"
      />

      {/* User templates list */}
      <PromptList
        title="My Prompts"
        description="Custom prompt templates you've created for reuse across characters and chats."
        templates={userTemplates}
        isBuiltIn={false}
        copiedId={prompts.copiedId}
        deleteConfirmId={prompts.deleteConfirm}
        isDeleting={prompts.deleteOp.loading}
        onPreview={setPreviewTemplate}
        onCopy={prompts.copyToClipboard}
        onEdit={openEditModal}
        onCopyAsNew={handleCopyAsNew}
        onDelete={handleDelete}
        onDeleteConfirmToggle={prompts.setDeleteConfirm}
        emptyStateTitle="No custom prompts yet"
        emptyStateDescription="Create one to build your own reusable prompt templates."
        emptyStateAction={{
          label: 'Create Prompt',
          onClick: openCreateModal,
        }}
        headerAction={{
          label: 'Create Prompt',
          onClick: openCreateModal,
        }}
      />

      {/* Create/Edit modal */}
      <PromptModal
        isOpen={isModalOpen}
        editingTemplate={editingTemplate}
        formData={form.formData}
        showPreview={showPreview}
        isSaving={prompts.saveOp.loading}
        onClose={closeModal}
        onSave={handleSave}
        onFormChange={form.handleChange}
        onPreviewToggle={() => setShowPreview(!showPreview)}
      />

      {/* Preview modal */}
      <PreviewModal
        template={previewTemplate}
        copiedId={prompts.copiedId}
        onClose={() => setPreviewTemplate(null)}
        onCopy={prompts.copyToClipboard}
        onCopyAsNew={handleCopyAsNew}
      />
    </div>
  )
}
