'use client'

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import {
  CharacterSystemPrompt,
  PromptTemplate,
  SamplePrompt,
  PromptFormData,
} from '../types'

interface UseSystemPromptsReturn {
  prompts: CharacterSystemPrompt[]
  loading: boolean
  error: string | null
  success: string | null
  saving: boolean
  templates: PromptTemplate[]
  samplePrompts: SamplePrompt[]
  loadingTemplates: boolean
  fetchPrompts: () => Promise<void>
  fetchTemplates: () => Promise<void>
  savePrompt: (
    promptData: PromptFormData,
    editingPromptId?: string
  ) => Promise<void>
  deletePrompt: (promptId: string) => Promise<void>
  setDefaultPrompt: (promptId: string) => Promise<void>
  setError: (error: string | null) => void
  setSuccess: (success: string | null) => void
}

export function useSystemPrompts(
  characterId: string
): UseSystemPromptsReturn {
  const [prompts, setPrompts] = useState<CharacterSystemPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [samplePrompts, setSamplePrompts] = useState<SamplePrompt[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)

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
      clientLogger.error('Error fetching templates', {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoadingTemplates(false)
    }
  }, [])

  const savePrompt = useCallback(
    async (promptData: PromptFormData, editingPromptId?: string) => {
      try {
        setSaving(true)
        setError(null)

        if (editingPromptId) {
          // Update existing prompt
          const res = await fetch(
            `/api/characters/${characterId}/prompts/${editingPromptId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(promptData),
            }
          )

          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error || 'Failed to update prompt')
          }

          setSuccess('Prompt updated successfully')
          clientLogger.info('Character prompt updated', {
            promptId: editingPromptId,
          })
        } else {
          // Create new prompt
          const res = await fetch(`/api/characters/${characterId}/prompts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(promptData),
          })

          if (!res.ok) {
            const data = await res.json()
            throw new Error(data.error || 'Failed to create prompt')
          }

          setSuccess('Prompt created successfully')
          clientLogger.info('Character prompt created')
        }

        await fetchPrompts()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        setError(message)
        clientLogger.error('Error saving prompt', { error: message })
      } finally {
        setSaving(false)
      }
    },
    [characterId, fetchPrompts]
  )

  const deletePrompt = useCallback(
    async (promptId: string) => {
      try {
        setSaving(true)
        setError(null)

        const res = await fetch(
          `/api/characters/${characterId}/prompts/${promptId}`,
          {
            method: 'DELETE',
          }
        )

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to delete prompt')
        }

        setSuccess('Prompt deleted successfully')
        await fetchPrompts()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        setError(message)
        clientLogger.error('Error deleting prompt', { error: message })
      } finally {
        setSaving(false)
      }
    },
    [characterId, fetchPrompts]
  )

  const setDefaultPrompt = useCallback(
    async (promptId: string) => {
      try {
        setSaving(true)
        setError(null)

        const res = await fetch(
          `/api/characters/${characterId}/prompts/${promptId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isDefault: true }),
          }
        )

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to set default')
        }

        setSuccess('Default prompt updated')
        await fetchPrompts()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        setError(message)
        clientLogger.error('Error setting default prompt', { error: message })
      } finally {
        setSaving(false)
      }
    },
    [characterId, fetchPrompts]
  )

  return {
    prompts,
    loading,
    error,
    success,
    saving,
    templates,
    samplePrompts,
    loadingTemplates,
    fetchPrompts,
    fetchTemplates,
    savePrompt,
    deletePrompt,
    setDefaultPrompt,
    setError,
    setSuccess,
  }
}
