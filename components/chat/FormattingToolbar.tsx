'use client'

import { useEffect, useState, useCallback } from 'react'
import type { AnnotationButton } from '@/lib/schemas/template.types'
import {
  MARKDOWN_FORMATS,
  insertFormat,
  getAnnotationTooltip,
  type MarkdownFormatConfig,
} from '@/lib/chat/annotations'

interface RoleplayTemplateWithAnnotations {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
  annotationButtons?: AnnotationButton[]
}

interface FormattingToolbarProps {
  roleplayTemplateId?: string | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  input: string
  setInput: (value: string) => void
  disabled?: boolean
  /** Whether preview mode is active */
  showPreview?: boolean
  /** Callback to toggle preview mode */
  onTogglePreview?: () => void
}

/**
 * Formatting toolbar for document editing mode.
 *
 * Displays Markdown formatting buttons (bold, italic, headers, lists)
 * and roleplay annotation buttons based on the active template.
 */
export default function FormattingToolbar({
  roleplayTemplateId,
  inputRef,
  input,
  setInput,
  disabled = false,
  showPreview = false,
  onTogglePreview,
}: FormattingToolbarProps) {
  const [template, setTemplate] = useState<RoleplayTemplateWithAnnotations | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)

  // Fetch template info when roleplayTemplateId changes
  useEffect(() => {
    if (!roleplayTemplateId) {
      setTemplate(null)
      return
    }

    const fetchTemplate = async () => {
      try {
        setLoadingTemplate(true)

        const response = await fetch(`/api/v1/roleplay-templates/${roleplayTemplateId}`)
        if (response.ok) {
          const data = await response.json()
          setTemplate(data)
        } else {
          setTemplate(null)
        }
      } catch (error) {
        console.error('[FormattingToolbar] Error fetching template', {
          roleplayTemplateId,
          error: error instanceof Error ? error.message : String(error),
        })
        setTemplate(null)
      } finally {
        setLoadingTemplate(false)
      }
    }

    fetchTemplate()
  }, [roleplayTemplateId])

  // Handle Markdown format button click
  const handleMarkdownClick = useCallback(
    (format: MarkdownFormatConfig) => {
      const textarea = inputRef.current
      if (!textarea) return

      insertFormat(textarea, input, format, setInput)
    },
    [input, inputRef, setInput]
  )

  // Handle annotation button click
  const handleAnnotationClick = useCallback(
    (button: AnnotationButton) => {
      const textarea = inputRef.current
      if (!textarea) return

      insertFormat(textarea, input, button, setInput)
    },
    [input, inputRef, setInput]
  )

  const annotationButtons = template?.annotationButtons ?? []
  const hasAnnotations = !loadingTemplate && annotationButtons.length > 0

  return (
    <div className="qt-formatting-toolbar">
      {/* Markdown buttons - always shown */}
      <div className="qt-formatting-toolbar-section">
        {MARKDOWN_FORMATS.map((format) => (
          <button
            key={format.type}
            type="button"
            onClick={() => handleMarkdownClick(format)}
            disabled={disabled}
            className={`qt-formatting-button qt-formatting-button-${format.type}`}
            title={`Insert ${format.label}`}
          >
            {format.label}
          </button>
        ))}
      </div>

      {/* RP template buttons - only shown when template has annotation buttons */}
      {hasAnnotations && (
        <>
          <div className="qt-formatting-toolbar-divider" />
          <div className="qt-formatting-toolbar-section">
            {annotationButtons.map((button, index) => (
              <button
                key={`${button.abbrev}-${index}`}
                type="button"
                onClick={() => handleAnnotationClick(button)}
                disabled={disabled}
                className="qt-rp-annotation-button"
                title={getAnnotationTooltip(button)}
              >
                {button.abbrev}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Preview toggle - always at the end */}
      {onTogglePreview && (
        <>
          <div className="qt-formatting-toolbar-divider" />
          <div className="qt-formatting-toolbar-section">
            <button
              type="button"
              onClick={onTogglePreview}
              disabled={disabled}
              className={`qt-formatting-button qt-formatting-button-preview ${showPreview ? 'qt-formatting-button-preview-active' : ''}`}
              title={showPreview ? 'Switch to edit mode' : 'Preview message'}
              aria-label={showPreview ? 'Switch to edit mode' : 'Preview message'}
              aria-pressed={showPreview}
            >
              {showPreview ? (
                // Edit icon when preview is active
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              ) : (
                // Eye icon when in edit mode
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
