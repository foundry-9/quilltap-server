'use client'

/**
 * MarkdownLexicalEditor — reusable Lexical-based markdown editor.
 *
 * Self-contained: composer + standard plugin set + formatting toolbar +
 * markdown bidirectional bridge, plus the same "edit source" toggle the
 * Salon's Document Mode offers. Designed for forms (character fields,
 * project scenarios, settings panels) that want the same editing
 * affordances without inheriting Document Mode's chat-specific bits
 * (line gutter, doc_focus tool plugin).
 *
 * Lower-level building blocks (MarkdownBridgePlugin, FormattingCommandPlugin,
 * FormattingToolbar, COMPOSER_TRANSFORMERS, composerTheme) live alongside
 * Document Mode in components/chat/lexical and are reused verbatim.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { TablePlugin } from '@lexical/react/LexicalTablePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { composerTheme } from '@/components/chat/lexical/theme'
import {
  MarkdownBridgePlugin,
  COMPOSER_TRANSFORMERS,
} from '@/components/chat/lexical/plugins/MarkdownBridgePlugin'
import { FormattingCommandPlugin } from '@/components/chat/lexical/plugins/FormattingCommandPlugin'
import { CharTypeaheadPlugin } from '@/components/chat/lexical/plugins/CharTypeaheadPlugin'
import { EMOJI_PROFILE } from '@/lib/char-insert/profiles/emoji'
import { UNICODE_PROFILE } from '@/lib/char-insert/profiles/unicode'
import FormattingToolbar from '@/components/chat/FormattingToolbar'
import { TemplateTokenHighlightPlugin } from './TemplateTokenHighlightPlugin'

interface MarkdownLexicalEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Pass to enable roleplay-template-aware delimiter buttons in the toolbar */
  roleplayTemplateId?: string | null
  /**
   * Forces a Lexical remount when this changes — use when external loads
   * replace the editor's state (e.g. switching scenario files).
   */
  remountKey?: string | number
  className?: string
  /** Identifier for the LexicalComposer namespace (debugging/devtools) */
  namespace?: string
  ariaLabel?: string
  /**
   * Show the "Edit markdown source" toggle button in the toolbar. Defaults
   * to true. Set false for callers that should never expose raw source.
   */
  showSourceToggle?: boolean
  /** Minimum height of the editor body. Accepts any CSS height value. */
  minHeight?: string
  /** Shown, greyed, while the editor is empty. */
  placeholder?: string
  /**
   * Tint `{{char}}` / `{{user}}` tokens and the names that could become them
   * (`TemplateTokenHighlightPlugin`). Off unless given.
   */
  templateHighlight?: { characterName?: string | null; userName?: string | null }
}

function EditorBody({
  value,
  onChange,
  disabled,
  minHeight,
  ariaLabel,
  placeholder,
  templateHighlight,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  minHeight: string
  ariaLabel?: string
  placeholder?: string
  templateHighlight?: MarkdownLexicalEditorProps['templateHighlight']
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <>
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="qt-doc-editor-area qt-lexical-contenteditable"
              aria-label={ariaLabel ?? 'Markdown editor'}
              style={{ lineHeight: '1.6', minHeight }}
            />
          }
          placeholder={
            placeholder ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 select-none overflow-hidden qt-text-secondary opacity-70"
                // Matches `.qt-doc-editor-area`'s padding, so the hint sits where the caret does.
                style={{ lineHeight: '1.6', padding: '1rem 1.5rem' }}
              >
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <TablePlugin />
      <MarkdownShortcutPlugin transformers={COMPOSER_TRANSFORMERS} />
      <MarkdownBridgePlugin
        input={value}
        setInput={onChange}
        initialMarkdown={value}
      />
      <FormattingCommandPlugin />
      {/* The `:` emoji and `\` symbol typeaheads, as in the Salon composer and
          Document Mode — each still honours its composer setting. The `/`
          command menu and `@` mentions are chat-only and deliberately absent. */}
      <CharTypeaheadPlugin profile={EMOJI_PROFILE} />
      <CharTypeaheadPlugin profile={UNICODE_PROFILE} />
      {templateHighlight && (
        <TemplateTokenHighlightPlugin
          characterName={templateHighlight.characterName}
          userName={templateHighlight.userName}
        />
      )}
    </>
  )
}

