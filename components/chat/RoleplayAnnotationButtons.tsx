'use client'

import { useEffect, useState, useCallback } from 'react'

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

interface RoleplayAnnotationButtonsProps {
  roleplayTemplateId: string | null | undefined
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  input: string
  setInput: (value: string) => void
  disabled?: boolean
}

type AnnotationType = 'narration' | 'internal' | 'ooc'

interface AnnotationConfig {
  label: string
  type: AnnotationType
  prefix: string
  suffix: string
}

// Standard template annotations
const STANDARD_ANNOTATIONS: AnnotationConfig[] = [
  { label: 'Narration', type: 'narration', prefix: '*', suffix: '*' },
  { label: 'OOC', type: 'ooc', prefix: '((', suffix: '))' },
]

// Quilltap RP template annotations
const QUILLTAP_RP_ANNOTATIONS: AnnotationConfig[] = [
  { label: 'Narration', type: 'narration', prefix: '[', suffix: ']' },
  { label: 'Internal', type: 'internal', prefix: '{', suffix: '}' },
  { label: 'OOC', type: 'ooc', prefix: '// ', suffix: '' },
]

export default function RoleplayAnnotationButtons({
  roleplayTemplateId,
  inputRef,
  input,
  setInput,
  disabled = false,
}: RoleplayAnnotationButtonsProps) {
  const [template, setTemplate] = useState<RoleplayTemplate | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch template info when roleplayTemplateId changes
  useEffect(() => {
    if (!roleplayTemplateId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch with dependency tracking
      setTemplate(null)
      return
    }

    const fetchTemplate = async () => {
      try {
        setLoading(true)

        const response = await fetch(`/api/v1/roleplay-templates/${roleplayTemplateId}`)
        if (response.ok) {
          const data = await response.json()
          setTemplate(data)
        } else {
          setTemplate(null)
        }
      } catch (error) {
        console.error('[RoleplayAnnotationButtons] Error fetching template', {
          roleplayTemplateId,
          error: error instanceof Error ? error.message : String(error),
        })
        setTemplate(null)
      } finally {
        setLoading(false)
      }
    }

    fetchTemplate()
  }, [roleplayTemplateId])

  // Get annotations based on template type
  const getAnnotations = useCallback((): AnnotationConfig[] => {
    if (!template) return []

    // Match by name since these are the built-in templates
    if (template.name === 'Standard') {
      return STANDARD_ANNOTATIONS
    } else if (template.name === 'Quilltap RP') {
      return QUILLTAP_RP_ANNOTATIONS
    }

    // For custom templates, default to standard annotations
    return STANDARD_ANNOTATIONS
  }, [template])

  // Insert annotation at cursor position
  const insertAnnotation = useCallback(
    (config: AnnotationConfig) => {
      const textarea = inputRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = input.substring(start, end)

      // Build the new text
      const before = input.substring(0, start)
      const after = input.substring(end)
      const wrapped = config.prefix + selectedText + config.suffix
      const newValue = before + wrapped + after

      setInput(newValue)

      // Calculate new cursor position
      // If text was selected, place cursor after the wrapped text
      // If no selection, place cursor between prefix and suffix
      const newCursorPos = selectedText
        ? start + wrapped.length
        : start + config.prefix.length

      // Focus and set cursor position after React updates the value
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      }, 0)
    },
    [input, inputRef, setInput]
  )

  const annotations = getAnnotations()

  // Don't render if no template or no annotations
  if (!roleplayTemplateId || !template || annotations.length === 0 || loading) {
    return null
  }

  return (
    <div className="qt-rp-annotation-toolbar">
      <span className="qt-text-xs mr-2">Insert:</span>
      {annotations.map((config) => (
        <button
          key={config.type}
          type="button"
          onClick={() => insertAnnotation(config)}
          disabled={disabled}
          className={`qt-rp-annotation-button qt-rp-annotation-button-${config.type}`}
          title={`Insert ${config.label.toLowerCase()} notation (${config.prefix}...${config.suffix || 'end of line'})`}
        >
          {config.label}
        </button>
      ))}
    </div>
  )
}
