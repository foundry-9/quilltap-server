'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { PromptTemplate } from '../types'

/**
 * Hook for managing prompt templates data and operations
 */
export function usePrompts() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [success, setSuccess] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Async operation hooks
  const fetchOp = useAsyncOperation<PromptTemplate[]>()
  const saveOp = useAsyncOperation<PromptTemplate>()
  const deleteOp = useAsyncOperation<void>()

  /**
   * Fetch all prompt templates from the server
   * Note: Empty dependency array since fetchOp.execute is stable
   */
  const fetchTemplates = useCallback(async () => {
    const result = await fetchOp.execute(async () => {
      const response = await fetchJson<{ templates: PromptTemplate[]; count: number }>('/api/v1/prompt-templates')
      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch templates')
      }
      return response.data?.templates || []
    })
    if (result) {
      setTemplates(result)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // fetchOp.execute is stable (empty deps in useAsyncOperation)

  /**
   * Save a template (create or update)
   * Note: Empty dependency array since saveOp.execute is stable
   */
  const saveTemplate = useCallback(
    async (formData: { name: string; content: string; description: string }, editingId?: string) => {

      const result = await saveOp.execute(async () => {
        if (editingId) {
          // Update existing template
          const response = await fetchJson<{ template: PromptTemplate }>(
            `/api/v1/prompt-templates/${editingId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(formData),
            }
          )

          if (!response.ok) {
            throw new Error(response.error || 'Failed to update template')
          }

          if (!response.data?.template) {
            throw new Error('No data returned from server')
          }

          return response.data.template
        } else {
          // Create new template
          const response = await fetchJson<{ template: PromptTemplate }>('/api/v1/prompt-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
          })

          if (!response.ok) {
            throw new Error(response.error || 'Failed to create template')
          }

          if (!response.data?.template) {
            throw new Error('No data returned from server')
          }

          return response.data.template
        }
      })

      if (result) {
        if (editingId) {
          // Update existing in list
          setTemplates(prev => prev.map(t => (t.id === result.id ? result : t)))
          setSuccess('Template updated successfully')
        } else {
          // Add new to list
          setTemplates(prev => [...prev, result])
          setSuccess('Template created successfully')
        }

        setTimeout(() => setSuccess(null), 3000)
        return result
      }

      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // saveOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Delete a template
   * Note: Empty dependency array since deleteOp.execute is stable
   */
  const deleteTemplate = useCallback(
    async (templateId: string) => {

      const result = await deleteOp.execute(async () => {
        const response = await fetchJson<void>(`/api/v1/prompt-templates/${templateId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error(response.error || 'Failed to delete template')
        }
      })

      if (result !== null) {
        setTemplates(prev => prev.filter(t => t.id !== templateId))
        setSuccess('Template deleted successfully')
        setDeleteConfirm(null)
        setTimeout(() => setSuccess(null), 3000)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // deleteOp.execute is stable (empty deps in useAsyncOperation)
  )

  /**
   * Copy template content to clipboard
   */
  const copyToClipboard = useCallback(async (template: PromptTemplate) => {
    try {
      await navigator.clipboard.writeText(template.content)
      setCopiedId(template.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard', {
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [])

  /**
   * Clear success message
   */
  const clearSuccess = useCallback(() => {
    setSuccess(null)
  }, [])

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      templates,
      success,
      copiedId,
      deleteConfirm,
      fetchOp,
      saveOp,
      deleteOp,
      fetchTemplates,
      saveTemplate,
      deleteTemplate,
      copyToClipboard,
      clearSuccess,
      setDeleteConfirm,
      setCopiedId,
    }),
    [
      templates,
      success,
      copiedId,
      deleteConfirm,
      fetchOp,
      saveOp,
      deleteOp,
      fetchTemplates,
      saveTemplate,
      deleteTemplate,
      copyToClipboard,
      clearSuccess,
    ]
  )
}
