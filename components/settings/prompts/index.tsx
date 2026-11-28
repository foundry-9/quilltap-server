'use client'

import { useState, useCallback } from 'react'
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

  const form = useFormState(INITIAL_FORM_DATA)
  const prompts = usePrompts()

  const { clearSaveError } = prompts

  const openCreateModal = useCallback(() => {
    clearSaveError()
    setEditingTemplate(null)
    form.resetForm()
    setIsModalOpen(true)
  }, [form, clearSaveError])

  const openEditModal = useCallback(
    (template: PromptTemplate) => {
      clearSaveError()
      setEditingTemplate(template)
      form.setField('name', template.name)
      form.setField('description', template.description || '')
      form.setField('content', template.content)
      setIsModalOpen(true)
    },
    [form, clearSaveError]
  )

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingTemplate(null)
    form.resetForm()
    clearSaveError()
  }, [form, clearSaveError])

  const handleSave = useCallback(async () => {
    const result = await prompts.saveTemplate(form.formData, editingTemplate?.id)
    if (result) {
      closeModal()
    }
  }, [prompts, form.formData, editingTemplate, closeModal])

  const handleCopyAsNew = useCallback(
    (template: PromptTemplate) => {
      clearSaveError()
      setEditingTemplate(null)
      form.setField('name', `${template.name} (Copy)`)
      form.setField('description', template.description || '')
      form.setField('content', template.content)
      setIsModalOpen(true)
    },
    [form, clearSaveError]
  )

  const handleDelete = useCallback(
    (templateId: string) => {
      prompts.deleteTemplate(templateId)
    },
    [prompts]
  )

  const builtInTemplates = prompts.templates.filter(t => t.isBuiltIn)
  const userTemplates = prompts.templates.filter(t => !t.isBuiltIn)

  if (prompts.loading) {
    return <LoadingState message="Loading templates..." />
  }

  return (
    <div className="space-y-6">
      {prompts.fetchError && (
        <ErrorAlert
          message={prompts.fetchError}
          onRetry={prompts.retryFetch}
        />
      )}

      {prompts.success && (
        <div className="qt-alert-success">
          {prompts.success}
        </div>
      )}

      {/* A failed save is shown inside the modal, which stays open (#252). */}
      {prompts.deleteError && <ErrorAlert message={prompts.deleteError} />}

      {/* Built-in templates list */}
      <PromptList
        title="Sample Prompts"
        description="These prompts are provided by Quilltap and cannot be modified. You can preview them or copy them to create your own version."
        templates={builtInTemplates}
        isBuiltIn={true}
        copiedId={prompts.copiedId}
        deleteConfirmId={prompts.deleteConfirm}
        isDeleting={prompts.deleting}
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
        isDeleting={prompts.deleting}
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
        isSaving={prompts.saving}
        error={prompts.saveError}
        onClose={closeModal}
        onSave={handleSave}
        onFormChange={form.handleChange}
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
