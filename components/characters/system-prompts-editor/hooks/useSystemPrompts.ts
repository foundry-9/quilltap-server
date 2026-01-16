'use client'

import { useState, useCallback, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import {
  CharacterSystemPrompt,
  PromptTemplate,
  SamplePrompt,
  PromptFormData,
  INITIAL_FORM_DATA,
} from '../types'

export interface UseSystemPromptsReturn {
  // Data
  prompts: CharacterSystemPrompt[]
  templates: PromptTemplate[]
  samplePrompts: SamplePrompt[]

  // Loading states
  loading: boolean
  loadingTemplates: boolean
  saving: boolean
  error: string | null
  success: string | null

  // Modal states
  isModalOpen: boolean
  editingPrompt: CharacterSystemPrompt | null
  formData: PromptFormData
  showPreview: boolean
  previewPrompt: CharacterSystemPrompt | null
  deleteConfirm: string | null
  showImportModal: boolean

  // Data fetching
  fetchPrompts: () => Promise<void>
  fetchTemplates: () => Promise<void>

  // Modal handlers
  openCreateModal: () => void
  openEditModal: (prompt: CharacterSystemPrompt) => void
  openImportModal: () => void
  closeModal: () => void
  setShowPreview: (show: boolean) => void
  setPreviewPrompt: (prompt: CharacterSystemPrompt | null) => void
  setDeleteConfirm: (id: string | null) => void
  setShowImportModal: (show: boolean) => void
  setFormData: (data: PromptFormData | ((prev: PromptFormData) => PromptFormData)) => void

  // API handlers
  handleImport: (content: string, suggestedName: string) => void
  handleSave: () => Promise<void>
  handleDelete: (promptId: string) => Promise<void>
  handleSetDefault: (promptId: string) => Promise<void>
}

export function useSystemPrompts(
  characterId: string,
  onUpdate?: () => void
): UseSystemPromptsReturn {
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
      const res = await fetch(`/api/v1/characters/${characterId}/prompts`)
      if (!res.ok) throw new Error('Failed to fetch prompts')
      const data = await res.json()
      setPrompts(data.prompts || [])
      clientLogger.debug('Fetched character system prompts', { count: data.prompts?.length || 0 })
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
        fetch('/api/v1/prompt-templates'),
        fetch('/api/v1/sample-prompts'),
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
      clientLogger.error('Error fetching templates', {
        error: err instanceof Error ? err.message : String(err),
      })
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

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingPrompt(null)
    setFormData(INITIAL_FORM_DATA)
    setShowPreview(false)
  }

  const handleImport = (content: string, suggestedName: string) => {
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
        const res = await fetch(`/api/v1/characters/${characterId}/prompts/${editingPrompt.id}`, {
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
        const res = await fetch(`/api/v1/characters/${characterId}/prompts`, {
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

      const res = await fetch(`/api/v1/characters/${characterId}/prompts/${promptId}`, {
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

      const res = await fetch(`/api/v1/characters/${characterId}?action=update-prompt&promptId=${promptId}`, {
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

  return {
    prompts,
    templates,
    samplePrompts,
    loading,
    loadingTemplates,
    saving,
    error,
    success,
    isModalOpen,
    editingPrompt,
    formData,
    showPreview,
    previewPrompt,
    deleteConfirm,
    showImportModal,
    fetchPrompts,
    fetchTemplates,
    openCreateModal,
    openEditModal,
    openImportModal: () => {
      fetchTemplates()
      setShowImportModal(true)
    },
    closeModal,
    setShowPreview,
    setPreviewPrompt,
    setDeleteConfirm,
    setShowImportModal,
    setFormData,
    handleImport,
    handleSave,
    handleDelete,
    handleSetDefault,
  }
}