function ToolbarSlot({
  roleplayTemplateId,
  disabled,
  showSource,
  sourceTextareaRef,
  onContentChange,
  onToggleSource,
}: {
  roleplayTemplateId?: string | null
  disabled: boolean
  showSource: boolean
  sourceTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  onContentChange: (value: string) => void
  onToggleSource?: () => void
}) {
  const [editor] = useLexicalComposerContext()
  return (
    <div className="qt-doc-toolbar">
      <FormattingToolbar
        roleplayTemplateId={roleplayTemplateId}
        editor={editor}
        disabled={disabled}
        showSource={showSource}
        sourceTextareaRef={sourceTextareaRef}
        setInput={onContentChange}
        onToggleSource={onToggleSource}
      />
    </div>
  )
}

export default function MarkdownLexicalEditor({
  value,
  onChange,
  disabled = false,
  roleplayTemplateId,
  remountKey,
  className,
  namespace = 'MarkdownLexicalEditor',
  ariaLabel,
  showSourceToggle = true,
  minHeight = '12rem',
  placeholder,
  templateHighlight,
}: MarkdownLexicalEditorProps) {
  const [showSource, setShowSource] = useState(false)
  // Bumped each time the user leaves source mode, so the LexicalComposer
  // remounts and the MarkdownBridge re-parses the (possibly textarea-edited)
  // value. MarkdownBridgePlugin only reads initialMarkdown on first mount.
  const [sourceLeaveCount, setSourceLeaveCount] = useState(0)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)

  const initialConfig = useMemo(
    () => ({
      namespace,
      theme: composerTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        CodeNode,
        CodeHighlightNode,
        TableNode,
        TableCellNode,
        TableRowNode,
      ],
      editable: !disabled,
      onError: (error: Error) => {
        console.error('[MarkdownLexicalEditor] Editor error:', error)
      },
    }),
    // Lexical's initialConfig is read once at mount; we force re-mount via
    // the `key` on LexicalComposer below when remountKey or the source-leave
    // counter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LexicalComposer reads initialConfig only at mount; changes force a remount through its key instead
    [],
  )

  const toggleSourceMode = useCallback(() => {
    setShowSource((prev) => {
      if (prev) setSourceLeaveCount((n) => n + 1)
      return !prev
    })
  }, [])

  const composerKey = `${remountKey ?? 'default'}-${sourceLeaveCount}`

  const frameClassName = [
    'rounded-lg border qt-border-default qt-bg-card qt-shadow-sm overflow-hidden',
    'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={frameClassName} role="group" aria-label={ariaLabel}>
      <LexicalComposer key={composerKey} initialConfig={initialConfig}>
        <ToolbarSlot
          roleplayTemplateId={roleplayTemplateId}
          disabled={disabled}
          showSource={showSource}
          sourceTextareaRef={sourceTextareaRef}
          onContentChange={onChange}
          onToggleSource={showSourceToggle ? toggleSourceMode : undefined}
        />
        {showSource ? (
          <textarea
            ref={sourceTextareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            spellCheck={false}
            aria-label={ariaLabel ? `${ariaLabel} (markdown source)` : 'Markdown source'}
            placeholder={placeholder}
            className="w-full px-3 py-2 font-mono text-sm qt-text-primary border-0 outline-none resize-y"
            style={{ lineHeight: '1.6', minHeight, backgroundColor: 'var(--color-background)' }}
          />
        ) : (
          <div className="qt-doc-editor-with-gutter">
            <div className="flex-1">
              <EditorBody
                value={value}
                onChange={onChange}
                disabled={disabled}
                minHeight={minHeight}
                ariaLabel={ariaLabel}
                placeholder={placeholder}
                templateHighlight={templateHighlight}
              />
            </div>
          </div>
        )}
      </LexicalComposer>
    </div>
  )
}
