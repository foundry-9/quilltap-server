'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import type { LexicalEditor } from 'lexical'
import { FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, $createTextNode, $createParagraphNode, $getRoot } from 'lexical'
import { $isCodeNode, $createCodeNode } from '@lexical/code'
import { $setBlocksType } from '@lexical/selection'
import type { TemplateDelimiter, NarrationDelimiters } from '@/lib/schemas/template.types'
import {
  MARKDOWN_FORMATS,
  getDelimiterTooltip,
  delimiterToPrefixSuffix,
  type MarkdownFormatConfig,
} from '@/lib/chat/annotations'
import {
  INSERT_HEADING_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
} from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import { type HeadingTagType, $createQuoteNode } from '@lexical/rich-text'

interface RoleplayTemplateWithDelimiters {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
  delimiters?: TemplateDelimiter[]
}

interface FormattingToolbarProps {
  roleplayTemplateId?: string | null
  /** Lexical editor instance for dispatching formatting commands */
  editor: LexicalEditor
  disabled?: boolean
  /** Whether preview mode is active */
  showPreview?: boolean
  /** Callback to toggle preview mode */
  onTogglePreview?: () => void
  /** Narration delimiters from the active roleplay template */
  narrationDelimiters?: NarrationDelimiters
}

/**
 * Formatting toolbar for document editing mode.
 *
 * Displays Markdown formatting buttons (bold, italic, headers, lists)
 * and roleplay delimiter buttons based on the active template.
 * Dispatches Lexical commands for formatting.
 */
