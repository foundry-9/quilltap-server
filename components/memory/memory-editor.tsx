'use client'

import { useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

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

  const [formData, setFormData] = useState({
    content: memory?.content || '',
    summary: memory?.summary || '',
    keywords: memory?.keywords?.join(', ') || '',
    importance: memory?.importance || 0.5,
  })
  const [saving, setSaving] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
  }

  const handleImportanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, importance: parseFloat(e.target.value) })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const keywords = formData.keywords
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0)

      const payload = {
        content: formData.content,
        summary: formData.summary,
        keywords,
        importance: formData.importance,
        source: 'MANUAL' as const,
      }

      const url = isEditing
        ? `/api/characters/${characterId}/memories/${memory.id}`
        : `/api/characters/${characterId}/memories`

      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save memory')
      }

      showSuccessToast(isEditing ? 'Memory updated' : 'Memory created')
      onSave()
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const importanceLabel = formData.importance >= 0.7
    ? 'High'
    : formData.importance >= 0.4
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

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="summary" className="block text-sm font-medium mb-1 text-foreground">
                Summary *
              </label>
              <input
                type="text"
                id="summary"
                name="summary"
                value={formData.summary}
                onChange={handleChange}
                required
                placeholder="Brief summary of this memory"
                className="qt-input"
              />
              <p className="mt-1 qt-text-xs">
                A short description that will be shown in lists and used for context injection.
              </p>
            </div>

            <div>
              <label htmlFor="content" className="block text-sm font-medium mb-1 text-foreground">
                Full Content *
              </label>
              <textarea
                id="content"
                name="content"
                value={formData.content}
                onChange={handleChange}
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
              <label htmlFor="keywords" className="block text-sm font-medium mb-1 text-foreground">
                Keywords
              </label>
              <input
                type="text"
                id="keywords"
                name="keywords"
                value={formData.keywords}
                onChange={handleChange}
                placeholder="keyword1, keyword2, keyword3"
                className="qt-input"
              />
              <p className="mt-1 qt-text-xs">
                Comma-separated keywords for text-based search.
              </p>
            </div>

            <div>
              <label htmlFor="importance" className="block text-sm font-medium mb-1 text-foreground">
                Importance: {importanceLabel} ({Math.round(formData.importance * 100)}%)
              </label>
              <input
                type="range"
                id="importance"
                name="importance"
                min="0"
                max="1"
                step="0.1"
                value={formData.importance}
                onChange={handleImportanceChange}
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

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="qt-button qt-button-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="qt-button qt-button-primary"
              >
                {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Memory'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
