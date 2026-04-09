'use client'

import { useState, useCallback, useEffect } from 'react'
import { RoleplayTemplate, TemplateFormData, INITIAL_FORM_DATA } from '../types'

export interface UseRoleplayTemplatesReturn {
  // Data
  templates: RoleplayTemplate[]
  defaultTemplateId: string | null

  // Loading states
  loading: boolean
  saving: boolean
  defaultSaving: boolean
  error: string | null
  success: string | null

  // Modal states
  isModalOpen: boolean
  editingTemplate: RoleplayTemplate | null
  formData: TemplateFormData
  previewTemplate: RoleplayTemplate | null
  deleteConfirm: string | null

  // Data fetching
  fetchTemplates: () => Promise<void>
  fetchChatSettings: () => Promise<void>

  // Modal handlers
  openCreateModal: () => void
  openEditModal: (template: RoleplayTemplate) => void
  closeModal: () => void
  setPreviewTemplate: (template: RoleplayTemplate | null) => void
  setDeleteConfirm: (id: string | null) => void
  setFormData: (data: TemplateFormData | ((prev: TemplateFormData) => TemplateFormData)) => void

  // API handlers
  handleDefaultTemplateChange: (templateId: string | null) => Promise<void>
  handleSave: () => Promise<void>
  handleDelete: (templateId: string) => Promise<void>
  handleCopyAsNew: (template: RoleplayTemplate) => void
}

export function useRoleplayTemplates(): UseRoleplayTemplatesReturn {
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
      const res = await fetch('/api/v1/roleplay-templates')
      if (!res.ok) throw new Error('Failed to fetch templates')
      const data = await res.json()
      setTemplates(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error fetching roleplay templates', { error: message })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchChatSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/settings/chat')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setDefaultTemplateId(data.defaultRoleplayTemplateId || null)
    } catch (err) {
      console.error('Error fetching chat settings', {
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

      const res = await fetch('/api/v1/settings/chat', {
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
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error updating default template', { error: message })
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
    const delimiters = template.narrationDelimiters
    const isPair = Array.isArray(delimiters)
    setFormData({
      name: template.name,
      description: template.description || '',
      systemPrompt: template.systemPrompt,
      narrationDelimiterMode: isPair ? 'pair' : 'single',
      narrationOpen: isPair ? delimiters[0] : (delimiters || '*'),
      narrationClose: isPair ? delimiters[1] : (delimiters || '*'),
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

      // Build narrationDelimiters from form state
      const narrationDelimiters = formData.narrationDelimiterMode === 'pair'
        ? [formData.narrationOpen, formData.narrationClose]
        : formData.narrationOpen

      const payload = {
        name: formData.name,
        description: formData.description,
        systemPrompt: formData.systemPrompt,
        narrationDelimiters,
      }

      if (editingTemplate) {
        // Update existing template
        const res = await fetch(`/api/v1/roleplay-templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
      } else {
        // Create new template
        const res = await fetch('/api/v1/roleplay-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to create template')
        }

        const created = await res.json()
        setTemplates(prev => [...prev, created])
        setSuccess('Template created successfully')
      }

      closeModal()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error saving roleplay template', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (templateId: string) => {
    try {
      setSaving(true)
      setError(null)

      const res = await fetch(`/api/v1/roleplay-templates/${templateId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete template')
      }

      setTemplates(prev => prev.filter(t => t.id !== templateId))
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error deleting roleplay template', { error: message })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyAsNew = (template: RoleplayTemplate) => {
    setEditingTemplate(null)
    const delimiters = template.narrationDelimiters
    const isPair = Array.isArray(delimiters)
    setFormData({
      name: `${template.name} (Copy)`,
      description: template.description || '',
      systemPrompt: template.systemPrompt,
      narrationDelimiterMode: isPair ? 'pair' : 'single',
      narrationOpen: isPair ? delimiters[0] : (delimiters || '*'),
      narrationClose: isPair ? delimiters[1] : (delimiters || '*'),
    })
    setIsModalOpen(true)
  }

  return {
    templates,
    defaultTemplateId,
    loading,
    saving,
    defaultSaving,
    error,
    success,
    isModalOpen,
    editingTemplate,
    formData,
    previewTemplate,
    deleteConfirm,
    fetchTemplates,
    fetchChatSettings,
    openCreateModal,
    openEditModal,
    closeModal,
    setPreviewTemplate,
    setDeleteConfirm,
    setFormData,
    handleDefaultTemplateChange,
    handleSave,
    handleDelete,
    handleCopyAsNew,
  }
}
