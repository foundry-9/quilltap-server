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
    </div>
  )
}
