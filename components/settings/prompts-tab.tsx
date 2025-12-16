'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import ReactMarkdown from 'react-markdown'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [formData, setFormData] = useState<TemplateFormData>(INITIAL_FORM_DATA)
  const [showPreview, setShowPreview] = useState(false)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Clipboard state
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/prompt-templates')
      if (!res.ok) throw new Error('Failed to fetch templates')
      const data = await res.json()
      setTemplates(data)
      clientLogger.debug('Fetched prompt templates', { count: data.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error fetching prompt templates', { error: message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const openCreateModal = () => {
    setEditingTemplate(null)
    setFormData(INITIAL_FORM_DATA)
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const openEditModal = (template: PromptTemplate) => {
    setEditingTemplate(template)
    setFormData({
      name: template.name,
      description: template.description || '',
      content: template.content,
    })
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingTemplate(null)
    setFormData(INITIAL_FORM_DATA)
    setShowPreview(false)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)

      if (editingTemplate) {
        // Update existing template
        const res = await fetch(`/api/prompt-templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update template')
        }

        const updated = await res.json()
        setTemplates(prev =>
          prev.map(t => t.id === updated.id ? updated : t)
        )
        setSuccess('Template updated successfully')
        clientLogger.info('Prompt template updated', { templateId: updated.id })
      } else {
        // Create new template
        const res = await fetch('/api/prompt-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create template')
        }

        const created = await res.json()
        setTemplates(prev => [...prev, created])
        setSuccess('Template created successfully')
        clientLogger.info('Prompt template created', { templateId: created.id })
      }

      closeModal()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error saving prompt template', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (templateId: string) => {
    try {
      setSaving(true)
      setError(null)

      const res = await fetch(`/api/prompt-templates/${templateId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete template')
      }

      setTemplates(prev => prev.filter(t => t.id !== templateId))
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      clientLogger.info('Prompt template deleted', { templateId })
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error deleting prompt template', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyAsNew = (template: PromptTemplate) => {
    setEditingTemplate(null)
    setFormData({
      name: `${template.name} (Copy)`,
      description: template.description || '',
      content: template.content,
    })
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading templates...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded p-4 text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
          {success}
        </div>
      )}

      {/* Sample Prompts Section */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Sample Prompts</h2>
        <p className="text-muted-foreground text-sm mb-4">
          These prompts are provided by Quilltap and cannot be modified. You can preview them or copy them to create your own version.
        </p>

        {builtInTemplates.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4">
            No sample prompts available.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {builtInTemplates.map(template => (
              <div
                key={template.id}
                className="border border-border rounded-lg p-4 bg-card shadow-sm"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{template.name}</h3>
                    {template.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
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
                      <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
                        {template.category}
                      </span>
                    )}
                    {template.modelHint && (
                      <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">My Prompts</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Custom prompt templates you&apos;ve created for reuse across characters and chats.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Create Prompt
          </button>
        </div>

        {userTemplates.length === 0 ? (
          <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4">
            No custom prompts yet. Create one to build your own reusable prompt templates.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {userTemplates.map(template => (
              <div
                key={template.id}
                className="border border-border rounded-lg p-4 bg-card shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground truncate">{template.name}</h3>
                  {template.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 mt-4">
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
                  {deleteConfirm === template.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDelete(template.id)}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(template.id)}
                      className="px-3 py-1.5 text-sm rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  )}
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
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    maxLength={100}
                    placeholder="My Custom Prompt"
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {formData.name.length}/100 characters
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    maxLength={500}
                    placeholder="A brief description of what this prompt does"
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {formData.description.length}/500 characters
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-foreground">
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
                      <ReactMarkdown>{formData.content || '*No content*'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                      rows={15}
                      placeholder="Enter your prompt content here. Markdown formatting is supported."
                      className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
                    />
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Markdown formatting is supported. Use the Preview button to see how it will render.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !formData.name.trim() || !formData.content.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Save Changes' : 'Create Prompt'}
                </button>
              </div>
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
                    <p className="text-sm text-muted-foreground mt-1">
                      {previewTemplate.description}
                    </p>
                  )}
                  {(previewTemplate.category || previewTemplate.modelHint) && (
                    <div className="flex gap-2 mt-2">
                      {previewTemplate.category && (
                        <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
                          {previewTemplate.category}
                        </span>
                      )}
                      {previewTemplate.modelHint && (
                        <span className="px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
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
