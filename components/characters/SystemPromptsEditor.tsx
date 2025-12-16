'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import ReactMarkdown from 'react-markdown'

interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

interface PromptTemplate {
  id: string
  name: string
  content: string
  description: string | null
  isBuiltIn: boolean
  category: string | null
  modelHint: string | null
}

interface SamplePrompt {
  name: string
  content: string
  modelHint: string
  category: string
  filename: string
}

interface SystemPromptsEditorProps {
  characterId: string
  characterName: string
  onUpdate?: () => void
}

interface PromptFormData {
  name: string
  content: string
  isDefault: boolean
}

const INITIAL_FORM_DATA: PromptFormData = {
  name: '',
  content: '',
  isDefault: false,
}

export function SystemPromptsEditor({ characterId, characterName, onUpdate }: SystemPromptsEditorProps) {
  const [prompts, setPrompts] = useState<CharacterSystemPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<CharacterSystemPrompt | null>(null)
  const [formData, setFormData] = useState<PromptFormData>(INITIAL_FORM_DATA)
  const [showPreview, setShowPreview] = useState(false)

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [samplePrompts, setSamplePrompts] = useState<SamplePrompt[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // Preview modal state
  const [previewPrompt, setPreviewPrompt] = useState<CharacterSystemPrompt | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/characters/${characterId}/prompts`)
      if (!res.ok) throw new Error('Failed to fetch prompts')
      const data = await res.json()
      setPrompts(data)
      clientLogger.debug('Fetched character system prompts', { count: data.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error fetching character prompts', { error: message })
    } finally {
      setLoading(false)
    }
  }, [characterId])

  const fetchTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true)
      const [templatesRes, samplesRes] = await Promise.all([
        fetch('/api/prompt-templates'),
        fetch('/api/sample-prompts'),
      ])

      if (templatesRes.ok) {
        const data = await templatesRes.json()
        setTemplates(data)
      }

      if (samplesRes.ok) {
        const data = await samplesRes.json()
        setSamplePrompts(data)
      }
    } catch (err) {
      clientLogger.error('Error fetching templates', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  useEffect(() => {
    fetchPrompts()
  }, [fetchPrompts])

  const openCreateModal = () => {
    setEditingPrompt(null)
    setFormData({
      ...INITIAL_FORM_DATA,
      isDefault: prompts.length === 0, // First prompt is default
    })
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const openEditModal = (prompt: CharacterSystemPrompt) => {
    setEditingPrompt(prompt)
    setFormData({
      name: prompt.name,
      content: prompt.content,
      isDefault: prompt.isDefault,
    })
    setShowPreview(false)
    setIsModalOpen(true)
  }

  const openImportModal = () => {
    fetchTemplates()
    setShowImportModal(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingPrompt(null)
    setFormData(INITIAL_FORM_DATA)
    setShowPreview(false)
  }

  const handleImport = async (content: string, suggestedName: string) => {
    setFormData({
      name: suggestedName,
      content,
      isDefault: prompts.length === 0,
    })
    setShowImportModal(false)
    setIsModalOpen(true)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError(null)

      if (editingPrompt) {
        // Update existing prompt
        const res = await fetch(`/api/characters/${characterId}/prompts/${editingPrompt.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update prompt')
        }

        setSuccess('Prompt updated successfully')
        clientLogger.info('Character prompt updated', { promptId: editingPrompt.id })
      } else {
        // Create new prompt
        const res = await fetch(`/api/characters/${characterId}/prompts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create prompt')
        }

        setSuccess('Prompt created successfully')
        clientLogger.info('Character prompt created')
      }

      closeModal()
      await fetchPrompts()
      onUpdate?.()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      clientLogger.error('Error saving prompt', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (promptId: string) => {
    try {
      setSaving(true)
      setError(null)

      const res = await fetch(`/api/characters/${characterId}/prompts/${promptId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete prompt')
      }

      setSuccess('Prompt deleted successfully')
      setDeleteConfirm(null)
      await fetchPrompts()
      onUpdate?.()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (promptId: string) => {
    try {
      setSaving(true)
      setError(null)

      const res = await fetch(`/api/characters/${characterId}/prompts/${promptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to set default')
      }

      setSuccess('Default prompt updated')
      await fetchPrompts()
      onUpdate?.()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading prompts...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-foreground">System Prompts</h3>
          <p className="text-sm text-muted-foreground">
            Manage multiple system prompts for {characterName}. Select which one to use when creating or configuring a chat.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={openImportModal}
            className="qt-button-secondary"
          >
            Import Template
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="qt-button-primary"
          >
            + Add Prompt
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}
      {success && (
        <div className="qt-alert-success">
          {success}
        </div>
      )}

      {/* Prompts List */}
      {prompts.length === 0 ? (
        <div className="qt-card text-center">
          <p className="text-muted-foreground mb-4">
            No system prompts yet. Add your first prompt or import from a template.
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={openImportModal}
              className="qt-button-secondary"
            >
              Import Template
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="qt-button-primary"
            >
              Create First Prompt
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {prompts.map((prompt) => (
            <div
              key={prompt.id}
              className="qt-card hover:bg-accent/50 transition"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-foreground truncate">{prompt.name}</h4>
                    {prompt.isDefault && (
                      <span className="qt-badge-primary">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {prompt.content.slice(0, 150)}...
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <button
                    type="button"
                    onClick={() => setPreviewPrompt(prompt)}
                    className="qt-button-icon qt-button-ghost"
                    title="Preview"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(prompt)}
                    className="qt-button-icon qt-button-ghost"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {!prompt.isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(prompt.id)}
                      className="qt-button-icon qt-button-ghost hover:text-primary"
                      title="Set as default"
                      disabled={saving}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>
                  )}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(deleteConfirm === prompt.id ? null : prompt.id)}
                      className="qt-button-icon qt-button-ghost hover:text-destructive"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    {deleteConfirm === prompt.id && (
                      <div className="absolute right-0 top-full mt-1 p-3 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[180px]">
                        <p className="text-sm text-foreground mb-2">Delete this prompt?</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(prompt.id)}
                            disabled={saving}
                            className="qt-button-destructive qt-button-sm flex-1"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(null)}
                            className="qt-button-secondary qt-button-sm flex-1"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="qt-dialog w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-foreground">
                  {editingPrompt ? 'Edit Prompt' : 'Create Prompt'}
                </h3>
                <button
                  type="button"
                  onClick={closeModal}
                  className="qt-button-icon qt-button-ghost"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="qt-label">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Romantic, Companion, Professional"
                    className="qt-input"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="qt-label">
                      Content *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className="qt-link text-xs"
                    >
                      {showPreview ? 'Edit' : 'Preview'}
                    </button>
                  </div>
                  {showPreview ? (
                    <div className="p-4 border border-border rounded-lg bg-muted/30 min-h-[200px] prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{formData.content || '*No content*'}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      placeholder="Enter the system prompt content (Markdown supported)"
                      rows={10}
                      className="qt-textarea font-mono"
                    />
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Supports Markdown formatting. Use {'{{char}}'} and {'{{user}}'} for character/user name substitution.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="qt-checkbox"
                  />
                  <label htmlFor="isDefault" className="text-sm text-foreground">
                    Set as default prompt
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={closeModal}
                  className="qt-button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !formData.name || !formData.content}
                  className="qt-button-primary"
                >
                  {saving ? 'Saving...' : editingPrompt ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="qt-dialog w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-foreground">
                  Import from Template
                </h3>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="qt-button-icon qt-button-ghost"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {loadingTemplates ? (
                <div className="text-center py-8 text-muted-foreground">Loading templates...</div>
              ) : (
                <div className="space-y-6">
                  {/* Sample Prompts */}
                  {samplePrompts.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-3">Sample Prompts</h4>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {samplePrompts.map((sample) => (
                          <button
                            type="button"
                            key={sample.filename}
                            onClick={() => handleImport(sample.content, sample.name)}
                            className="qt-button-ghost w-full p-3 text-left justify-start"
                          >
                            <div className="w-full">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-foreground">{sample.name}</span>
                                <span className="qt-badge">
                                  {sample.modelHint}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {sample.category} prompt
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* User Templates */}
                  {templates.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-foreground mb-3">
                        {samplePrompts.length > 0 ? 'My Templates' : 'Templates'}
                      </h4>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {templates.filter(t => !t.isBuiltIn).map((template) => (
                          <button
                            type="button"
                            key={template.id}
                            onClick={() => handleImport(template.content, template.name)}
                            className="qt-button-ghost w-full p-3 text-left justify-start"
                          >
                            <div className="w-full">
                              <span className="font-medium text-foreground">{template.name}</span>
                              {template.description && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {template.description}
                                </p>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {samplePrompts.length === 0 && templates.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">
                      No templates available. Create templates in Settings &gt; Prompts.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="qt-dialog w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground">{previewPrompt.name}</h3>
                  {previewPrompt.isDefault && (
                    <span className="qt-badge-primary">
                      Default
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewPrompt(null)}
                  className="qt-button-icon qt-button-ghost"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4 border border-border rounded-lg bg-muted/30 prose prose-sm dark:prose-invert max-w-none max-h-[60vh] overflow-y-auto">
                <ReactMarkdown>{previewPrompt.content}</ReactMarkdown>
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setPreviewPrompt(null)}
                  className="qt-button-secondary"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openEditModal(previewPrompt)
                    setPreviewPrompt(null)
                  }}
                  className="qt-button-primary"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
