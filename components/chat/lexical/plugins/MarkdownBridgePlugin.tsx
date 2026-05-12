'use client'

/**
 * Markdown Bridge Plugin
 *
 * Bridges Lexical's internal EditorState with the plain-string input/setInput
 * interface used by the rest of the app. Messages are stored as markdown
 * strings, so this plugin handles the bidirectional conversion.
 *
 * Critical design note: Uses a custom transformer set that maps italic to
 * underscore (_text_) rather than asterisk (*text*), because single asterisks
 * are widely used as roleplay narration delimiters and must survive roundtrip
 * as literal text.
 *
 * @module components/chat/lexical/plugins/MarkdownBridgePlugin
 */

import { useEffect, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_UNDERSCORE,
  INLINE_CODE,
  CODE,
  HEADING,
  ORDERED_LIST,
  UNORDERED_LIST,
  CHECK_LIST,
  QUOTE,
  LINK,
  STRIKETHROUGH,
  HIGHLIGHT,
  type Transformer,
  type ElementTransformer,
} from '@lexical/markdown'
import { TABLE_TRANSFORMER } from '@/components/chat/lexical/transformers/table-transformer'

/**
 * Case-insensitive CHECK_LIST transformer.
 *
 * Lexical's built-in CHECK_LIST uses `match[3] === 'x'` (case-sensitive) to
 * determine checked state, so `[X]` renders as unchecked. This wrapper
 * normalizes the capture group to lowercase before delegating to the original.
 */
const CASE_INSENSITIVE_CHECK_LIST: ElementTransformer = {
  ...CHECK_LIST,
  replace(...args) {
    const match = args[2]
    if (match[3] && match[3].toLowerCase() === 'x') {
      match[3] = 'x'
    }
    return CHECK_LIST.replace(...args)
  },
}

/**
 * Custom transformer set.
 *
 * Excludes ITALIC_STAR and BOLD_ITALIC_STAR to prevent *narration* from
 * being converted to italic nodes. The app convention uses _text_ for italic
 * (see MARKDOWN_FORMATS in lib/chat/annotations.ts).
 */
export const COMPOSER_TRANSFORMERS: Transformer[] = [
  // Text format transformers — underscore-based italic only
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  HIGHLIGHT,
  // Element transformers — CHECK_LIST must precede UNORDERED_LIST/ORDERED_LIST
  // because their regexps overlap and first match wins
  HEADING,
  QUOTE,
  CODE,
  CASE_INSENSITIVE_CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  // Text match transformers
  LINK,
  // Multiline element transformers
  TABLE_TRANSFORMER,
]

interface MarkdownBridgePluginProps {
  /** Current markdown string from parent state */
  input: string
  /** Callback to update parent state with new markdown */
  setInput: (value: string) => void
  /** Initial markdown to populate the editor on mount */
  initialMarkdown?: string
  /**
   * When true, strip Lexical's automatic `\*` escapes on export so literal
   * asterisks survive as `*` rather than `\*`. Safe because
   * [[composer-transformers]] excludes ITALIC_STAR / BOLD_ITALIC_STAR, so
   * single `*` is not a formatting tag.
   */
  preserveAsterisks?: boolean
}

/**
 * Strip Lexical's `\*` escapes from exported markdown. Only `\*` is touched;
 * `\_`, `` \` ``, `\~` stay escaped because those characters *are* active
 * formatting tags in our transformer set.
 */
function stripAsteriskEscapes(markdown: string): string {
  return markdown.replace(/\\\*/g, '*')
}

/**
 * Ref-based handle for synchronous markdown access from the parent.
 * Used by LexicalComposerWrapper to implement ComposerEditorHandle.
 */
export interface MarkdownBridgeRef {
  getMarkdown: () => string
  setMarkdown: (text: string) => void
}

export function MarkdownBridgePlugin({
  input,
  setInput,
  initialMarkdown,
  preserveAsterisks = false,
}: MarkdownBridgePluginProps) {
  const [editor] = useLexicalComposerContext()
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the last markdown value we sent to setInput, so we can distinguish
  // parent-initiated clears from our own debounced updates
  const lastSentMarkdownRef = useRef('')
  const lastExternalInputRef = useRef(input)
  const hasInitializedRef = useRef(false)

  // Initialize editor with markdown content on mount
  useEffect(() => {
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true

    const markdown = initialMarkdown ?? input
    if (!markdown) return

    editor.update(
      () => {
        $convertFromMarkdownString(markdown, COMPOSER_TRANSFORMERS, undefined, true)
      },
      { tag: 'external-sync' },
    )
  }, [editor, initialMarkdown, input])

  // Listen for editor changes and sync to parent as markdown
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      // Skip updates triggered by our own external-to-editor sync
      if (tags.has('external-sync')) return

      editorState.read(() => {
        const raw = $convertToMarkdownString(COMPOSER_TRANSFORMERS, undefined, true)
        const markdown = preserveAsterisks ? stripAsteriskEscapes(raw) : raw

        // Debounce parent state updates (16ms, ~1 frame)
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(() => {
          lastSentMarkdownRef.current = markdown
          setInput(markdown)
        }, 16)
      })
    })
  }, [editor, setInput, preserveAsterisks])

  // Detect when parent clears input (e.g., after submission) and clear editor.
  // We know it's an external clear when input becomes '' but we didn't send ''
  // ourselves via the debounced setInput.
  useEffect(() => {
    if (input === '' && lastExternalInputRef.current !== '' && lastSentMarkdownRef.current !== '') {
      // Parent cleared the input — clear the editor
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      lastSentMarkdownRef.current = ''
      editor.update(
        () => {
          $getRoot().clear()
        },
        { tag: 'external-sync' },
      )
    }
    lastExternalInputRef.current = input
  }, [input, editor])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return null
}

/**
 * Hook to get synchronous markdown access from the editor.
 * Used by the wrapper to implement getMarkdown/setMarkdown on the handle.
 */
export function useMarkdownBridge() {
  const [editor] = useLexicalComposerContext()

  const getMarkdown = useCallback((): string => {
    let markdown = ''
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(COMPOSER_TRANSFORMERS, undefined, true)
    })
    return markdown
  }, [editor])

  const setMarkdown = useCallback(
    (text: string) => {
      editor.update(
        () => {
          $getRoot().clear()
          if (text) {
            $convertFromMarkdownString(text, COMPOSER_TRANSFORMERS, undefined, true)
          }
        },
        { tag: 'external-sync' },
      )
    },
    [editor],
  )

  return { getMarkdown, setMarkdown }
}
