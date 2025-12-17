'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import ReactMarkdown from 'react-markdown'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'
import { FormActions } from '@/components/ui/FormActions'

interface PromptTemplate {
  id: string
  userId: string | null
  name: string
  content: string
  description: string | null
  isBuiltIn: boolean
  category: string | null
  modelHint: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

interface TemplateFormData {
  name: string
  content: string
  description: string
}

const INITIAL_FORM_DATA: TemplateFormData = {
  name: '',
  content: '',
  description: '',
}

export default function PromptsTab() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [success, setSuccess] = useState<string | null>(null)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Clipboard state
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Form state hook
  const form = useFormState<TemplateFormData>(INITIAL_FORM_DATA)

  // Async operation hooks
  const fetchOp = useAsyncOperation<PromptTemplate[]>()
  const saveOp = useAsyncOperation<PromptTemplate>()
  const deleteOp = useAsyncOperation<void>()

  // Fetch templates on mount
  const fetchTemplates = useCallback(async () => {
    clientLogger.debug('Fetching prompt templates')
    const result = await fetchOp.execute(async () => {
      const response = await fetchJson<PromptTemplate[]>('/api/prompt-templates')
      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch templates')
      }
      return response.data || []
    })
    if (result) {
      setTemplates(result)
      clientLogger.debug('Fetched prompt templates', { count: result.length })
    }
  }, [fetchOp])

  useEffect(() => {
    // Fetch templates on mount - this is the correct pattern for data loading
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates()
  }, [fetchTemplates])

  const openCreateModal = () => {
    setEditingTemplate(null)
    form.resetForm()
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const openEditModal = (template: PromptTemplate) => {
    setEditingTemplate(template)
    form.setField('name', template.name)
    form.setField('description', template.description || '')
    form.setField('content', template.content)
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingTemplate(null)
    form.resetForm()
    setShowPreview(false)
  }

  const handleSave = async () => {
    clientLogger.debug('Saving prompt template', {
      isEdit: !!editingTemplate,
      templateName: form.formData.name,
    })

    const result = await saveOp.execute(async () => {
      if (editingTemplate) {
        // Update existing template
        clientLogger.debug('Updating template', { templateId: editingTemplate.id })
        const response = await fetchJson<PromptTemplate>(
          `/api/prompt-templates/${editingTemplate.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form.formData),
          }
        )

        if (!response.ok) {
          throw new Error(response.error || 'Failed to update template')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      } else {
        // Create new template
        clientLogger.debug('Creating new template')
        const response = await fetchJson<PromptTemplate>('/api/prompt-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form.formData),
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to create template')
        }

        if (!response.data) {
          throw new Error('No data returned from server')
        }

        return response.data
      }
    })

    if (result) {
      if (editingTemplate) {
        // Update existing in list
        setTemplates(prev =>
          prev.map(t => t.id === result.id ? result : t)
        )
        setSuccess('Template updated successfully')
        clientLogger.info('Prompt template updated', { templateId: result.id })
      } else {
        // Add new to list
        setTemplates(prev => [...prev, result])
        setSuccess('Template created successfully')
        clientLogger.info('Prompt template created', { templateId: result.id })
      }

      closeModal()
      setTimeout(() => setSuccess(null), 3000)
    }
  }

  const handleDelete = async (templateId: string) => {
    clientLogger.debug('Deleting template', { templateId })

    const result = await deleteOp.execute(async () => {
      const response = await fetchJson<void>(
        `/api/prompt-templates/${templateId}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete template')
      }
    })

    if (result !== null) {
      setTemplates(prev => prev.filter(t => t.id !== templateId))
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      clientLogger.info('Prompt template deleted', { templateId })
      setTimeout(() => setSuccess(null), 3000)
    }
  }

  const handleCopyAsNew = (template: PromptTemplate) => {
    clientLogger.debug('Copying template as new', { templateId: template.id })
    setEditingTemplate(null)
    form.setField('name', `${template.name} (Copy)`)
    form.setField('description', template.description || '')
    form.setField('content', template.content)
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const handleCopyToClipboard = async (template: PromptTemplate) => {
    try {
      await navigator.clipboard.writeText(template.content)
      setCopiedId(template.id)
      clientLogger.debug('Copied template to clipboard', { templateId: template.id })
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      clientLogger.error('Failed to copy to clipboard', {
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const builtInTemplates = templates.filter(t => t.isBuiltIn)
  const userTemplates = templates.filter(t => !t.isBuiltIn)

  if (fetchOp.loading) {
    return <LoadingState message="Loading templates..." />
  }

  return (
    <div className="space-y-6">
      {fetchOp.error && (
        <ErrorAlert
          message={fetchOp.error}
          onRetry={fetchTemplates}
        />
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
          {success}
        </div>
      )}

      {saveOp.error && (
        <ErrorAlert
          message={saveOp.error}
          onRetry={() => {}}
        />
      )}

      {deleteOp.error && (
        <ErrorAlert
          message={deleteOp.error}
          onRetry={() => {}}
        />
      )}

      {/* Sample Prompts Section */}
      <section>
        <SectionHeader
          title="Sample Prompts"
          level="h2"
        />
        <p className="qt-text-small mb-4">
          These prompts are provided by Quilltap and cannot be modified. You can preview them or copy them to create your own version.
        </p>

        {builtInTemplates.length === 0 ? (
          <EmptyState
            title="No sample prompts available"
            variant="dashed"
          />
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {builtInTemplates.map(template => (
              <div
                key={template.id}
                className="border border-border rounded-lg p-4 bg-card shadow-sm"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="qt-text-primary truncate">{template.name}</h3>
                    {template.description && (
                      <p className="qt-text-small mt-1 line-clamp-2">
                        {template.description}
                      </p>
                    )}
                  </div>
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded shrink-0">
                    Sample
                  </span>
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewTemplate(template)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyToClipboard(template)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    {copiedId === template.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyAsNew(template)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    Copy as New
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* User Templates Section */}
      <section>
        <SectionHeader
          title="My Prompts"
          level="h2"
          action={{
            label: 'Create Prompt',
            onClick: openCreateModal,
          }}
        />
        <p className="qt-text-small mb-4">
          Custom prompt templates you&apos;ve created for reuse across characters and chats.
        </p>

        {userTemplates.length === 0 ? (
          <EmptyState
            title="No custom prompts yet"
            description="Create one to build your own reusable prompt templates."
            action={{
              label: 'Create Prompt',
              onClick: openCreateModal,
            }}
            variant="dashed"
          />
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {userTemplates.map(template => (
              <div
                key={template.id}
                className="border border-border rounded-lg p-4 bg-card shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="qt-text-primary truncate">{template.name}</h3>
                  {template.description && (
                    <p className="qt-text-small mt-1 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 mt-4 relative">
                  <button
                    type="button"
                    onClick={() => setPreviewTemplate(template)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyToClipboard(template)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    {copiedId === template.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(template)}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    Edit
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(deleteConfirm === template.id ? null : template.id)}
                      className="px-3 py-1.5 text-sm rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                    <DeleteConfirmPopover
                      isOpen={deleteConfirm === template.id}
                      isDeleting={deleteOp.loading}
                      onCancel={() => setDeleteConfirm(null)}
                      onConfirm={() => handleDelete(template.id)}
                      message="Are you sure you want to delete this template?"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">
                {editingTemplate ? 'Edit Prompt' : 'Create Prompt'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="qt-label mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={form.formData.name}
                    onChange={form.handleChange}
                    maxLength={100}
                    placeholder="My Custom Prompt"
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="qt-text-xs mt-1">
                    {form.formData.name.length}/100 characters
                  </p>
                </div>

                <div>
                  <label className="qt-label mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    name="description"
                    value={form.formData.description}
                    onChange={form.handleChange}
                    maxLength={500}
                    placeholder="A brief description of what this prompt does"
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="qt-text-xs mt-1">
                    {form.formData.description.length}/500 characters
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm qt-text-primary">
                      Content <span className="text-destructive">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className="text-sm text-primary hover:underline"
                    >
                      {showPreview ? 'Edit' : 'Preview'}
                    </button>
                  </div>

                  {showPreview ? (
                    <div className="w-full rounded-md border border-input bg-background p-4 min-h-[300px] max-h-[400px] overflow-y-auto prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{form.formData.content || '*No content*'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      name="content"
                      value={form.formData.content}
                      onChange={form.handleChange}
                      rows={15}
                      placeholder="Enter your prompt content here. Markdown formatting is supported."
                      className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
                    />
                  )}
                  <p className="qt-text-xs mt-1">
                    Markdown formatting is supported. Use the Preview button to see how it will render.
                  </p>
                </div>
              </div>

              <FormActions
                onCancel={closeModal}
                onSubmit={handleSave}
                isLoading={saveOp.loading}
                isDisabled={!form.formData.name.trim() || !form.formData.content.trim()}
                submitLabel={editingTemplate ? 'Save Changes' : 'Create Prompt'}
              />
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">{previewTemplate.name}</h2>
                  {previewTemplate.description && (
                    <p className="qt-text-small mt-1">
                      {previewTemplate.description}
                    </p>
                  )}
                  {(previewTemplate.category || previewTemplate.modelHint) && (
                    <div className="flex gap-2 mt-2">
                      {previewTemplate.category && (
                        <span className="px-2 py-0.5 qt-text-xs bg-muted rounded">
                          {previewTemplate.category}
                        </span>
                      )}
                      {previewTemplate.modelHint && (
                        <span className="px-2 py-0.5 qt-text-xs bg-muted rounded">
                          {previewTemplate.modelHint}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {previewTemplate.isBuiltIn && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                    Sample
                  </span>
                )}
              </div>

              <div className="border border-border rounded-lg p-4 bg-muted/30 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{previewTemplate.content}</ReactMarkdown>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => handleCopyToClipboard(previewTemplate)}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
                >
                  {copiedId === previewTemplate.id ? 'Copied!' : 'Copy to Clipboard'}
                </button>
                {previewTemplate.isBuiltIn && (
                  <button
                    type="button"
                    onClick={() => {
                      handleCopyAsNew(previewTemplate)
                      setPreviewTemplate(null)
                    }}
                    className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    Copy as New
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewTemplate(null)}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
