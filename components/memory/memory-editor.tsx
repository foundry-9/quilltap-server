'use client'

import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { FormActions } from '@/components/ui/FormActions'
import { clientLogger } from '@/lib/client-logger'

interface Tag {
  id: string
  name: string
}

interface Memory {
  id: string
  characterId: string
  content: string
  summary: string
  keywords: string[]
  tags: string[]
  tagDetails?: Tag[]
  importance: number
  source: 'AUTO' | 'MANUAL'
  createdAt: string
  updatedAt: string
}

interface MemoryEditorProps {
  characterId: string
  memory?: Memory | null
  onClose: () => void
  onSave: () => void
}

export function MemoryEditor({ characterId, memory, onClose, onSave }: MemoryEditorProps) {
  const isEditing = !!memory

  const form = useFormState({
    content: memory?.content || '',
    summary: memory?.summary || '',
    keywords: memory?.keywords?.join(', ') || '',
    importance: memory?.importance || 0.5,
  })

  const { loading: saving, error, execute, clearError } = useAsyncOperation<void>()

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    await execute(async () => {
      clientLogger.debug('Memory editor submitting form', {
        isEditing,
        characterId,
        memoryId: memory?.id,
      })

      const keywords = form.formData.keywords
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0)

      const payload = {
        content: form.formData.content,
        summary: form.formData.summary,
        keywords,
        importance: form.formData.importance,
        source: 'MANUAL' as const,
      }

      const url = isEditing
        ? `/api/characters/${characterId}/memories/${memory.id}`
        : `/api/characters/${characterId}/memories`

      const result = await fetchJson<{ id: string }>(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        clientLogger.error('Failed to save memory', {
          status: result.status,
          error: result.error,
        })
        throw new Error(result.error || 'Failed to save memory')
      }

      clientLogger.debug('Memory saved successfully', {
        isEditing,
        memoryId: result.data?.id,
      })

      showSuccessToast(isEditing ? 'Memory updated' : 'Memory created')
      onSave()
    })
  }

  const handleSubmitClick = () => {
    handleFormSubmit(new Event('submit') as any)
  }

  const importanceLabel = form.formData.importance >= 0.7
    ? 'High'
    : form.formData.importance >= 0.4
      ? 'Medium'
      : 'Low'

  return (
    <div className="qt-dialog-overlay p-4">
      <div className="qt-dialog max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="qt-dialog-header">
          <div className="flex items-center justify-between">
            <h2 className="qt-dialog-title">
              {isEditing ? 'Edit Memory' : 'Add Memory'}
            </h2>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="qt-dialog-body">
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div>
              <label htmlFor="summary" className="block qt-text-label mb-1">
                Summary *
              </label>
              <input
                type="text"
                id="summary"
                name="summary"
                value={form.formData.summary}
                onChange={form.handleChange}
                required
                placeholder="Brief summary of this memory"
                className="qt-input"
              />
              <p className="mt-1 qt-text-xs">
                A short description that will be shown in lists and used for context injection.
              </p>
            </div>

            <div>
              <label htmlFor="content" className="block qt-text-label mb-1">
                Full Content *
              </label>
              <textarea
                id="content"
                name="content"
                value={form.formData.content}
                onChange={form.handleChange}
                required
                rows={6}
                placeholder="The complete memory content..."
                className="qt-textarea"
              />
              <p className="mt-1 qt-text-xs">
                The full details of what this character should remember.
              </p>
            </div>

            <div>
              <label htmlFor="keywords" className="block qt-text-label mb-1">
                Keywords
              </label>
              <input
                type="text"
                id="keywords"
                name="keywords"
                value={form.formData.keywords}
                onChange={form.handleChange}
                placeholder="keyword1, keyword2, keyword3"
                className="qt-input"
              />
              <p className="mt-1 qt-text-xs">
                Comma-separated keywords for text-based search.
              </p>
            </div>

            <div>
              <label htmlFor="importance" className="block qt-text-label mb-1">
                Importance: {importanceLabel} ({Math.round(form.formData.importance * 100)}%)
              </label>
              <input
                type="range"
                id="importance"
                name="importance"
                min="0"
                max="1"
                step="0.1"
                value={form.formData.importance}
                onChange={form.handleChange}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between qt-text-xs mt-1">
                <span>Low</span>
                <span>Medium</span>
                <span>High</span>
              </div>
              <p className="mt-1 qt-text-xs">
                Higher importance memories are prioritized when building context.
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="pt-4">
              <FormActions
                onCancel={onClose}
                onSubmit={handleSubmitClick}
                submitLabel={isEditing ? 'Save Changes' : 'Create Memory'}
                cancelLabel="Cancel"
                isLoading={saving}
                type="button"
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
