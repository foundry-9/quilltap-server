'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { RoleplayTemplate, TemplateFormData, DelimiterFormEntry, INITIAL_FORM_DATA } from '../types'
import type { TemplateDelimiter } from '@/lib/schemas/template.types'

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

/** Convert a TemplateDelimiter to form entry */
function delimiterToFormEntry(d: TemplateDelimiter): DelimiterFormEntry {
  const isPair = Array.isArray(d.delimiters)
  return {
    name: d.name,
    buttonName: d.buttonName,
    delimiterMode: isPair ? 'pair' : 'single',
    delimiterOpen: isPair ? (d.delimiters as [string, string])[0] : (d.delimiters as string),
    delimiterClose: isPair ? (d.delimiters as [string, string])[1] : (d.delimiters as string),
    style: d.style,
  }
}

/** Convert form entries back to TemplateDelimiter array */
function formEntriesToDelimiters(entries: DelimiterFormEntry[]): TemplateDelimiter[] {
  return entries
    .filter(e => e.name.trim() && e.buttonName.trim())
    .map(e => ({
      name: e.name.trim(),
      buttonName: e.buttonName.trim(),
      delimiters: e.delimiterMode === 'pair'
        ? [e.delimiterOpen, e.delimiterClose] as [string, string]
        : e.delimiterOpen,
      style: e.style.trim() || 'qt-chat-narration',
    }))
}

export function useRoleplayTemplates(): UseRoleplayTemplatesReturn {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [defaultSaving, setDefaultSaving] = useState(false)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<RoleplayTemplate | null>(null)
  const [formData, setFormData] = useState<TemplateFormData>(INITIAL_FORM_DATA)

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<RoleplayTemplate | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Fetch templates and settings via SWR
  const { data: templatesData, isLoading: loading, mutate: mutateTemplates } = useSWR<RoleplayTemplate[]>(
    '/api/v1/roleplay-templates'
  )
  const { data: chatSettingsData } = useSWR<{ defaultRoleplayTemplateId?: string | null }>(
    '/api/v1/settings/chat'
  )

  const templates = templatesData ?? []
  const defaultTemplateId = chatSettingsData?.defaultRoleplayTemplateId ?? null

  // Fetch helpers (backward compatibility)
  const fetchTemplates = useCallback(async () => {
    await mutateTemplates()
  }, [mutateTemplates])

  const fetchChatSettings = useCallback(async () => {
    // Settings already synced via SWR
  }, [])

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
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed to update default template (${res.status})`)
      }

      setSuccess('Default template updated successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error updating default template:', message, err)
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
      delimiters: (template.delimiters || []).map(delimiterToFormEntry),
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
        delimiters: formEntriesToDelimiters(formData.delimiters),
      }

      if (editingTemplate) {
        // Update existing template
        const res = await fetch(`/api/v1/roleplay-templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error || `Failed to update template (${res.status})`)
        }

        await res.json()
        await mutateTemplates()
        setSuccess('Template updated successfully')
      } else {
        // Create new template
        const res = await fetch('/api/v1/roleplay-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error || `Failed to create template (${res.status})`)
        }

        const created = await res.json()
        await mutateTemplates()
        setSuccess('Template created successfully')
      }

      closeModal()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error saving roleplay template:', message, err)
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
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Failed to delete template (${res.status})`)
      }

      await mutateTemplates()
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      console.error('Error deleting roleplay template:', message, err)
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
      delimiters: (template.delimiters || []).map(delimiterToFormEntry),
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
