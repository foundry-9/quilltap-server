'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSystemPrompts } from './hooks/useSystemPrompts'
import { PromptEditor } from './PromptEditor'
import { PromptList } from './PromptList'
import { ImportModal } from './ImportModal'
import { PreviewModal } from './PreviewModal'
import {
  SystemPromptsEditorProps,
  CharacterSystemPrompt,
  PromptFormData,
  INITIAL_FORM_DATA,
} from './types'

export function SystemPromptsEditor({
  characterId,
  characterName,
  onUpdate,
}: SystemPromptsEditorProps) {
  const {
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
  } = useSystemPrompts(characterId)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] =
    useState<CharacterSystemPrompt | null>(null)
  const [formData, setFormData] = useState<PromptFormData>(INITIAL_FORM_DATA)
  const [showImportModal, setShowImportModal] = useState(false)
  const [previewPrompt, setPreviewPrompt] =
    useState<CharacterSystemPrompt | null>(null)

  // Initial fetch
  useEffect(() => {
    fetchPrompts()
  }, [fetchPrompts])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [success, setSuccess])

  const openCreateModal = useCallback(() => {
    setEditingPrompt(null)
    setFormData({
      ...INITIAL_FORM_DATA,
      isDefault: prompts.length === 0, // First prompt is default
    })
    setIsModalOpen(true)
  }, [prompts.length])

  const openEditModal = useCallback((prompt: CharacterSystemPrompt) => {
    setEditingPrompt(prompt)
    setFormData({
      name: prompt.name,
      content: prompt.content,
      isDefault: prompt.isDefault,
    })
    setIsModalOpen(true)
  }, [])

  const openImportModal = useCallback(() => {
    fetchTemplates()
    setShowImportModal(true)
  }, [fetchTemplates])

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingPrompt(null)
    setFormData(INITIAL_FORM_DATA)
  }, [])

  const handleImport = useCallback(
    (content: string, suggestedName: string) => {
      setFormData({
        name: suggestedName,
        content,
        isDefault: prompts.length === 0,
      })
      setShowImportModal(false)
      setIsModalOpen(true)
    },
    [prompts.length]
  )

  const handleSave = useCallback(async () => {
    await savePrompt(formData, editingPrompt?.id)
    closeModal()
    onUpdate?.()
  }, [formData, editingPrompt?.id, savePrompt, closeModal, onUpdate])

  const handleDelete = useCallback(
    async (promptId: string) => {
      await deletePrompt(promptId)
      onUpdate?.()
    },
    [deletePrompt, onUpdate]
  )

  const handleSetDefault = useCallback(
    async (promptId: string) => {
      await setDefaultPrompt(promptId)
      onUpdate?.()
    },
    [setDefaultPrompt, onUpdate]
  )

  if (loading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading prompts...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            System Prompts
          </h3>
          <p className="qt-text-small">
            Manage multiple system prompts for {characterName}. Select which
            one to use when creating or configuring a chat.
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
      {error && <div className="qt-alert-error">{error}</div>}
      {success && <div className="qt-alert-success">{success}</div>}

      {/* Prompts List */}
      {prompts.length === 0 ? (
        <div className="qt-card text-center">
          <p className="qt-text-small mb-4">
            No system prompts yet. Add your first prompt or import from a
            template.
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
        <PromptList
          prompts={prompts}
          saving={saving}
          onEdit={openEditModal}
          onPreview={setPreviewPrompt}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
        />
      )}

      {/* Modals */}
      <PromptEditor
        isOpen={isModalOpen}
        editingPrompt={editingPrompt}
        formData={formData}
        saving={saving}
        onClose={closeModal}
        onSave={handleSave}
        onFormChange={setFormData}
      />

      <ImportModal
        isOpen={showImportModal}
        templates={templates}
        samplePrompts={samplePrompts}
        loading={loadingTemplates}
        onClose={() => setShowImportModal(false)}
        onImport={handleImport}
      />

      <PreviewModal
        prompt={previewPrompt}
        onClose={() => setPreviewPrompt(null)}
        onEdit={openEditModal}
      />
    </div>
  )
}
