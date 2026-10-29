'use client'

import { useId, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { showSuccessToast } from '@/lib/toast'
import { FormActions } from '@/components/ui/FormActions'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { importanceBand } from '@/lib/memory/scoring/importance'

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
  source: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
  keystone?: boolean
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
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const handleFocusKeyDown = useDialogFocus(dialogRef, true)
  useEscapeKey(onClose, true)

  const form = useFormState({
    content: memory?.content || '',
    summary: memory?.summary || '',
    keywords: memory?.keywords?.join(', ') || '',
    importance: memory?.importance || 0.5,
    keystone: memory?.keystone ?? false,
  })

  const { loading: saving, error, execute, clearError } = useAsyncOperation<void>()

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    await execute(async () => {
      const keywords = form.formData.keywords
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0)

      const payload = {
        characterId,
        content: form.formData.content,
        summary: form.formData.summary,
        keywords,
        importance: form.formData.importance,
        keystone: form.formData.keystone,
      }

      const url = isEditing
        ? `/api/v1/memories/${memory.id}`
        : `/api/v1/memories`

      const result = await fetchJson<{ memory?: { id: string }; action?: string }>(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        console.error('Failed to save memory', {
          status: result.status,
          error: result.error,
        })
        throw new Error(result.error || 'Failed to save memory')
      }

      // A new memory that admission folded into an existing one comes back as
      // 200 with admission's action rather than 201.
      const merged = !isEditing && result.status === 200
      showSuccessToast(
        isEditing ? 'Memory updated' : merged ? 'Already on file — the existing memory has been reinforced instead' : 'Memory created'
      )
      onSave()
    })
  }

  const handleSubmitClick = () => {
    handleFormSubmit(new Event('submit') as any)
  }

  const band = importanceBand(form.formData.importance)
  const importanceLabel = band === 'high' ? 'High' : band === 'medium' ? 'Medium' : 'Low'

  return (
    <div className="qt-dialog-overlay p-4">
      <div
        className="qt-dialog max-w-2xl max-h-[90vh] overflow-y-auto"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleFocusKeyDown}
      >
        <div className="qt-dialog-header">
          <div className="flex items-center justify-between">
            <h2 id={titleId} className="qt-dialog-title">
              {isEditing ? 'Edit Memory' : 'Add Memory'}
            </h2>
            <button
              aria-label="Close"
              onClick={onClose}
              className="qt-text-secondary hover:text-foreground"
            >
              <Icon name="close" className="w-6 h-6" />
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
              <p className="mb-2 qt-text-xs">
                The full details of what this character should remember.
              </p>
              <MarkdownLexicalEditor
                value={form.formData.content}
                onChange={(value) => form.handleChange({
                  target: { name: 'content', value },
                } as unknown as React.ChangeEvent<HTMLTextAreaElement>)}
                remountKey={memory?.id ?? 'new'}
                namespace="MemoryEditor.content"
                ariaLabel="Memory content"
                minHeight="10rem"
              />
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
                className="qt-range w-full"
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

            <div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="keystone"
                  name="keystone"
                  checked={form.formData.keystone}
                  onChange={form.handleChange}
                  className="qt-checkbox mt-0.5"
                />
                <span>
                  <span className="block qt-text-label">Keystone — always remembered</span>
                  <span className="block qt-text-xs">
                    A standing fact, set in stone until you yourself chip it out. Whenever its subject is in the
                    room, in the character&apos;s own circle, or is the character themself, it is recalled in full,
                    and no tidying of the Book will ever fold, digest or shelve it. Five to a subject, at most.
                  </span>
                </span>
              </label>
            </div>

            {error && (
              <div className="rounded-md qt-bg-destructive/10 p-3">
                <p className="text-sm qt-text-destructive">{error}</p>
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
