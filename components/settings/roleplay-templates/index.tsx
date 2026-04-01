'use client'

import { useRoleplayTemplates } from './hooks/useRoleplayTemplates'
import { TemplateCard } from './TemplateCard'

export default function RoleplayTemplatesTab() {
  const {
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
  } = useRoleplayTemplates()

  const builtInTemplates = templates.filter(t => t.isBuiltIn)
  const userTemplates = templates.filter(t => !t.isBuiltIn)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading templates...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="qt-bg-destructive/10 border qt-border-destructive rounded p-4 qt-text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="qt-bg-success/10 border qt-border-success rounded p-4 qt-text-success">
          {success}
        </div>
      )}

      {/* Default Template Section */}
      <section className="border border-border rounded-lg p-4 bg-card">
        <h2 className="text-lg font-semibold mb-2">Default Template</h2>
        <p className="qt-text-small mb-4">
          This template will be applied to all new chats by default. You can override it per-character or per-chat.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-md">
            <label className="qt-label mb-1">
              Template for New Chats
            </label>
            <select
              value={defaultTemplateId || ''}
              onChange={(e) => handleDefaultTemplateChange(e.target.value || null)}
              disabled={defaultSaving || loading}
              className="qt-select"
            >
              <option value="">None (no formatting template)</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
                </option>
              ))}
            </select>
          </div>
          {defaultSaving && (
            <span className="qt-text-small">Saving...</span>
          )}
        </div>
      </section>

      {/* Built-in Templates Section */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Built-in Templates</h2>
        <p className="qt-text-small mb-4">
          These templates are provided by Quilltap and cannot be modified. You can copy them to create your own version.
        </p>

        {builtInTemplates.length === 0 ? (
          <div className="qt-text-small border border-dashed border-border rounded-lg p-4">
            No built-in templates available.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {builtInTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isBuiltIn={true}
                onPreview={setPreviewTemplate}
                onCopyAsNew={handleCopyAsNew}
              />
            ))}
          </div>
        )}
      </section>

      {/* User Templates Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">My Templates</h2>
            <p className="qt-text-small mt-1">
              Custom templates you&apos;ve created for your roleplay sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Create Template
          </button>
        </div>

        {userTemplates.length === 0 ? (
          <div className="qt-text-small border border-dashed border-border rounded-lg p-4">
            No custom templates yet. Create one to define your own roleplay formatting style.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {userTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isBuiltIn={false}
                onPreview={setPreviewTemplate}
                onEdit={openEditModal}
                onDelete={() => setDeleteConfirm(template.id)}
                deleteConfirm={deleteConfirm}
                onConfirmDelete={handleDelete}
                onCancelDelete={() => setDeleteConfirm(null)}
                saving={saving}
              />
            ))}
          </div>
        )}
      </section>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="qt-label mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    maxLength={100}
                    placeholder="My Custom RP Style"
                    className="qt-input w-full"
                  />
                  <p className="qt-text-xs mt-1">
                    {formData.name.length}/100 characters
                  </p>
                </div>

                <div>
                  <label className="qt-label mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    maxLength={500}
                    placeholder="A brief description of what this template does"
                    className="qt-input w-full"
                  />
                  <p className="qt-text-xs mt-1">
                    {formData.description.length}/500 characters
                  </p>
                </div>

                <div>
                  <label className="qt-label mb-1">
                    System Prompt <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={formData.systemPrompt}
                    onChange={(e) => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    rows={12}
                    placeholder="Enter the formatting instructions that will be prepended to character system prompts..."
                    className="qt-textarea w-full font-mono text-sm"
                  />
                  <p className="qt-text-xs mt-1">
                    This will be prepended to the character&apos;s system prompt when this template is selected.
                    You can use placeholders like {'{{char}}'} and {'{{user}}'}.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !formData.name.trim() || !formData.systemPrompt.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Save Changes' : 'Create Template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">{previewTemplate.name}</h2>
                  {previewTemplate.description && (
                    <p className="qt-text-small mt-1">
                      {previewTemplate.description}
                    </p>
                  )}
                </div>
                {previewTemplate.isBuiltIn && (
                  <span className="px-2 py-0.5 qt-text-label-xs bg-primary/10 text-primary rounded">
                    Built-in
                  </span>
                )}
              </div>

              <div className="border border-border rounded-lg p-4 bg-muted/30">
                <h3 className="qt-text-small font-medium mb-2">System Prompt</h3>
                <pre className="whitespace-pre-wrap text-sm text-foreground font-mono">
                  {previewTemplate.systemPrompt}
                </pre>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                {previewTemplate.isBuiltIn && (
                  <button
                    type="button"
                    onClick={() => {
                      handleCopyAsNew(previewTemplate)
                      setPreviewTemplate(null)
                    }}
                    className="px-4 py-2 text-sm rounded-md border border-border hover:bg-accent"
                  >
                    Copy as New
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewTemplate(null)}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
