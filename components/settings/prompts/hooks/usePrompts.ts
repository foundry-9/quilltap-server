'use client'

import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { usePromptTemplatesQuery } from '@/lib/hooks/use-profiles'
import { PromptTemplate, TemplateFormData } from '../types'

const NO_TEMPLATES: PromptTemplate[] = []

/**
 * Prompt templates for the Settings card: the shared list
 * (`usePromptTemplatesQuery`) plus save and delete, each of which re-reads it.
 */
export function usePrompts() {
  const queryClient = useQueryClient()
  const [success, setSuccess] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const templatesQuery = usePromptTemplatesQuery<PromptTemplate>()
  const templates = templatesQuery.data ?? NO_TEMPLATES
  const { refetch } = templatesQuery
  const fetchError = templatesQuery.error
    ? apiErrorMessage(templatesQuery.error, 'Failed to fetch templates')
    : null

  const refreshTemplates = () => queryClient.invalidateQueries({ queryKey: queryKeys.promptTemplates.all })

  const saveMutation = useMutation({
    mutationFn: async ({ formData, editingId }: { formData: TemplateFormData; editingId?: string }) => {
      const saved = await apiFetch<{ template?: PromptTemplate }>(
        editingId ? `/api/v1/prompt-templates/${editingId}` : '/api/v1/prompt-templates',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        },
      )
      // A save that answers without the row is a failure, not a quiet success.
      if (!saved.template) throw new Error('No data returned from server')
      return { template: saved.template }
    },
    onSuccess: refreshTemplates,
    onError: (err) => console.error('Failed to save prompt template', { error: apiErrorMessage(err, 'Operation failed') }),
  })

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiFetch(`/api/v1/prompt-templates/${templateId}`, { method: 'DELETE' }),
    onSuccess: refreshTemplates,
    onError: (err) => console.error('Failed to delete prompt template', { error: apiErrorMessage(err, 'Operation failed') }),
  })

  /** Re-read the list (the load error's Retry). */
  const retryFetch = useCallback(() => {
    void refetch()
  }, [refetch])

  /** Save a template (create, or update `editingId`). Resolves the saved row, or null on failure. */
  const saveTemplate = async (formData: TemplateFormData, editingId?: string): Promise<PromptTemplate | null> => {
    try {
      const { template } = await saveMutation.mutateAsync({ formData, editingId })
      setSuccess(editingId ? 'Template updated successfully' : 'Template created successfully')
      setTimeout(() => setSuccess(null), 3000)
      return template
    } catch {
      return null
    }
  }

  const deleteTemplate = async (templateId: string) => {
    try {
      await deleteMutation.mutateAsync(templateId)
      setSuccess('Template deleted successfully')
      setDeleteConfirm(null)
      setTimeout(() => setSuccess(null), 3000)
    } catch {
      // The failure is shown from deleteError.
    }
  }

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

  return {
    templates,
    success,
    copiedId,
    deleteConfirm,
    loading: templatesQuery.isLoading,
    fetchError,
    retryFetch,
    saving: saveMutation.isPending,
    saveError: saveMutation.error ? apiErrorMessage(saveMutation.error, 'Failed to save template') : null,
    /** Forget a failed save (the modal opening or closing starts clean). */
    clearSaveError: saveMutation.reset,
    deleting: deleteMutation.isPending,
    deleteError: deleteMutation.error ? apiErrorMessage(deleteMutation.error, 'Failed to delete template') : null,
    saveTemplate,
    deleteTemplate,
    copyToClipboard,
    setDeleteConfirm,
  }
}