export default function FormattingToolbar({
  roleplayTemplateId,
  editor,
  disabled = false,
  showPreview = false,
  onTogglePreview,
  narrationDelimiters,
}: FormattingToolbarProps) {
  const [template, setTemplate] = useState<RoleplayTemplateWithDelimiters | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [inCodeBlock, setInCodeBlock] = useState(false)

  // Track whether the cursor is inside a code block
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          setInCodeBlock(false)
          return
        }
        const anchorNode = selection.anchor.getNode()
        const parent = anchorNode.getParent()
        setInCodeBlock(parent !== null && $isCodeNode(parent))
      })
    })
  }, [editor])

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

  // Handle Markdown format button click — dispatch Lexical commands
  // Uses editor.update() to ensure selection context is available
  const handleMarkdownClick = useCallback(
    (format: MarkdownFormatConfig) => {
      editor.update(() => {
        // Ensure there's a selection — if the editor hasn't been focused yet,
        // $getSelection() returns null. Select the end of the first block.
        let selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          const root = $getRoot()
          const firstChild = root.getFirstChild()
          if (firstChild) {
            firstChild.selectEnd()
            selection = $getSelection()
          }
          if (!$isRangeSelection(selection)) return
        }

        switch (format.type) {
          case 'bold':
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
            break
          case 'italic':
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')
            break
          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6':
            editor.dispatchCommand(INSERT_HEADING_COMMAND, format.type as HeadingTagType)
            break
          case 'ul':
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
            break
          case 'ol':
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
            break
          case 'blockquote':
            $setBlocksType(selection, () => $createQuoteNode())
            break
        }
      })
      editor.focus()
    },
    [editor]
  )

  // Handle code block toggle
  const handleCodeBlockClick = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return

      // With a non-collapsed selection, toggle inline code formatting
      if (!selection.isCollapsed()) {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code')
        return
      }

      // Collapsed cursor: toggle code block
      const anchorNode = selection.anchor.getNode()
      const codeBlock = anchorNode.getParent()

      if (codeBlock && $isCodeNode(codeBlock)) {
        // Exit the code block: convert its text content to a paragraph
        const text = codeBlock.getTextContent()
        const paragraph = $createParagraphNode()
        if (text) {
          paragraph.append($createTextNode(text))
        }
        codeBlock.replace(paragraph)
        paragraph.selectEnd()
      } else {
        // Enter a code block: convert current block to CodeNode
        $setBlocksType(selection, () => $createCodeNode())
      }
    })
    editor.focus()
  }, [editor])

  // Prevent toolbar buttons from stealing focus/selection from the editor
  const preventFocusLoss = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  // Handle delimiter button click — wrap/unwrap selection, or insert at cursor
  const handleDelimiterClick = useCallback(
    (delimiter: TemplateDelimiter) => {
      const { prefix, suffix } = delimiterToPrefixSuffix(delimiter)
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const selectedText = selection.getTextContent()
        if (selectedText) {
          // Toggle: unwrap if already wrapped, wrap if not
          if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix)) {
            const inner = selectedText.slice(prefix.length, selectedText.length - suffix.length)
            selection.insertRawText(inner)
          } else {
            selection.insertRawText(`${prefix}${selectedText}${suffix}`)
          }
        } else {
          // No selection: insert delimiters with cursor between them
          selection.insertRawText(`${prefix}${suffix}`)
          // Reposition cursor between the delimiters
          const updatedSelection = $getSelection()
          if ($isRangeSelection(updatedSelection)) {
            const nodes = updatedSelection.getNodes()
            if (nodes.length > 0) {
              const lastNode = nodes[nodes.length - 1]
              if (lastNode.getType() === 'text') {
                const cursorPos = lastNode.getTextContentSize() - suffix.length
                updatedSelection.setTextNodeRange(
                  lastNode as import('lexical').TextNode,
                  cursorPos,
                  lastNode as import('lexical').TextNode,
                  cursorPos,
                )
              }
            }
          }
        }
      })
      editor.focus()
    },
    [editor]
  )

  // Build the narration button from delimiters, and filter out any template
  // delimiter buttons whose delimiters match the narration delimiters
  const { narrationButton, filteredDelimiters } = useMemo(() => {
    if (!narrationDelimiters) {
      return {
        narrationButton: null,
        filteredDelimiters: template?.delimiters ?? [],
      }
    }

    const narPrefix = Array.isArray(narrationDelimiters) ? narrationDelimiters[0] : narrationDelimiters
    const narSuffix = Array.isArray(narrationDelimiters) ? narrationDelimiters[1] : narrationDelimiters

    const btn: TemplateDelimiter = {
      name: 'Narration',
      buttonName: 'Nar',
      delimiters: narrationDelimiters,
      style: 'qt-chat-narration',
    }

    // Remove any template delimiter whose delimiters match the narration delimiters
    const filtered = (template?.delimiters ?? []).filter((d) => {
      const { prefix, suffix } = delimiterToPrefixSuffix(d)
      return prefix !== narPrefix || suffix !== narSuffix
    })

    return { narrationButton: btn, filteredDelimiters: filtered }
  }, [narrationDelimiters, template])

  const allDelimiters = narrationButton
    ? [narrationButton, ...filteredDelimiters]
    : filteredDelimiters
  const hasDelimiters = !loadingTemplate && allDelimiters.length > 0

  return (
    <div className="qt-formatting-toolbar">
      {/* Markdown buttons - always shown */}
      <div className="qt-formatting-toolbar-section">
        {MARKDOWN_FORMATS.map((format) => (
          <button
            key={format.type}
            type="button"
            onMouseDown={preventFocusLoss}
            onClick={() => handleMarkdownClick(format)}
            disabled={disabled}
            className={`qt-formatting-button qt-formatting-button-${format.type}`}
            title={format.tooltip}
          >
            {format.label}
          </button>
        ))}
        <button
          type="button"
          onMouseDown={preventFocusLoss}
          onClick={handleCodeBlockClick}
          disabled={disabled}
          className={`qt-formatting-button qt-formatting-button-code-block${inCodeBlock ? ' qt-formatting-button-active' : ''}`}
          title={inCodeBlock ? 'End code block' : 'Insert code block'}
        >
          {inCodeBlock ? '/CODE' : 'CODE'}
        </button>
      </div>

      {/* RP template buttons - only shown when template has delimiters */}
      {hasDelimiters && (
        <>
          <div className="qt-formatting-toolbar-divider" />
          <div className="qt-formatting-toolbar-section">
            {allDelimiters.map((delimiter, index) => (
              <button
                key={`${delimiter.buttonName}-${index}`}
                type="button"
                onMouseDown={preventFocusLoss}
                onClick={() => handleDelimiterClick(delimiter)}
                disabled={disabled}
                className="qt-rp-annotation-button"
                title={getDelimiterTooltip(delimiter)}
              >
                {delimiter.buttonName}
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
              onMouseDown={preventFocusLoss}
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
