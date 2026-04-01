'use client'

import { useSystemPrompts } from './hooks/useSystemPrompts'
import { SystemPromptsEditorProps, PromptFormData } from './types'
import { PromptList } from './PromptList'
import { PromptModal } from './PromptModal'
import { ImportModal } from './ImportModal'
import { PreviewModal } from './PreviewModal'

/**
 * Main SystemPromptsEditor component for managing character system prompts
 */
export function SystemPromptsEditor({
  characterId,
  characterName,
  onUpdate,
}: SystemPromptsEditorProps) {
  const editor = useSystemPrompts(characterId, onUpdate)

  const handleFormChange = (field: keyof PromptFormData, value: string | boolean) => {
    editor.setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  if (editor.loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading prompts...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-foreground">System Prompts</h3>
          <p className="qt-text-small">
            Manage multiple system prompts for {characterName}. Select which one to use when creating or configuring a chat.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={editor.openImportModal}
            className="qt-button-secondary"
          >
            Import Template
          </button>
          <button
            type="button"
            onClick={editor.openCreateModal}
            className="qt-button-primary"
          >
            + Add Prompt
          </button>
        </div>
      </div>

      {/* Messages */}
      {editor.error && (
        <div className="qt-alert-error">
          {editor.error}
        </div>
      )}
      {editor.success && (
        <div className="qt-alert-success">
          {editor.success}
        </div>
      )}

      {/* Prompts List */}
      <PromptList
        prompts={editor.prompts}
        onPreview={editor.setPreviewPrompt}
        onEdit={editor.openEditModal}
        onSetDefault={editor.handleSetDefault}
        onDeleteToggle={editor.setDeleteConfirm}
        onDelete={editor.handleDelete}
        deleteConfirm={editor.deleteConfirm}
        saving={editor.saving}
        onCreateClick={editor.openCreateModal}
        onImportClick={editor.openImportModal}
      />

      {/* Create/Edit Modal */}
      <PromptModal
        isOpen={editor.isModalOpen}
        editingPrompt={editor.editingPrompt}
        formData={editor.formData}
        showPreview={editor.showPreview}
        saving={editor.saving}
        onClose={editor.closeModal}
        onSave={editor.handleSave}
        onFormChange={handleFormChange}
        onPreviewToggle={() => editor.setShowPreview(!editor.showPreview)}
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={editor.showImportModal}
        loading={editor.loadingTemplates}
        templates={editor.templates}
        samplePrompts={editor.samplePrompts}
        onClose={() => editor.setShowImportModal(false)}
        onImport={editor.handleImport}
      />

      {/* Preview Modal */}
      <PreviewModal
        prompt={editor.previewPrompt}
        onClose={() => editor.setPreviewPrompt(null)}
        onEdit={editor.openEditModal}
      />
    </div>
  )
}
