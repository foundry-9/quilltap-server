'use client'

import { PromptTemplate, SamplePrompt } from './types'

interface ImportModalProps {
  isOpen: boolean
  templates: PromptTemplate[]
  samplePrompts: SamplePrompt[]
  loading: boolean
  onClose: () => void
  onImport: (content: string, suggestedName: string) => void
}

export function ImportModal({
  isOpen,
  templates,
  samplePrompts,
  loading,
  onClose,
  onImport,
}: ImportModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="qt-dialog w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-foreground">
              Import from Template
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="qt-button-icon qt-button-ghost"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading templates...
            </div>
          ) : (
            <div className="space-y-6">
              {/* Sample Prompts */}
              {samplePrompts.length > 0 && (
                <div>
                  <h4 className="text-sm qt-text-primary mb-3">
                    Sample Prompts
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {samplePrompts.map((sample) => (
                      <button
                        type="button"
                        key={sample.filename}
                        onClick={() =>
                          onImport(sample.content, sample.name)
                        }
                        className="qt-button-ghost w-full p-3 text-left justify-start"
                      >
                        <div className="w-full">
                          <div className="flex items-center justify-between">
                            <span className="qt-text-primary">
                              {sample.name}
                            </span>
                            <span className="qt-badge">
                              {sample.modelHint}
                            </span>
                          </div>
                          <p className="qt-text-xs mt-1">
                            {sample.category} prompt
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* User Templates */}
              {templates.length > 0 && (
                <div>
                  <h4 className="text-sm qt-text-primary mb-3">
                    {samplePrompts.length > 0 ? 'My Templates' : 'Templates'}
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {templates
                      .filter((t) => !t.isBuiltIn)
                      .map((template) => (
                        <button
                          type="button"
                          key={template.id}
                          onClick={() =>
                            onImport(template.content, template.name)
                          }
                          className="qt-button-ghost w-full p-3 text-left justify-start"
                        >
                          <div className="w-full">
                            <span className="qt-text-primary">
                              {template.name}
                            </span>
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

              {samplePrompts.length === 0 && templates.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  No templates available. Create templates in Settings &gt;
                  Prompts.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
