'use client'

import { BaseModal } from '@/components/ui/BaseModal'
import { PromptTemplate } from './types'

interface ImportModalProps {
  isOpen: boolean
  loading: boolean
  templates: PromptTemplate[]
  onClose: () => void
  onImport: (content: string, suggestedName: string) => void
}

export function ImportModal({
  isOpen,
  loading,
  templates,
  onClose,
  onImport,
}: ImportModalProps) {
  const sampleTemplates = templates.filter(t => t.isBuiltIn)
  const userTemplates = templates.filter(t => !t.isBuiltIn)

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Import from Template"
      maxWidth="2xl"
      showCloseButton={true}
    >
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading templates...</div>
      ) : (
        <div className="space-y-6">
          {/* Sample Prompts (built-in templates) */}
          {sampleTemplates.length > 0 && (
            <div>
              <h4 className="text-sm qt-text-primary mb-3">Sample Prompts</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {sampleTemplates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    onClick={() => onImport(template.content, template.name)}
                    className="qt-button-ghost w-full p-3 text-left justify-start"
                  >
                    <div className="w-full">
                      <div className="flex items-center justify-between">
                        <span className="qt-text-primary">{template.name}</span>
                        <div className="flex gap-1">
                          {template.category && (
                            <span className="qt-badge-secondary">
                              {template.category}
                            </span>
                          )}
                          {template.modelHint && (
                            <span className="qt-badge">
                              {template.modelHint}
                            </span>
                          )}
                        </div>
                      </div>
                      {template.description && (
                        <p className="qt-text-xs mt-1">
                          {template.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* User Templates */}
          {userTemplates.length > 0 && (
            <div>
              <h4 className="text-sm qt-text-primary mb-3">
                {sampleTemplates.length > 0 ? 'My Templates' : 'Templates'}
              </h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {userTemplates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    onClick={() => onImport(template.content, template.name)}
                    className="qt-button-ghost w-full p-3 text-left justify-start"
                  >
                    <div className="w-full">
                      <span className="qt-text-primary">{template.name}</span>
                      {template.description && (
                        <p className="qt-text-xs mt-1">
                          {template.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {sampleTemplates.length === 0 && userTemplates.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              No templates available. Create templates in Settings &gt; Prompts.
            </p>
          )}
        </div>
      )}
    </BaseModal>
  )
}
