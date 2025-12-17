'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface RoleplayTemplate {
  id: string
  userId: string | null
  name: string
  description: string | null
  systemPrompt: string
  isBuiltIn: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

interface TemplateFormData {
  name: string
  description: string
  systemPrompt: string
}

const INITIAL_FORM_DATA: TemplateFormData = {
  name: '',
  description: '',
  systemPrompt: '',
}

export default function RoleplayTemplatesTab() {
  const [templates, setTemplates] = useState<RoleplayTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Default template state
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null)
  const [defaultSaving, setDefaultSaving] = useState(false)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<RoleplayTemplate | null>(null)
  const [formData, setFormData] = useState<TemplateFormData>(INITIAL_FORM_DATA)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<RoleplayTemplate | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/roleplay-templates')
      if (!res.ok) throw new Error('Failed to fetch templates')
      const data = await res.json()
      setTemplates(data)
      clientLogger.debug('Fetched roleplay templates', { count: data.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error fetching roleplay templates', { error: message })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchChatSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setDefaultTemplateId(data.defaultRoleplayTemplateId || null)
      clientLogger.debug('Fetched chat settings for default template', {
        defaultRoleplayTemplateId: data.defaultRoleplayTemplateId,
      })
    } catch (err) {
      clientLogger.error('Error fetching chat settings', {
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
    fetchChatSettings()
  }, [fetchTemplates, fetchChatSettings])

  const handleDefaultTemplateChange = async (templateId: string | null) => {
    try {
      setDefaultSaving(true)
      setError(null)

      const res = await fetch('/api/chat-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRoleplayTemplateId: templateId }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update default template')
      }

      setDefaultTemplateId(templateId)
      setSuccess('Default template updated successfully')
      clientLogger.info('Default roleplay template updated', { templateId })
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error updating default template', { error: message })
    } finally {
      setDefaultSaving(false)
    }
  }

  const openCreateModal = () => {
    setEditingTemplate(null)
    setFormData(INITIAL_FORM_DATA)
    setIsModalOpen(true)
  }

  const openEditModal = (template: RoleplayTemplate) => {
    setEditingTemplate(template)
    setFormData({
      name: template.name,
      description: template.description || '',
      systemPrompt: template.systemPrompt,
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingTemplate(null)
    setFormData(INITIAL_FORM_DATA)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)

      if (editingTemplate) {
        // Update existing template
        const res = await fetch(`/api/roleplay-templates/${editingTemplate.id}`, {
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
        clientLogger.info('Roleplay template updated', { templateId: updated.id })
      } else {
        // Create new template
        const res = await fetch('/api/roleplay-templates', {
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
        clientLogger.info('Roleplay template created', { templateId: created.id })
      }

      closeModal()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error saving roleplay template', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (templateId: string) => {
    try {
      setSaving(true)
      setError(null)

      const res = await fetch(`/api/roleplay-templates/${templateId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete template')
      }

      setTemplates(prev => prev.filter(t => t.id !== templateId))
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      clientLogger.info('Roleplay template deleted', { templateId })
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error deleting roleplay template', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyAsNew = (template: RoleplayTemplate) => {
    setEditingTemplate(null)
    setFormData({
      name: `${template.name} (Copy)`,
      description: template.description || '',
      systemPrompt: template.systemPrompt,
    })
    setIsModalOpen(true)
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

      {/* Default Template Section */}
      <section className="border border-border rounded-lg p-4 bg-card">
        <h2 className="text-lg font-semibold mb-2">Default Template</h2>
        <p className="qt-text-small mb-4">
          This template will be applied to all new chats by default. You can override it per-character or per-chat.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-md">
            <label className="qt-label mb-1">
              Template for New Chats
            </label>
            <select
              value={defaultTemplateId || ''}
              onChange={(e) => handleDefaultTemplateChange(e.target.value || null)}
              disabled={defaultSaving || loading}
              className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">None (no formatting template)</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
                </option>
              ))}
            </select>
          </div>
          {defaultSaving && (
            <span className="qt-text-small">Saving...</span>
          )}
        </div>
      </section>

      {/* Built-in Templates Section */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Built-in Templates</h2>
        <p className="qt-text-small mb-4">
          These templates are provided by Quilltap and cannot be modified. You can copy them to create your own version.
        </p>

        {builtInTemplates.length === 0 ? (
          <div className="qt-text-small border border-dashed border-border rounded-lg p-4">
            No built-in templates available.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {builtInTemplates.map(template => (
              <div
                key={template.id}
                className="border border-border rounded-lg p-4 bg-card shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="qt-text-primary truncate">{template.name}</h3>
                    {template.description && (
                      <p className="qt-text-small mt-1 line-clamp-2">
                        {template.description}
                      </p>
                    )}
                  </div>
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                    Built-in
                  </span>
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
            <h2 className="text-xl font-semibold">My Templates</h2>
            <p className="qt-text-small mt-1">
              Custom templates you&apos;ve created for your roleplay sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Create Template
          </button>
        </div>

        {userTemplates.length === 0 ? (
          <div className="qt-text-small border border-dashed border-border rounded-lg p-4">
            No custom templates yet. Create one to define your own roleplay formatting style.
          </div>
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
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="qt-label mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    maxLength={100}
                    placeholder="My Custom RP Style"
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="qt-text-xs mt-1">
                    {formData.name.length}/100 characters
                  </p>
                </div>

                <div>
                  <label className="qt-label mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    maxLength={500}
                    placeholder="A brief description of what this template does"
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="qt-text-xs mt-1">
                    {formData.description.length}/500 characters
                  </p>
                </div>

                <div>
                  <label className="qt-label mb-1">
                    System Prompt <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={formData.systemPrompt}
                    onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    rows={12}
                    placeholder="Enter the formatting instructions that will be prepended to character system prompts..."
                    className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
                  />
                  <p className="qt-text-xs mt-1">
                    This will be prepended to the character&apos;s system prompt when this template is selected.
                    You can use placeholders like {'{{char}}'} and {'{{user}}'}.
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
                  disabled={saving || !formData.name.trim() || !formData.systemPrompt.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Save Changes' : 'Create Template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">{previewTemplate.name}</h2>
                  {previewTemplate.description && (
                    <p className="qt-text-small mt-1">
                      {previewTemplate.description}
                    </p>
                  )}
                </div>
                {previewTemplate.isBuiltIn && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
                    Built-in
                  </span>
                )}
              </div>

              <div className="border border-border rounded-lg p-4 bg-muted/30">
                <h3 className="qt-text-small font-medium mb-2">System Prompt</h3>
                <pre className="whitespace-pre-wrap text-sm text-foreground font-mono">
                  {previewTemplate.systemPrompt}
                </pre>
              </div>

              <div className="flex justify-end gap-3 mt-6">
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
