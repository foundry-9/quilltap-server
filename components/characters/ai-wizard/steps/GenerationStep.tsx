'use client'

/**
 * Generation Step
 *
 * Step 4: Show generation progress, results, and apply option.
 */

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { GeneratableField, GenerationProgress, GeneratedCharacterData } from '../types'
import { FIELD_LABELS } from '../types'

interface GenerationStepProps {
  generating: boolean
  progress: GenerationProgress
  generatedData: GeneratedCharacterData | null
  selectedFields: Set<GeneratableField>
  onGenerate: () => void
  onApply: () => void
  error: string | null
}

export function GenerationStep({
  generating,
  progress,
  generatedData,
  selectedFields,
  onGenerate,
  onApply,
  error,
}: GenerationStepProps) {
  const [expandedField, setExpandedField] = useState<GeneratableField | null>(null)

  // Check if generation is complete
  const isComplete = generatedData !== null && !generating

  // Get content for a field
  const getFieldContent = (field: GeneratableField): string | null => {
    if (!generatedData) return null

    if (field === 'physicalDescription') {
      if (generatedData.physicalDescription) {
        return generatedData.physicalDescription.fullDescription || 'Physical description generated'
      }
      return null
    }

    return generatedData[field] || null
  }

  // Render field preview
  const renderFieldPreview = (field: GeneratableField) => {
    const content = getFieldContent(field)
    if (!content) return null

    const isExpanded = expandedField === field
    const isLong = content.length > 200

    if (field === 'physicalDescription' && generatedData?.physicalDescription) {
      const pd = generatedData.physicalDescription
      return (
        <div className="mt-2 space-y-3">
          <div className="text-xs text-muted-foreground">
            <strong>Short prompt:</strong> {pd.shortPrompt.substring(0, 100)}...
          </div>
          {isExpanded && (
            <div className="space-y-2 text-sm">
              <div>
                <strong className="text-foreground">Short ({pd.shortPrompt.length} chars):</strong>
                <p className="text-muted-foreground">{pd.shortPrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Medium ({pd.mediumPrompt.length} chars):</strong>
                <p className="text-muted-foreground">{pd.mediumPrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Long ({pd.longPrompt.length} chars):</strong>
                <p className="text-muted-foreground">{pd.longPrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Complete ({pd.completePrompt.length} chars):</strong>
                <p className="text-muted-foreground">{pd.completePrompt}</p>
              </div>
              <div>
                <strong className="text-foreground">Full Description:</strong>
                <div className="prose prose-sm dark:prose-invert max-w-none mt-1">
                  <ReactMarkdown>{pd.fullDescription}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="mt-2">
        <div className="text-sm text-muted-foreground whitespace-pre-wrap">
          {isExpanded || !isLong ? content : `${content.substring(0, 200)}...`}
        </div>
      </div>
    )
  }

  // Not yet started
  if (!generating && !generatedData) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Ready to Generate
          </h3>
          <p className="text-sm text-muted-foreground">
            Click the button below to start generating content for your character.
          </p>
        </div>

        {/* Selected fields summary */}
        <div className="p-4 rounded-lg border border-border bg-muted/20">
          <h4 className="font-medium text-foreground mb-2">Fields to Generate</h4>
          <ul className="space-y-1">
            {Array.from(selectedFields).map((field) => (
              <li key={field} className="flex items-center gap-2 text-sm text-muted-foreground">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                </svg>
                <span>{FIELD_LABELS[field]}</span>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div className="qt-alert-error">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onGenerate}
          className="w-full qt-button-primary py-3"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Character Content
          </span>
        </button>
      </div>
    )
  }

  // Generating
  if (generating) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Generating Content...
          </h3>
          <p className="text-sm text-muted-foreground">
            Please wait while the AI generates your character content.
          </p>
        </div>

        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-4">
            <svg className="w-12 h-12 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-muted-foreground">
              {progress.currentField
                ? `Generating ${FIELD_LABELS[progress.currentField]}...`
                : 'Starting generation...'}
            </p>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="space-y-2">
          {Array.from(selectedFields).map((field) => {
            const isCompleted = progress.completedFields.includes(field)
            const isCurrent = progress.currentField === field
            const hasError = !!progress.errors[field]
            const snippet = progress.snippets?.[field]

            return (
              <div
                key={field}
                className={`rounded-lg border transition-all ${
                  isCompleted
                    ? 'border-green-500/50 bg-green-500/10'
                    : hasError
                    ? 'border-destructive/50 bg-destructive/10'
                    : isCurrent
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-muted/20'
                }`}
              >
                <div className="flex items-center gap-3 p-3">
                  {isCompleted ? (
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : hasError ? (
                    <svg className="w-5 h-5 text-destructive flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : isCurrent ? (
                    <svg className="w-5 h-5 text-primary animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={2} />
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {FIELD_LABELS[field]}
                    </span>
                    {/* Show snippet for completed fields */}
                    {isCompleted && snippet && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {snippet}
                      </p>
                    )}
                    {/* Show error message */}
                    {hasError && (
                      <p className="text-xs text-destructive mt-1">
                        {progress.errors[field]}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Complete
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
          <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Generation Complete
        </h3>
        <p className="text-sm text-muted-foreground">
          Review the generated content below. Click on a field to expand it.
        </p>
      </div>

      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {/* Generated content */}
      <div className="space-y-2">
        {Array.from(selectedFields).map((field) => {
          const content = getFieldContent(field)
          const hasError = !!progress.errors[field]
          const isExpanded = expandedField === field

          return (
            <div
              key={field}
              className={`rounded-lg border transition-colors ${
                hasError
                  ? 'border-destructive/50 bg-destructive/10'
                  : content
                  ? 'border-green-500/50 bg-green-500/5'
                  : 'border-border bg-muted/20'
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedField(isExpanded ? null : field)}
                className="w-full flex items-center justify-between p-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {content ? (
                    <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : hasError ? (
                    <svg className="w-5 h-5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={2} />
                    </svg>
                  )}
                  <span className="font-medium text-foreground">{FIELD_LABELS[field]}</span>
                </div>
                <svg
                  className={`w-5 h-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-border/50 pt-3">
                  {hasError ? (
                    <p className="text-sm text-destructive">{progress.errors[field]}</p>
                  ) : content ? (
                    renderFieldPreview(field)
                  ) : (
                    <p className="text-sm text-muted-foreground">No content generated</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Apply button */}
      <button
        type="button"
        onClick={onApply}
        className="w-full qt-button-primary py-3"
      >
        <span className="flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Apply to Character
        </span>
      </button>
    </div>
  )
}
